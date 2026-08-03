import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/services/git.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";

/**
 * Env files are gitignored, so `git worktree add` leaves them behind and the
 * new tree checks out unable to run. These cover the copy that fixes that, and
 * the two things it must never do: overwrite what the checkout brought, and
 * take the worktree down with it when a file can't be read.
 */
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  const workspace = new Workspace(store, git);
  const repo = await workspace.createRepo(parent, "orchard");
  return { workspace, store, git, repo };
}

/** Write a file, creating whatever directories it needs. */
async function put(root: string, relative: string, body: string) {
  const path = join(root, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, "utf8");
  return path;
}

describe("carrying env files into a new worktree", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
    await put(ctx.repo.path, ".gitignore", ".env*\nnode_modules/\n");
    await ctx.git.runExclusive(ctx.repo.path, ["add", ".gitignore"]);
    await ctx.git.runExclusive(ctx.repo.path, ["commit", "-m", "Ignore env files"]);
  });

  const grow = (branch: string) =>
    ctx.workspace.createWorktree(ctx.repo.id, { branch, baseRef: "main" });

  it("copies the root env file, which git would have left behind", async () => {
    await put(ctx.repo.path, ".env", "TOKEN=hunter2\n");

    const { worktree, copiedEnvFiles } = await grow("feature/one");

    expect(copiedEnvFiles).toEqual([".env"]);
    expect(await readFile(join(worktree.path, ".env"), "utf8")).toBe("TOKEN=hunter2\n");
  });

  it("reaches into subdirectories, so a monorepo gets one per package", async () => {
    await put(ctx.repo.path, ".env", "ROOT=1\n");
    await put(ctx.repo.path, "apps/web/.env.local", "WEB=1\n");
    await put(ctx.repo.path, "apps/api/.env.production", "API=1\n");

    const { worktree, copiedEnvFiles } = await grow("feature/two");

    expect(copiedEnvFiles).toEqual([
      ".env",
      "apps/api/.env.production",
      "apps/web/.env.local",
    ]);
    expect(await readFile(join(worktree.path, "apps/web/.env.local"), "utf8")).toBe("WEB=1\n");
  });

  it("never walks into an ignored directory", async () => {
    // The directory is ignored wholesale, so git collapses it to one entry and
    // the scan cannot descend — which is what keeps node_modules from being
    // read file by file in a real repository.
    await put(ctx.repo.path, "node_modules/some-package/.env", "NOPE=1\n");

    const { copiedEnvFiles } = await grow("feature/three");

    expect(copiedEnvFiles).toEqual([]);
  });

  it("leaves tracked files alone rather than overwriting the checkout", async () => {
    // .env.example is committed, so the new worktree already has the version
    // that branch means. The main worktree's edited copy must not replace it.
    await put(ctx.repo.path, ".env.example", "TOKEN=\n");
    await ctx.git.runExclusive(ctx.repo.path, ["add", "-f", ".env.example"]);
    await ctx.git.runExclusive(ctx.repo.path, ["commit", "-m", "Add an example"]);
    await put(ctx.repo.path, ".env.example", "LOCALLY EDITED\n");

    const { worktree, copiedEnvFiles } = await grow("feature/four");

    expect(copiedEnvFiles).toEqual([]);
    expect(await readFile(join(worktree.path, ".env.example"), "utf8")).toBe("TOKEN=\n");
  });

  it("ignores files that only look like env files", async () => {
    await put(ctx.repo.path, "environment.ts", "export const env = {};\n");
    await put(ctx.repo.path, "src/env.local", "not one either\n");

    const { copiedEnvFiles } = await grow("feature/five");

    expect(copiedEnvFiles).toEqual([]);
  });

  it("keeps the file's own permissions, so a 0600 secret stays one", async () => {
    const source = await put(ctx.repo.path, ".env", "TOKEN=hunter2\n");
    await chmod(source, 0o600);

    const { worktree } = await grow("feature/six");

    const mode = (await stat(join(worktree.path, ".env"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("does nothing when the preference is off", async () => {
    await put(ctx.repo.path, ".env", "TOKEN=hunter2\n");
    await ctx.store.setPreferences({ ...ctx.store.preferences, copyEnvFiles: false });

    const { worktree, copiedEnvFiles } = await grow("feature/seven");

    expect(copiedEnvFiles).toEqual([]);
    await expect(stat(join(worktree.path, ".env"))).rejects.toThrow();
  });

  it("copies by default, without anything having been configured", async () => {
    expect(ctx.store.preferences.copyEnvFiles).toBe(true);
  });

  it("still grows the worktree when a file can't be read", async () => {
    const source = await put(ctx.repo.path, ".env", "TOKEN=hunter2\n");
    await chmod(source, 0o000);

    // The worktree is the thing being asked for. An unreadable env file is a
    // file to skip, not a reason to hand back a failure for work that is done.
    const { worktree, copiedEnvFiles } = await grow("feature/eight");

    expect(worktree.branch).toBe("feature/eight");
    expect(copiedEnvFiles).toEqual([]);
    await chmod(source, 0o600);
  });
});
