import { mkdtemp, writeFile } from "node:fs/promises";
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
 * Committing left every dirty count in the app stale until something else
 * touched the working tree, or you reloaded the page.
 *
 * The cause was that the watcher's only window into `.git` was HEAD, and a
 * commit does not touch HEAD — it rewrites the index and moves a branch ref
 * that, for a linked worktree, doesn't even live in this directory. These
 * drive real commits and stages and watch for the status that follows.
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

/** Whether a status lists a path, in whichever of its three lists. */
function lists(files: { path: string }[] | undefined, path: string): boolean {
  return (files ?? []).some((f) => f.path === path);
}

/** The last status broadcast, which is the one the app would be showing. */
function latestStatus(events: ServerEvent[]) {
  const statuses = events.filter(
    (e): e is Extract<ServerEvent, { type: "git.status" }> => e.type === "git.status",
  );
  return statuses[statuses.length - 1]?.status;
}

describe("a commit reaches the counts", () => {
  let ctx: Awaited<ReturnType<typeof harness>> | null = null;

  afterEach(async () => {
    await ctx?.watchers.closeAll();
    ctx = null;
  }, 20000);

  it("says the worktree is clean once the change is committed", async () => {
    ctx = await harness();
    const { git, watchers, events, worktree } = ctx;
    watchers.setWatched([{ worktreeId: worktree.id, path: worktree.path }]);
    await new Promise((r) => setTimeout(r, 300));

    await writeFile(join(worktree.path, "leaf.txt"), "green\n");
    await until(events, (l) =>
      l.some((e) => e.type === "git.status" && lists(e.status.untracked, "leaf.txt")),
    );

    // Committing touches no file in the working tree at all: this is the case
    // the old watcher was blind to.
    await git.run(worktree.path, ["add", "leaf.txt"]);
    await git.run(worktree.path, ["commit", "-q", "-m", "add a leaf"]);

    await until(events, (l) => {
      const status = latestStatus(l);
      return (
        status !== undefined &&
        status.untracked.length === 0 &&
        status.staged.length === 0 &&
        status.unstaged.length === 0
      );
    });
  }, 20000);

  it("says a file moved to staged when it is added", async () => {
    ctx = await harness();
    const { git, watchers, events, worktree } = ctx;
    watchers.setWatched([{ worktreeId: worktree.id, path: worktree.path }]);
    await new Promise((r) => setTimeout(r, 300));

    await writeFile(join(worktree.path, "root.txt"), "deep\n");
    await until(events, (l) =>
      l.some((e) => e.type === "git.status" && lists(e.status.untracked, "root.txt")),
    );

    await git.run(worktree.path, ["add", "root.txt"]);

    await until(events, (l) => {
      const status = latestStatus(l);
      return status !== undefined && lists(status.staged, "root.txt");
    });
  }, 20000);

  it("says nothing about a worktree nobody is watching", async () => {
    ctx = await harness();
    const { git, watchers, events, worktree } = ctx;
    watchers.setWatched([{ worktreeId: worktree.id, path: worktree.path }]);
    await new Promise((r) => setTimeout(r, 300));

    watchers.setWatched([]);
    events.length = 0;

    await writeFile(join(worktree.path, "quiet.txt"), "shh\n");
    await git.run(worktree.path, ["add", "quiet.txt"]);
    await git.run(worktree.path, ["commit", "-q", "-m", "quietly"]);
    await new Promise((r) => setTimeout(r, 600));

    expect(events).toEqual([]);
  }, 20000);
});
