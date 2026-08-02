import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/services/git.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";

async function workspace() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  return { workspace: new Workspace(store, git), parent, git };
}

describe("creating a repository", () => {
  let ctx: Awaited<ReturnType<typeof workspace>>;

  beforeEach(async () => {
    ctx = await workspace();
  });

  it("creates, initializes and registers it in one step", async () => {
    const repo = await ctx.workspace.createRepo(ctx.parent, "orchard");

    expect(repo.name).toBe("orchard");
    expect(repo.path).toBe(join(ctx.parent, "orchard"));
    expect(repo.available).toBe(true);
    expect(await ctx.workspace.listRepos()).toHaveLength(1);
    expect(await readFile(join(repo.path, "README.md"), "utf8")).toContain("# orchard");
  });

  it("leaves HEAD born, so a worktree can be grown immediately", async () => {
    const repo = await ctx.workspace.createRepo(ctx.parent, "orchard");

    // This is the whole reason for the initial commit: `git worktree add`
    // refuses to work against an unborn HEAD.
    const worktree = await ctx.workspace.createWorktree(repo.id, {
      branch: "feature/first",
      baseRef: "main",
    });
    expect(worktree.branch).toBe("feature/first");
  });

  it("defaults the branch to main", async () => {
    const repo = await ctx.workspace.createRepo(ctx.parent, "orchard");
    const { stdout } = await ctx.git.run(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(stdout.trim()).toBe("main");
  });

  it("refuses a name that is already taken, changing nothing", async () => {
    await ctx.workspace.createRepo(ctx.parent, "orchard");
    await expect(ctx.workspace.createRepo(ctx.parent, "orchard")).rejects.toThrow(/already exists/);
    expect(await ctx.workspace.listRepos()).toHaveLength(1);
  });

  it("refuses names that would escape the parent directory", async () => {
    for (const name of ["../evil", "a/b", "..", ".", "-force"]) {
      await expect(ctx.workspace.createRepo(ctx.parent, name)).rejects.toThrow();
    }
    // Nothing was created for any of them.
    expect(await readdir(ctx.parent)).toEqual([]);
  });

  it("refuses an empty name", async () => {
    await expect(ctx.workspace.createRepo(ctx.parent, "   ")).rejects.toThrow(/name is required/i);
  });

  it("refuses a parent that does not exist", async () => {
    await expect(
      ctx.workspace.createRepo(join(ctx.parent, "nowhere"), "orchard"),
    ).rejects.toThrow(/does not exist/);
  });

  it("refuses a relative parent path", async () => {
    await expect(ctx.workspace.createRepo("relative/path", "orchard")).rejects.toThrow(
      /must be absolute/,
    );
  });
});
