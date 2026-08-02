import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { circleId, GROVE_ID } from "sylva-shared";
import { GitService } from "../src/services/git.js";
import { SessionManager } from "../src/services/sessions.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";
import type { WatcherManager } from "../src/services/watcher.js";
import type { WsHub } from "../src/ws/hub.js";

interface Target {
  id: string;
  cwd: string;
  label: string | null;
  extraDirs: string[];
  watch: { worktreeId: string; path: string }[];
  brief: string | null;
}

/**
 * What a circle hands the SDK is the whole feature: the wrong cwd or a missing
 * additional directory and the dryad simply cannot see the other worktree.
 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  const workspace = new Workspace(store, git);
  const watchers = { addSessionWatch() {}, removeSessionWatch() {} } as unknown as WatcherManager;
  const hub = { broadcast() {} } as unknown as WsHub;

  const oldRepo = await workspace.createRepo(parent, "old-system");
  const newRepo = await workspace.createRepo(parent, "new-system");
  const [oldWt] = await workspace.listWorktrees(oldRepo.id);
  const [newWt] = await workspace.listWorktrees(newRepo.id);
  if (!oldWt || !newWt) throw new Error("worktrees missing");

  const sessions = new SessionManager(store, workspace, watchers, hub);
  const resolve = (id: string): Promise<Target> =>
    (sessions as unknown as { resolveTarget: (id: string) => Promise<Target> }).resolveTarget(id);

  return { resolve, oldWt, newWt };
}

describe("resolving a circle", () => {
  let ctx: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    ctx = await harness();
  });

  it("gives the dryad every worktree in the circle", async () => {
    const target = await ctx.resolve(circleId([ctx.oldWt.id, ctx.newWt.id]));

    // One is the working directory; the rest have to be handed over explicitly
    // or they are invisible to the agent, which is the entire point.
    const reachable = [target.cwd, ...target.extraDirs].sort();
    expect(reachable).toEqual([ctx.oldWt.path, ctx.newWt.path].sort());
    expect(target.extraDirs).toHaveLength(1);
  });

  it("watches every member, not only the working directory", async () => {
    const target = await ctx.resolve(circleId([ctx.oldWt.id, ctx.newWt.id]));
    expect(target.watch.map((w) => w.worktreeId).sort()).toEqual(
      [ctx.oldWt.id, ctx.newWt.id].sort(),
    );
  });

  it("tells the agent where everything is", async () => {
    const target = await ctx.resolve(circleId([ctx.oldWt.id, ctx.newWt.id]));
    expect(target.brief).toContain(ctx.oldWt.path);
    expect(target.brief).toContain(ctx.newWt.path);
    expect(target.brief).toContain("old-system");
    expect(target.brief).toContain("new-system");
  });

  it("labels itself with both branches", async () => {
    const target = await ctx.resolve(circleId([ctx.oldWt.id, ctx.newWt.id]));
    expect(target.label).toContain("main");
    expect(target.label).toContain("+");
  });

  it("refuses a circle naming a worktree that isn't there", async () => {
    await expect(ctx.resolve(circleId([ctx.oldWt.id, "deadbeefdead"]))).rejects.toThrow(/not found/);
  });

  it("still resolves a plain worktree with nothing extra attached", async () => {
    const target = await ctx.resolve(ctx.oldWt.id);
    expect(target.cwd).toBe(ctx.oldWt.path);
    expect(target.extraDirs).toEqual([]);
    expect(target.brief).toBeNull();
    expect(target.watch).toEqual([{ worktreeId: ctx.oldWt.id, path: ctx.oldWt.path }]);
  });

  it("still resolves the grove, watching nothing", async () => {
    const target = await ctx.resolve(GROVE_ID);
    expect(target.extraDirs).toEqual([]);
    expect(target.watch).toEqual([]);
    expect(target.brief).toContain("grove");
  });
});
