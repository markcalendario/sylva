import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "sylva-shared";
import { TerminalService } from "../src/services/terminals.js";
import type { Store } from "../src/services/store.js";
import type { Workspace } from "../src/services/workspace.js";
import type { WsHub } from "../src/ws/hub.js";

/**
 * A terminal is a conversation with a real pty, so these drive a real one. A
 * mock would be politely wrong about exactly the parts that matter: that the
 * shell echoes what you type, that output arrives in chunks nobody chose, and
 * that closing it takes the shell with it.
 */
async function harness(shell = "/bin/sh") {
  const cwd = await mkdtemp(join(tmpdir(), "sylva-term-"));
  const events: ServerEvent[] = [];

  const store = { preferences: { terminalShell: shell } } as unknown as Store;
  const workspace = {
    resolveWorktree: async () => ({ repo: { id: "r1" }, worktree: { path: cwd } }),
  } as unknown as Workspace;
  const hub = { broadcast: (e: ServerEvent) => events.push(e) } as unknown as WsHub;

  return { terminals: new TerminalService(store, workspace, hub), events, cwd };
}

/** Wait until the retained buffer says what we're waiting for, or give up. */
async function until(
  read: () => string,
  needle: RegExp,
  timeoutMs = 8000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = read();
    if (needle.test(text)) return text;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`terminal never said ${needle}`);
}

/** Is this process still there? Signal 0 asks without sending. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Poll a condition until it holds, or give up. */
async function untilTrue(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition never held");
}

