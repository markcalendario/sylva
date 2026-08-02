import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerEvent } from "sylva-shared";
import { GitService } from "../src/services/git.js";
import { GitOps } from "../src/services/gitOps.js";
import { Store } from "../src/services/store.js";
import { WatcherManager } from "../src/services/watcher.js";
import { Workspace } from "../src/services/workspace.js";
import type { WsHub } from "../src/ws/hub.js";

/**
 * A branch switch used to need a page reload. The watcher deliberately ignores
 * `.git`, so a checkout was invisible — these drive a real one.
 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  const workspace = new Workspace(store, git);
  const gitOps = new GitOps(git, workspace);

  const events: ServerEvent[] = [];
  const hub = { broadcast: (e: ServerEvent) => events.push(e) } as unknown as WsHub;
  const watchers = new WatcherManager(hub, gitOps);

  const repo = await workspace.createRepo(parent, "orchard");
  const [worktree] = await workspace.listWorktrees(repo.id);
  if (!worktree) throw new Error("no worktree");

  return { git, watchers, events, worktree };
}

/** Wait for a predicate over the events, or give up. */
async function until(
  events: ServerEvent[],
  predicate: (e: ServerEvent[]) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(events)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for the expected events");
}

describe("watching HEAD", () => {
  let ctx: Awaited<ReturnType<typeof harness>> | null = null;

  afterEach(async () => {
    await ctx?.watchers.closeAll();
    ctx = null;
  });

  it("reports a checkout without anything else happening", async () => {
    ctx = await harness();
    const { git, watchers, events, worktree } = ctx;
    watchers.setWatched([{ worktreeId: worktree.id, path: worktree.path }]);
    // Give the watch a moment to attach before moving HEAD under it.
    await new Promise((r) => setTimeout(r, 300));

    await git.run(worktree.path, ["checkout", "-q", "-b", "feature/rename"]);

    await until(events, (list) =>
      list.some((e) => e.type === "git.status" && e.status.branch === "feature/rename"),
    );
    // The branch *name* is carried by the worktree list, which is fetched — so
    // the client also has to be told that list is stale.
    expect(events.some((e) => e.type === "worktrees.changed")).toBe(true);
  });

  it("reports switching back again", async () => {
    ctx = await harness();
    const { git, watchers, events, worktree } = ctx;
    watchers.setWatched([{ worktreeId: worktree.id, path: worktree.path }]);
    await new Promise((r) => setTimeout(r, 300));

    await git.run(worktree.path, ["checkout", "-q", "-b", "feature/rename"]);
    await until(events, (l) =>
      l.some((e) => e.type === "git.status" && e.status.branch === "feature/rename"),
    );

    await git.run(worktree.path, ["checkout", "-q", "main"]);
    await until(events, (l) =>
      l.some((e) => e.type === "git.status" && e.status.branch === "main"),
    );
  });

  it("stops listening once the worktree is closed", async () => {
    ctx = await harness();
    const { git, watchers, events, worktree } = ctx;
    watchers.setWatched([{ worktreeId: worktree.id, path: worktree.path }]);
    await new Promise((r) => setTimeout(r, 300));

    watchers.setWatched([]);
    events.length = 0;

    await git.run(worktree.path, ["checkout", "-q", "-b", "feature/quiet"]);
    await new Promise((r) => setTimeout(r, 600));
    // Nothing is watching this worktree any more, so nothing should be said
    // about it — a leaked watcher would keep broadcasting forever.
    expect(events).toEqual([]);
  });
});
