import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/services/git.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";

/**
 * Growing a worktree from what the remote has, rather than from what this
 * machine last happened to fetch.
 *
 * Driven against real repositories — a bare origin and two clones — because
 * every interesting case here is about what git does with refs, and a fake git
 * would only be a restatement of what this code already believes.
 */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "sylva-remote-"));
  const git = new GitService();

  const origin = join(root, "origin.git");
  await git.run(root, ["init", "--bare", "--initial-branch=main", origin]);

  /** A clone with an identity, ready to commit. */
  const clone = async (name: string) => {
    const path = join(root, name);
    await git.run(root, ["clone", origin, path]);
    await git.run(path, ["config", "user.email", "test@example.com"]);
    await git.run(path, ["config", "user.name", "Test"]);
    return path;
  };

  /** Commit a file and push it, as somebody else would have. */
  const commitAndPush = async (path: string, file: string, branch = "main") => {
    await writeFile(join(path, file), file, "utf8");
    await git.run(path, ["add", file]);
    await git.run(path, ["commit", "-m", `Add ${file}`]);
    await git.run(path, ["push", "origin", `HEAD:${branch}`]);
  };

  // Someone else's clone seeds main, so ours has something to clone from.
  const theirs = await clone("theirs");
  await commitAndPush(theirs, "first.txt");

  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const store = new Store(home);
  await store.init();
  const workspace = new Workspace(store, git);

  const ours = await clone("ours");
  const repo = await workspace.registerRepo(ours);

  return { git, store, workspace, repo, theirs, commitAndPush, clone };
}

/** Does this ref's history contain that file? */
async function has(git: GitService, cwd: string, ref: string, file: string): Promise<boolean> {
  return git.run(cwd, ["cat-file", "-e", `${ref}:${file}`]).then(
    () => true,
    () => false,
  );
}

describe("fetching before a worktree is grown", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  it("starts a new branch from what the remote has, not the stale local base", async () => {
    // Pushed after our clone, so `main` here knows nothing about it.
    await ctx.commitAndPush(ctx.theirs, "later.txt");

    const created = await ctx.workspace.createWorktree(ctx.repo.id, {
      branch: "feature/fresh",
      baseRef: "main",
      pull: true,
    });

    expect(created.pull).toEqual({
      fetched: true,
      basedOn: "origin/main",
      fastForwarded: null,
    });
    expect(await has(ctx.git, created.worktree.path, "HEAD", "later.txt")).toBe(true);
  });

  it("leaves the base alone when it wasn't asked to pull", async () => {
    await ctx.commitAndPush(ctx.theirs, "later.txt");

    const created = await ctx.workspace.createWorktree(ctx.repo.id, {
      branch: "feature/stale",
      baseRef: "main",
      pull: false,
    });

    expect(created.pull).toBeNull();
    expect(await has(ctx.git, created.worktree.path, "HEAD", "later.txt")).toBe(false);
  });

  it("catches an existing branch up to its upstream before checking it out", async () => {
    // A branch that exists here and has since moved on the remote.
    await ctx.git.run(ctx.theirs, ["push", "origin", "HEAD:refs/heads/topic"]);
    await ctx.git.run(ctx.repo.path, ["fetch"]);
    await ctx.git.run(ctx.repo.path, ["branch", "--track", "topic", "origin/topic"]);
    await ctx.git.run(ctx.theirs, ["checkout", "-B", "topic", "origin/topic"]);
    await ctx.commitAndPush(ctx.theirs, "ahead.txt", "topic");

    const created = await ctx.workspace.createWorktree(ctx.repo.id, {
      branch: "topic",
      pull: true,
    });

    expect(created.pull?.fastForwarded).toBe("topic");
    expect(await has(ctx.git, created.worktree.path, "HEAD", "ahead.txt")).toBe(true);
  });

  it("won't move a branch that has commits of its own", async () => {
    await ctx.git.run(ctx.theirs, ["push", "origin", "HEAD:refs/heads/topic"]);
    await ctx.git.run(ctx.repo.path, ["fetch"]);
    await ctx.git.run(ctx.repo.path, ["branch", "--track", "topic", "origin/topic"]);

    // Ours goes one way…
    await ctx.git.run(ctx.repo.path, ["checkout", "topic"]);
    await ctx.git.run(ctx.repo.path, ["config", "user.email", "test@example.com"]);
    await ctx.git.run(ctx.repo.path, ["config", "user.name", "Test"]);
    await writeFile(join(ctx.repo.path, "mine.txt"), "mine", "utf8");
    await ctx.git.run(ctx.repo.path, ["add", "mine.txt"]);
    await ctx.git.run(ctx.repo.path, ["commit", "-m", "Mine"]);
    const before = await ctx.git.run(ctx.repo.path, ["rev-parse", "topic"]);
    await ctx.git.run(ctx.repo.path, ["checkout", "main"]);

    // …and theirs the other.
    await ctx.git.run(ctx.theirs, ["checkout", "-B", "topic", "origin/topic"]);
    await ctx.commitAndPush(ctx.theirs, "theirs.txt", "topic");

    const created = await ctx.workspace.createWorktree(ctx.repo.id, {
      branch: "topic",
      pull: true,
    });

    expect(created.pull?.fastForwarded).toBeNull();
    const after = await ctx.git.run(ctx.repo.path, ["rev-parse", "topic"]);
    expect(after.stdout.trim()).toBe(before.stdout.trim());
    expect(await has(ctx.git, created.worktree.path, "HEAD", "mine.txt")).toBe(true);
  });

  it("does nothing, and complains about nothing, in a repository with no remote", async () => {
    const parent = await mkdtemp(join(tmpdir(), "sylva-local-"));
    const local = await ctx.workspace.createRepo(parent, "alone");
    await writeFile(join(local.path, "a.txt"), "a", "utf8");
    await ctx.git.run(local.path, ["add", "a.txt"]);
    await ctx.git.run(local.path, ["commit", "-m", "First"]);

    const created = await ctx.workspace.createWorktree(local.id, {
      branch: "feature/one",
      baseRef: "HEAD",
      pull: true,
    });

    expect(created.pull).toEqual({ fetched: false, basedOn: null, fastForwarded: null });
    expect(created.worktree.branch).toBe("feature/one");
  });

  it("refuses rather than cutting a stale tree when the fetch fails", async () => {
    await ctx.git.run(ctx.repo.path, [
      "remote",
      "set-url",
      "origin",
      join(tmpdir(), "sylva-nowhere-at-all.git"),
    ]);

    await expect(
      ctx.workspace.createWorktree(ctx.repo.id, {
        branch: "feature/doomed",
        baseRef: "main",
        pull: true,
      }),
    ).rejects.toThrow(/Couldn't fetch/);

    // Nothing half-made: the worktree list is exactly what it was.
    const worktrees = await ctx.workspace.listWorktrees(ctx.repo.id);
    expect(worktrees.map((w) => w.branch)).not.toContain("feature/doomed");
  });
});