describe("terminals", () => {
  it("runs what is typed at it and keeps what was said", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1", { cols: 80, rows: 24 });
    expect(info.status).toBe("running");

    terminals.write(info.id, "echo sylva-was-here\n");
    const seen = await until(() => terminals.buffer(info.id).data, /sylva-was-here/);
    // Echoed once by the tty and once as output; either way it is on screen.
    expect(seen).toMatch(/sylva-was-here/);

    terminals.close(info.id);
  });

  it("runs the command it was opened with", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1", { command: "echo opened-with-a-command" });
    // The tab says what it was opened to do, not just which shell it is.
    expect(info.title).toBe("echo opened-with-a-command");
    await until(() => terminals.buffer(info.id).data, /opened-with-a-command/);
    terminals.close(info.id);
  });

  it("numbers its output so a late attach can tell new from replayed", async () => {
    const { terminals, events } = await harness();
    const info = await terminals.create("wt1");
    terminals.write(info.id, "echo one\n");
    await until(() => terminals.buffer(info.id).data, /one/);

    const chunks = events.filter(
      (e): e is Extract<ServerEvent, { type: "terminal.output" }> => e.type === "terminal.output",
    );
    expect(chunks.length).toBeGreaterThan(0);
    // Strictly increasing, and the buffer claims the sequence it ends at.
    const seqs = chunks.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(terminals.buffer(info.id).seq).toBe(seqs[seqs.length - 1]);

    terminals.close(info.id);
  });

  it("holds several terminals in one worktree, each its own shell", async () => {
    const { terminals } = await harness();
    const first = await terminals.create("wt1");
    const second = await terminals.create("wt1");
    expect(terminals.list("wt1").map((t) => t.id)).toEqual([first.id, second.id]);

    terminals.write(first.id, "echo only-the-first\n");
    await until(() => terminals.buffer(first.id).data, /only-the-first/);
    expect(terminals.buffer(second.id).data).not.toMatch(/only-the-first/);

    terminals.close(first.id);
    terminals.close(second.id);
  });

  it("notices when the shell exits, and keeps what it said", async () => {
    const { terminals, events } = await harness();
    const info = await terminals.create("wt1");
    terminals.write(info.id, "echo goodbye; exit 3\n");

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && terminals.buffer(info.id).info.status === "running") {
      await new Promise((r) => setTimeout(r, 25));
    }
    const after = terminals.buffer(info.id);
    expect(after.info.status).toBe("exited");
    expect(after.info.exitCode).toBe(3);
    // The output outlives the shell, so you can read why it stopped.
    expect(after.data).toMatch(/goodbye/);
    expect(events.some((e) => e.type === "terminal.state" && e.info.status === "exited")).toBe(true);

    terminals.close(info.id);
  });

  it("takes what the shell started down with it", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1");
    // A marker no other process on the machine will match.
    terminals.write(info.id, "sleep 400 & echo STARTED-$!\n");
    const seen = await until(() => terminals.buffer(info.id).data, /STARTED-\d+/);
    const child = Number(/STARTED-(\d+)/.exec(seen)?.[1]);
    expect(child).toBeGreaterThan(0);

    terminals.close(info.id);

    // Killing the shell alone would leave this running — which, for a dev
    // server, means a held port and a terminal that "closed" without closing.
    const deadline = Date.now() + 5000;
    let alive = true;
    while (Date.now() < deadline && alive) {
      try {
        process.kill(child, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  });

  /**
   * The retained output is capped, and the cap is enforced by dropping the
   * oldest chunks rather than rebuilding the string — so what the invariant
   * says (`bufferLength`) and what is actually held have to stay in step, and
   * the newest output must be the part that survives.
   */
  it("keeps the tail of a runaway terminal, and no more", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1");
    const inner = terminals as unknown as {
      sessions: Map<string, { chunks: string[]; bufferLength: number }>;
      retain: (session: unknown, data: string) => void;
    };
    const session = inner.sessions.get(info.id)!;
    // From a known state: the shell has already said hello by now.
    session.chunks.length = 0;
    session.bufferLength = 0;

    const width = 1_000;
    const chunks = 400; // 400_000 characters, comfortably past the cap
    const line = (i: number) => `${i}`.padStart(width, ".");
    for (let i = 0; i < chunks; i++) inner.retain(session, line(i));

    const held = session.chunks.join("");
    expect(held.length).toBe(session.bufferLength);
    expect(held.length).toBeLessThan(width * chunks);
    // The end of the output is what a terminal is for; the beginning is what
    // a cap is allowed to take.
    expect(held.endsWith(line(chunks - 1))).toBe(true);
    expect(held.includes(line(0))).toBe(false);

    terminals.close(info.id);
    // Closing is the end of what it said, not just of what it was running.
    expect(session.chunks).toEqual([]);
    expect(session.bufferLength).toBe(0);
  });

  it("forgets a closed terminal", async () => {
    const { terminals, events } = await harness();
    const info = await terminals.create("wt1");
    terminals.close(info.id);
    expect(terminals.list("wt1")).toEqual([]);
    expect(events.some((e) => e.type === "terminal.closed" && e.terminalId === info.id)).toBe(true);
    expect(() => terminals.buffer(info.id)).toThrow(/not found/i);
  });

  it("closes everything on shutdown", async () => {
    const { terminals } = await harness();
    await terminals.create("wt1");
    await terminals.create("wt2");
    await terminals.closeAll();
    expect(terminals.all()).toEqual([]);
  });

  /**
   * A hangup is a request. A shell that has been told to ignore it — which is
   * a line anyone's dotfiles might contain, and what `trap` is for — used to
   * survive the shutdown that asked, because nothing waited to find out.
   */
  it("insists, on the way out, when a shell declines to hang up", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1");
    const inner = terminals as unknown as {
      sessions: Map<string, { pty: { pid: number } | null }>;
    };
    const pid = inner.sessions.get(info.id)?.pty?.pid;
    expect(pid).toBeGreaterThan(0);

    terminals.write(info.id, "trap '' HUP; echo DEAF\n");
    await until(() => terminals.buffer(info.id).data, /DEAF/);

    await terminals.closeAll();

    // The kill lands the moment the grace period is up; being reaped, and so
    // stopping answering signal 0, takes a moment longer.
    const deadline = Date.now() + 5000;
    let alive = true;
    while (Date.now() < deadline && alive) {
      try {
        process.kill(pid!, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 20_000);

  /**
   * A worktree that is being removed takes its terminals with it. Afterwards
   * there is nowhere left in Sylva that lists them — so a shell left running
   * is one nobody can see, in a directory that no longer exists.
   */
  it("closes every terminal in a worktree that is going away", async () => {
    const { terminals, events } = await harness();
    const first = await terminals.create("wt1");
    const second = await terminals.create("wt1");
    const other = await terminals.create("wt2");

    terminals.closeForWorktree("wt1");

    expect(terminals.list("wt1")).toEqual([]);
    expect(terminals.list("wt2").map((t) => t.id)).toEqual([other.id]);
    const closed = events.filter((e) => e.type === "terminal.closed").map((e) => e.terminalId);
    expect(closed).toEqual([first.id, second.id]);

    terminals.close(other.id);
  });

  it("closes every terminal belonging to a repository being forgotten", async () => {
    const { terminals } = await harness();
    await terminals.create("wt1");
    await terminals.create("wt2");

    // The harness answers for one repository, so both terminals are its own.
    terminals.closeForRepo("r1");
    expect(terminals.all()).toEqual([]);
  });

  /**
   * A finished terminal is a tab holding what it said, not a shell. Counting
   * it against the per-worktree limit made twelve conversations with `exit` at
   * the end enough to refuse a thirteenth terminal in a worktree running none.
   */
  it("doesn't let finished terminals hold slots open", async () => {
    const { terminals } = await harness();
    const inner = terminals as unknown as { sessions: Map<string, unknown> };
    for (let i = 0; i < 12; i++) {
      inner.sessions.set(`dead-${i}`, {
        info: {
          id: `dead-${i}`,
          worktreeId: "wt1",
          repoId: "r1",
          title: "sh",
          shell: "/bin/sh",
          cwd: "/tmp",
          status: "exited",
          exitCode: 0,
          cols: 80,
          rows: 24,
          startedAt: new Date().toISOString(),
          exitedAt: new Date().toISOString(),
        },
        pty: null,
        chunks: [],
        bufferLength: 0,
        seq: 0,
        pending: "",
        timer: null,
        groups: new Set<number>(),
        tty: null,
      });
    }

    const info = await terminals.create("wt1");
    expect(info.status).toBe("running");
    // And the dead ones stop piling up: what is kept is the recent handful,
    // which is what anyone actually comes back to read.
    expect(terminals.list("wt1").filter((t) => t.status === "exited")).toHaveLength(6);

    terminals.close(info.id);
  });

  it("says so rather than failing silently when the shell doesn't exist", async () => {
    const { terminals } = await harness("/nope/not/a/shell");
    await expect(terminals.create("wt1")).rejects.toThrow(/couldn't start/i);
  });

  /**
   * The expensive things are the ones that outlive the terminal.
   *
   * A dev server is typed into a shell, and an interactive shell puts each job
   * in a process group of its own — so hanging up on the shell's group reaches
   * the prompt and nothing else, and the server carries on holding a couple of
   * gigabytes with its parent gone and nothing left saying which worktree it
   * came from.
   */
  it("takes what it started with it, once the shell that started it has gone", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1");

    terminals.write(info.id, "sleep 300 & echo started=$!\n");
    const seen = await until(() => terminals.buffer(info.id).data, /started=\d+/);
    const child = Number(/started=(\d+)/.exec(seen)![1]);
    // Its own group, which is the whole difficulty.
    expect(alive(child)).toBe(true);

    // Long enough to have been noticed while the shell still had it: once the
    // shell exits, the job is reparented to init and its terminal revoked, and
    // nothing anywhere connects the two any more.
    await new Promise((r) => setTimeout(r, 1500));

    // The shell goes on its own, and the tab is closed after it — the ordinary
    // way a dev server gets left behind.
    terminals.write(info.id, "exit\n");
    await untilTrue(() => terminals.list("wt1").every((t) => t.status === "exited"));
    terminals.close(info.id);
    expect(terminals.all()).toHaveLength(0);

    await untilTrue(() => !alive(child));
    expect(alive(child)).toBe(false);
  }, 20000);

  /**
   * And if it is never closed at all, shutdown is the last chance.
   *
   * Sessions are dropped for reasons of their own — a finished terminal aged
   * out to make room, a worktree going away — and what they started is not
   * dropped with them. The groups outlive the sessions so that closing Sylva
   * can still reach them.
   */
  it("sweeps at shutdown what it has already forgotten the terminal for", async () => {
    const { terminals } = await harness();
    const info = await terminals.create("wt1");

    terminals.write(info.id, "sleep 300 & echo started=$!\n");
    const seen = await until(() => terminals.buffer(info.id).data, /started=\d+/);
    const child = Number(/started=(\d+)/.exec(seen)![1]);
    await new Promise((r) => setTimeout(r, 1500));

    // Lose the session without closing it — standing in for any path that
    // drops one, none of which the job it started knows anything about.
    const sessions = (terminals as unknown as { sessions: Map<string, unknown> }).sessions;
    const session = sessions.get(info.id);
    (terminals as unknown as { forget(s: unknown): void }).forget(session);
    sessions.delete(info.id);
    expect(terminals.all()).toHaveLength(0);
    expect(alive(child)).toBe(true);

    await terminals.closeAll();
    await untilTrue(() => !alive(child));
    expect(alive(child)).toBe(false);
  }, 20000);
});