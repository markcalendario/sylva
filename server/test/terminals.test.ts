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

  it("says so rather than failing silently when the shell doesn't exist", async () => {
    const { terminals } = await harness("/nope/not/a/shell");
    await expect(terminals.create("wt1")).rejects.toThrow(/couldn't start/i);
  });
});
