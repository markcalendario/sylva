import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/services/git.js";
import { GitOps } from "../src/services/gitOps.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";

/**
 * One message across several worktrees. The interesting case is the partial
 * one: git has no cross-repository transaction, so the result has to say what
 * actually landed rather than pretending it was all or nothing.
 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  const workspace = new Workspace(store, git);
  const gitOps = new GitOps(git, workspace);

  const made = [];
  for (const name of ["old-system", "new-system"]) {
    const repo = await workspace.createRepo(parent, name);
    const [worktree] = await workspace.listWorktrees(repo.id);
    if (!worktree) throw new Error("no worktree");
    made.push(worktree);
  }
  const [oldWt, newWt] = made;
  if (!oldWt || !newWt) throw new Error("missing worktrees");
  return { git, gitOps, oldWt, newWt };
}

/** Stage a change so the worktree has something to commit. */
async function stage(git: GitService, path: string, name: string, body: string) {
  await writeFile(join(path, name), body);
  await git.run(path, ["add", name]);
}

describe("committing across worktrees", () => {
  let ctx: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    ctx = await harness();
  });

  it("commits the same message in each", async () => {
    await stage(ctx.git, ctx.oldWt.path, "a.txt", "old\n");
    await stage(ctx.git, ctx.newWt.path, "b.txt", "new\n");

    const { results } = await ctx.gitOps.commitMany(
      [ctx.oldWt.id, ctx.newWt.id],
      "Rename the widget everywhere",
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(2);
    for (const wt of [ctx.oldWt, ctx.newWt]) {
      const { stdout } = await ctx.git.run(wt.path, ["log", "-1", "--format=%s"]);
      expect(stdout.trim()).toBe("Rename the widget everywhere");
    }
  });

  it("says which landed when one worktree refuses", async () => {
    await stage(ctx.git, ctx.oldWt.path, "a.txt", "old\n");
    // Nothing staged in the second, so its commit is rejected.
    const { results } = await ctx.gitOps.commitMany(
      [ctx.oldWt.id, ctx.newWt.id],
      "Half a change",
    );

    const landed = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(landed.map((r) => r.worktreeId)).toEqual([ctx.oldWt.id]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toMatch(/nothing staged/i);
    // The one that worked is real work and must not be rolled back.
    expect(landed[0]?.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("keeps going past a failure rather than abandoning the rest", async () => {
    // First fails, second succeeds: order must not decide who gets committed.
    await stage(ctx.git, ctx.newWt.path, "b.txt", "new\n");
    const { results } = await ctx.gitOps.commitMany(
      [ctx.oldWt.id, ctx.newWt.id],
      "Second one only",
    );

    expect(results[0]?.ok).toBe(false);
    expect(results[1]?.ok).toBe(true);
  });

  it("reports a hook rejection in git's own words", async () => {
    const hook = join(ctx.oldWt.path, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'the orchard says no' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    await stage(ctx.git, ctx.oldWt.path, "a.txt", "old\n");
    await stage(ctx.git, ctx.newWt.path, "b.txt", "new\n");

    const { results } = await ctx.gitOps.commitMany(
      [ctx.oldWt.id, ctx.newWt.id],
      "Blocked in one",
    );

    const failed = results.find((r) => !r.ok);
    expect(failed?.worktreeId).toBe(ctx.oldWt.id);
    expect(failed?.error).toContain("the orchard says no");
    expect(results.find((r) => r.ok)?.worktreeId).toBe(ctx.newWt.id);
  });

  it("refuses an empty message before touching anything", async () => {
    await stage(ctx.git, ctx.oldWt.path, "a.txt", "old\n");
    await expect(ctx.gitOps.commitMany([ctx.oldWt.id], "   ")).rejects.toThrow(/must not be empty/i);
    // Still staged, still uncommitted.
    const status = await ctx.gitOps.status(ctx.oldWt.id);
    expect(status.staged).toHaveLength(1);
  });
});
