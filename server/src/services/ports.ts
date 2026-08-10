import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KillPortResult, PortListener, PortScan } from "sylva-shared";
import { badRequest } from "../lib/errors.js";
import { now } from "../lib/id.js";

const run = promisify(execFile);

/** Long enough for lsof to walk the descriptor table on a busy machine. */
const LSOF_TIMEOUT_MS = 8_000;

/**
 * How long a process is given to end on its own after SIGTERM before the kill
 * stops asking. A dev server flushing a log or removing a socket file wants a
 * moment; a wedged one is exactly what the button is for.
 */
const GRACE_MS = 1_500;
const POLL_MS = 100;

/**
 * Who is holding a port, and freeing it.
 *
 * The whole tool is `lsof` and two signals. It is deliberately not clever:
 * everything it can do you could do in the terminal Sylva already gives you,
 * and the reason it exists is that "port 3000 is already in use" arrives when
 * you are in the middle of something else, three keystrokes from remembering
 * the incantation.
 */

/** One record from lsof's field output, before it is split per address. */
interface Process {
  pid: number;
  command: string;
  user?: string;
  /** Every address this process is listening on, as lsof names them. */
  names: string[];
}

/**
 * Parse `lsof -F` output.
 *
 * The format is one field per line, tagged by its first character: `p` opens a
 * process record, `c`/`L` describe it, and every `n` after that is one of its
 * open files — here, one listening address.
 */
export function parseLsof(stdout: string): Process[] {
  const out: Process[] = [];
  let current: Process | null = null;

  for (const line of stdout.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const pid = Number(value);
      current = Number.isFinite(pid) ? { pid, command: "?", names: [] } : null;
      if (current) out.push(current);
    } else if (!current) {
      continue;
    } else if (tag === "c") {
      current.command = value;
    } else if (tag === "L") {
      current.user = value;
    } else if (tag === "n") {
      current.names.push(value);
    }
  }
  return out;
}

/**
 * The port an lsof address ends in, and the host part in front of it.
 *
 * Addresses arrive as `*:3000`, `127.0.0.1:5173` or `[::1]:8080`, so the port
 * is whatever follows the *last* colon — the IPv6 form has several.
 */
export function splitAddress(name: string): { address: string; port: number } | null {
  const at = name.lastIndexOf(":");
  if (at === -1) return null;
  const port = Number(name.slice(at + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { address: name.slice(0, at), port };
}

/** Every TCP port being listened on, whoever owns it. */
async function listeners(): Promise<PortListener[]> {
  let stdout = "";
  try {
    const result = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcLn"], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    // execFile rejects with the child's exit code as a number, and with a
    // string errno when the child never started at all.
    const e = err as { code?: string | number; message?: string; stdout?: string };
    if (e.code === "ENOENT") {
      throw badRequest(
        "`lsof` isn't on your PATH, and it's how Sylva finds out who holds a port.",
        "Install lsof, or free the port from a terminal with `kill $(lsof -ti :PORT)`.",
      );
    }
    // Nothing listening at all is an exit code, not a failure. Anything that
    // also wrote nothing to stdout genuinely went wrong.
    if (typeof e.stdout === "string" && e.stdout.length > 0) stdout = e.stdout;
    else if (e.code === 1) stdout = "";
    else throw badRequest(`\`lsof\` failed: ${e.message}`);
  }

  const out: PortListener[] = [];
  for (const proc of parseLsof(stdout)) {
    for (const name of proc.names) {
      const split = splitAddress(name);
      if (!split) continue;
      out.push({
        port: split.port,
        pid: proc.pid,
        command: proc.command,
        ...(proc.user ? { user: proc.user } : {}),
        address: split.address,
        self: proc.pid === process.pid,
      });
    }
  }
  // Same process listening on both stacks is one answer, not two rows.
  const seen = new Set<string>();
  return out
    .filter((l) => {
      const key = `${l.port} ${l.pid} ${l.address}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** Who holds these ports — or every listener on the machine, given none. */
export async function scanPorts(ports: number[]): Promise<PortScan> {
  const all = await listeners();
  if (ports.length === 0) return { listeners: all, free: [], scannedAt: now() };

  const wanted = new Set(ports);
  const found = all.filter((l) => wanted.has(l.port));
  const held = new Set(found.map((l) => l.port));
  return {
    listeners: found,
    free: ports.filter((p) => !held.has(p)),
    scannedAt: now(),
  };
}

/** Is this process still there? Signal 0 checks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to someone else — which is still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask a process to stop, then insist.
 *
 * SIGTERM first because a dev server given the chance will clean up after
 * itself, and SIGKILL only once it has had that chance and declined it.
 */
async function endProcess(pid: number): Promise<{ ok: boolean; forced: boolean; note?: string }> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { ok: true, forced: false, note: "already gone" };
    if (code === "EPERM") {
      return { ok: false, forced: false, note: "belongs to another user" };
    }
    return { ok: false, forced: false, note: (err as Error).message };
  }

  for (let waited = 0; waited < GRACE_MS; waited += POLL_MS) {
    await wait(POLL_MS);
    if (!alive(pid)) return { ok: true, forced: false };
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return { ok: true, forced: false };
    return { ok: false, forced: true, note: (err as Error).message };
  }
  await wait(POLL_MS);
  return alive(pid)
    ? { ok: false, forced: true, note: "still running after SIGKILL" }
    : { ok: true, forced: true };
}

/** Free these ports, and say what happened to each of them. */
export async function killPorts(ports: number[]): Promise<KillPortResult[]> {
  const scan = await scanPorts(ports);
  const byPort = new Map<number, PortListener[]>();
  for (const listener of scan.listeners) {
    byPort.set(listener.port, [...(byPort.get(listener.port) ?? []), listener]);
  }

  const results: KillPortResult[] = [];
  for (const port of ports) {
    const holders = byPort.get(port) ?? [];
    if (holders.length === 0) {
      results.push({ port, outcome: "free", pids: [], note: "nothing was listening" });
      continue;
    }

    // Sylva's own server answers this request; killing it would take the reply
    // with it. Said plainly rather than attempted and blamed on the network.
    const mine = holders.find((h) => h.self);
    if (mine) {
      results.push({
        port,
        outcome: "refused",
        pids: [mine.pid],
        note: `that's Sylva's own server (pid ${mine.pid}) — stop it from the terminal you started it in`,
      });
      continue;
    }

    // One process can hold a port on several addresses; kill it once.
    const pids = [...new Set(holders.map((h) => h.pid))];
    const notes: string[] = [];
    let allOk = true;
    for (const pid of pids) {
      const outcome = await endProcess(pid);
      allOk &&= outcome.ok;
      const name = holders.find((h) => h.pid === pid)?.command ?? "process";
      notes.push(
        outcome.ok
          ? `${name} (${pid})${outcome.forced ? " — needed SIGKILL" : ""}${outcome.note ? ` — ${outcome.note}` : ""}`
          : `${name} (${pid}) survived: ${outcome.note ?? "unknown error"}`,
      );
    }

    results.push({
      port,
      outcome: allOk ? "killed" : "failed",
      pids,
      note: notes.join("; "),
    });
  }

  return results;
}
