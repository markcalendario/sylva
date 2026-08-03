import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ServerEvent } from "sylva-shared";
import { GitService } from "../src/services/git.js";
import { SessionManager } from "../src/services/sessions.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";
import type { WatcherManager } from "../src/services/watcher.js";
import type { WsHub } from "../src/ws/hub.js";

const WORKTREE = "abc123worktree";

/**
 * Clearing is only trustworthy if *all three* traces go: the SDK session id the
 * next prompt would resume into, the transcript on disk, and the cost. Leave any
 * one and the dryad remembers something it was told to forget.
 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const store = new Store(home);
  await store.init();
  const workspace = new Workspace(store, new GitService());
  const watchers = { addSessionWatch() {}, removeSessionWatch() {} } as unknown as WatcherManager;
  const broadcasts: ServerEvent[] = [];
  const hub = {
    broadcast(event: ServerEvent) {
      broadcasts.push(event);
    },
  } as unknown as WsHub;

  const sessions = new SessionManager(store, workspace, watchers, hub);

  /** A dryad that has already had a conversation, as the server would have left it. */
  const seed = async (worktreeId = WORKTREE, id = "sess-1") => {
    await store.upsertSession({
      id,
      worktreeId,
      worktreePath: "/tmp/nowhere",
      repoId: "repo-1",
      sdkSessionId: "sdk-abc",
      totalCostUsd: 1.25,
      totalTokens: 4200,
      createdAt: new Date().toISOString(),
    });
    await writeFile(
      store.transcriptPath(id),
      `${JSON.stringify({ kind: "user-prompt", text: "hello", at: "now" })}\n`,
      "utf8",
    );
    return id;
  };

  return { store, sessions, broadcasts, seed };
}

describe("clearing a dryad", () => {
  let ctx: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    ctx = await harness();
  });

  it("forgets the session record, so the next prompt cannot resume into it", async () => {
    const id = await ctx.seed();
    expect(ctx.store.sessions.find((s) => s.id === id)?.sdkSessionId).toBe("sdk-abc");

    await ctx.sessions.clearSession(WORKTREE);

    expect(ctx.store.sessions.find((s) => s.worktreeId === WORKTREE)).toBeUndefined();
  });

  it("deletes the transcript from disk", async () => {
    const id = await ctx.seed();
    await ctx.sessions.clearSession(WORKTREE);

    expect(await ctx.sessions.transcript(WORKTREE)).toEqual([]);
    await expect(readFile(ctx.store.transcriptPath(id), "utf8")).rejects.toThrow();
  });

  it("survives a reload of the registry", async () => {
    await ctx.seed();
    await ctx.sessions.clearSession(WORKTREE);

    const reopened = new Store(ctx.store.baseDir);
    await reopened.init();
    expect(reopened.sessions.find((s) => s.worktreeId === WORKTREE)).toBeUndefined();
  });

  it("tells every open pane, not just the one that asked", async () => {
    await ctx.seed();
    await ctx.sessions.clearSession(WORKTREE);

    expect(ctx.broadcasts).toContainEqual({ type: "agent.cleared", worktreeId: WORKTREE });
  });

  it("leaves other dryads alone", async () => {
    await ctx.seed();
    await ctx.seed("other-worktree", "sess-2");

    await ctx.sessions.clearSession(WORKTREE);

    expect(ctx.store.sessions.map((s) => s.id)).toEqual(["sess-2"]);
    expect(await ctx.sessions.transcript("other-worktree")).toHaveLength(1);
  });

  it("is idempotent — clearing a dryad that never spoke is not an error", async () => {
    await expect(ctx.sessions.clearSession("never-used")).resolves.toEqual({ ok: true });
  });

  it("refuses while a turn is in flight", async () => {
    // Forgetting mid-turn would leave a query writing into a session that no
    // longer exists; you are asked to stop it first.
    const inner = ctx.sessions as unknown as {
      sessions: Map<string, unknown>;
      byWorktree: Map<string, string>;
    };
    await ctx.seed();
    inner.sessions.set("sess-1", {
      info: { id: "sess-1", worktreeId: WORKTREE, status: "running" },
      watch: [],
      q: null,
      loopDone: null,
      cleared: false,
    });
    inner.byWorktree.set(WORKTREE, "sess-1");

    await expect(ctx.sessions.clearSession(WORKTREE)).rejects.toThrow(/Stop the current turn/);
    expect(ctx.store.sessions.find((s) => s.worktreeId === WORKTREE)).toBeDefined();
  });
});
