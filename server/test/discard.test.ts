import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitService } from "../src/services/git.js";
import { GitOps } from "../src/services/gitOps.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";

/**
 * Discard is the one operation in Sylva with nothing behind it, so it is the
 * one that most needs holding to exactly what it claims: put tracked files
 * back, delete untracked ones, and leave ignored files completely alone.
 *
 * That last one matters more than it sounds. `git clean` will happily take
 * node_modules and your .env with the right flag, and a "discard my changes"
 * that costs you a reinstall is not the operation anybody asked for.
 */
async function repo() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  const workspace = new Workspace(store, git);
  const gitOps = new GitOps(git, workspace);
  const created = await workspace.createRepo(parent, "orchard");
  const worktrees = await workspace.listWorktrees(created.id);
  const main = worktrees.find((w) => w.isMain);
  if (!main) throw new Error("no main worktree");

  // A committed file to change, and an ignore rule to respect.
  await writeFile(join(main.path, "tracked.txt"), "committed\n");
  await writeFile(join(main.path, ".gitignore"), "secret.env\n");
  await git.run(main.path, ["add", "-A"]);
  await git.run(main.path, ["commit", "-q", "-m", "seed"]);

  return { gitOps, git, path: main.path, id: main.id };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("discarding changes", () => {
  it("puts a tracked file back to its last commit", async () => {
    const { gitOps, path, id } = await repo();
    await writeFile(join(path, "tracked.txt"), "scribbled over\n");

    await gitOps.discard(id, ["tracked.txt"]);

    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("committed\n");
  });

  it("puts a file back even when the change was staged", async () => {
    const { gitOps, git, path, id } = await repo();
    await writeFile(join(path, "tracked.txt"), "scribbled over\n");
    await git.run(path, ["add", "tracked.txt"]);

    await gitOps.discard(id, ["tracked.txt"]);

    // Not merely unstaged: reverted. Leaving it staged-and-reverted would be a
    // state nobody asked for.
    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("committed\n");
    const { stdout } = await git.run(path, ["status", "--porcelain"]);
    expect(stdout.trim()).toBe("");
  });

  it("deletes an untracked file, which restore has never heard of", async () => {
    const { gitOps, path, id } = await repo();
    await writeFile(join(path, "scratch.txt"), "notes\n");

    await gitOps.discard(id, ["scratch.txt"]);

    expect(await exists(join(path, "scratch.txt"))).toBe(false);
  });

  it("takes tracked and untracked in one go", async () => {
    const { gitOps, path, id } = await repo();
    await writeFile(join(path, "tracked.txt"), "scribbled over\n");
    await writeFile(join(path, "scratch.txt"), "notes\n");

    // One call with both kinds: asking git to restore an untracked path fails
    // the whole command, so they have to be told apart first.
    await gitOps.discard(id, ["tracked.txt", "scratch.txt"]);

    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("committed\n");
    expect(await exists(join(path, "scratch.txt"))).toBe(false);
  });

  it("clears the whole worktree when asked for all", async () => {
    const { gitOps, git, path, id } = await repo();
    await writeFile(join(path, "tracked.txt"), "scribbled over\n");
    await writeFile(join(path, "scratch.txt"), "notes\n");
    await git.run(path, ["add", "tracked.txt"]);

    await gitOps.discard(id, "all");

    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("committed\n");
    expect(await exists(join(path, "scratch.txt"))).toBe(false);
    const { stdout } = await git.run(path, ["status", "--porcelain"]);
    expect(stdout.trim()).toBe("");
  });

  it("leaves ignored files alone", async () => {
    const { gitOps, path, id } = await repo();
    await writeFile(join(path, "secret.env"), "TOKEN=keep-me\n");
    await writeFile(join(path, "tracked.txt"), "scribbled over\n");

    await gitOps.discard(id, "all");

    // The whole point: discarding your work must not cost you your setup.
    expect(await readFile(join(path, "secret.env"), "utf8")).toBe("TOKEN=keep-me\n");
  });

  it("refuses an empty list rather than taking it as everything", async () => {
    const { gitOps, path, id } = await repo();
    await writeFile(join(path, "tracked.txt"), "scribbled over\n");

    await expect(gitOps.discard(id, [])).rejects.toThrow();

    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("scribbled over\n");
    await rm(join(path, "tracked.txt"), { force: true });
  });
});
