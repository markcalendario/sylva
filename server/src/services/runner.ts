import { spawn, type ChildProcess } from "node:child_process";
import type { RunnerLine, RunnerSnapshot, RunnerState } from "sylva-shared";
import { badRequest, conflict } from "../lib/errors.js";
import { now } from "../lib/id.js";
import type { Store } from "./store.js";
import type { Workspace } from "./workspace.js";
import type { WsHub } from "../ws/hub.js";

/** Matches the debounce the file watcher uses, for the same reason. */
const FLUSH_MS = 100;
const MAX_LINES = 2000;

/**
 * Dev servers announce themselves in wildly different words but always with a
 * URL, so the URL is what we look for rather than any framework's phrasing.
 */
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s"'`]*/i;

interface Runner {
  state: RunnerState;
  child: ChildProcess | null;
  lines: RunnerLine[];
  seq: number;
  pending: RunnerLine[];
  timer: NodeJS.Timeout | null;
  /** Partial trailing line per stream, until its newline arrives. */
  carry: { stdout: string; stderr: string };
  /** Waiters for the child's exit, so stop() can answer with the truth. */
  exited: (() => void)[];
}

/**
 * One long-running project command per worktree.
 *
 * Not a terminal: nothing is written to the child's stdin and no pty is
 * allocated. It exists so that starting a dev server doesn't mean finding a
 * terminal and remembering which folder it belongs in.
 */
export class RunnerService {
  private runners = new Map<string, Runner>();

  constructor(
    private store: Store,
    private workspace: Workspace,
    private hub: WsHub,
  ) {}

  /** The command this worktree's repository runs: its own, or the default. */
  private async commandFor(worktreeId: string): Promise<string> {
    const { repo } = await this.workspace.resolveWorktree(worktreeId);
    const { runner } = this.store.preferences;
    return (runner.byRepo[repo.id] ?? runner.defaultCommand).trim();
  }

  async snapshot(worktreeId: string): Promise<RunnerSnapshot> {
    const existing = this.runners.get(worktreeId);
    if (existing) return { state: existing.state, lines: existing.lines };
    return {
      state: {
        worktreeId,
        status: "idle",
        command: await this.commandFor(worktreeId),
        pid: null,
        startedAt: null,
        exitedAt: null,
        exitCode: null,
        url: null,
      },
      lines: [],
    };
  }

  /** Every runner that has been started this server lifetime. */
  states(): RunnerState[] {
    return [...this.runners.values()].map((r) => r.state);
  }

  async start(worktreeId: string): Promise<RunnerState> {
    const existing = this.runners.get(worktreeId);
    if (existing?.state.status === "running") {
      throw conflict("A command is already running in this worktree");
    }

    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const command = await this.commandFor(worktreeId);
    if (!command) throw badRequest("No run command is configured for this repository");

    // detached so the child leads its own process group: `npm run dev` spawns
    // children that outlive a kill aimed at the npm process alone.
    const child = spawn(command, {
      shell: true,
      cwd: worktree.path,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const runner: Runner = {
      state: {
        worktreeId,
        status: "running",
        command,
        pid: child.pid ?? null,
        startedAt: now(),
        exitedAt: null,
        exitCode: null,
        url: null,
      },
      child,
      // A restart keeps nothing: the previous run's output explains the
      // previous run, and mixing the two reads as one confusing log.
      lines: [],
      seq: 0,
      pending: [],
      timer: null,
      carry: { stdout: "", stderr: "" },
      exited: [],
    };
    this.runners.set(worktreeId, runner);

    child.stdout?.on("data", (chunk: Buffer) => this.ingest(runner, "stdout", chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => this.ingest(runner, "stderr", chunk.toString()));

    child.on("error", (err) => {
      this.ingest(runner, "stderr", `${err.message}\n`);
      this.settle(runner, null);
    });
    child.on("exit", (code, signal) => {
      // A signalled exit reports as negative, the way a shell does.
      this.settle(runner, code ?? (signal ? -1 : null));
    });

    this.broadcastState(runner);
    return runner.state;
  }

  async stop(worktreeId: string): Promise<RunnerState> {
    const runner = this.runners.get(worktreeId);
    if (!runner || runner.state.status !== "running") {
      throw badRequest("Nothing is running in this worktree");
    }
    this.kill(runner);
    // Wait for the child to actually go before answering. Returning the state
    // as it was a microsecond before the signal means replying "running" to a
    // request to stop — true at the instant of writing, and useless.
    await Promise.race([
      new Promise<void>((resolve) => runner.exited.push(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    return runner.state;
  }

  /**
   * Kill the whole process group. `npm run dev` is a shell, running npm,
   * running vite: killing the pid alone leaves the dev server holding the port,
   * which is exactly the mess the runner exists to avoid.
   */
  private kill(runner: Runner): void {
    const pid = runner.state.pid;
    if (!pid) return;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        runner.child?.kill("SIGTERM");
      } catch {
        // Already gone; the exit handler has run or is about to.
      }
    }
  }

  private settle(runner: Runner, exitCode: number | null): void {
    if (runner.state.status === "exited") return;
    this.flush(runner);
    runner.state.status = "exited";
    runner.state.exitCode = exitCode;
    runner.state.exitedAt = now();
    runner.state.pid = null;
    runner.child = null;
    this.broadcastState(runner);
    for (const waiter of runner.exited.splice(0)) waiter();
  }

  /**
   * Split incoming chunks on newlines, holding a partial trailing line until
   * its newline arrives — a chunk boundary is not a line boundary, and treating
   * it as one splits words in half on screen.
   */
  private ingest(runner: Runner, stream: "stdout" | "stderr", chunk: string): void {
    const combined = runner.carry[stream] + chunk;
    const parts = combined.split(/\r?\n/);
    runner.carry[stream] = parts.pop() ?? "";

    for (const text of parts) {
      const line: RunnerLine = { seq: runner.seq++, stream, text, at: now() };
      runner.pending.push(line);
      runner.lines.push(line);

      const match = URL_PATTERN.exec(text);
      if (match?.[0]) {
        const url = match[0].replace(/[.,;)]+$/, "");
        if (url !== runner.state.url) {
          runner.state.url = url;
          this.broadcastState(runner);
        }
      }
    }

    if (runner.lines.length > MAX_LINES) {
      runner.lines.splice(0, runner.lines.length - MAX_LINES);
    }
    if (runner.pending.length > 0 && !runner.timer) {
      runner.timer = setTimeout(() => this.flush(runner), FLUSH_MS);
    }
  }

  private flush(runner: Runner): void {
    if (runner.timer) {
      clearTimeout(runner.timer);
      runner.timer = null;
    }
    if (runner.pending.length === 0) return;
    const lines = runner.pending;
    runner.pending = [];
    this.hub.broadcast({ type: "runner.output", worktreeId: runner.state.worktreeId, lines });
  }

  private broadcastState(runner: Runner): void {
    this.hub.broadcast({ type: "runner.state", state: { ...runner.state } });
  }

  /** Nothing Sylva started should outlive it, as far as it can help that. */
  async stopAll(): Promise<void> {
    for (const runner of this.runners.values()) {
      if (runner.timer) clearTimeout(runner.timer);
      if (runner.state.status === "running") this.kill(runner);
    }
  }
}
