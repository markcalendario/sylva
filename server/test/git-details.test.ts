import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/services/git.js";
import { GitOps } from "../src/services/gitOps.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";

/** A real repository — the log format and the walk are the things under test. */
async function repo() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const parent = await mkdtemp(join(tmpdir(), "sylva-repos-"));
  const store = new Store(home);
  await store.init();
  const git = new GitService();
  const workspace = new Workspace(store, git);
  const gitOps = new GitOps(git, workspace);
  const created = await workspace.createRepo(parent, "orchard");
  return { gitOps, git, repo: created, path: created.path };
}

/** Worktree ids are hashes of the real path, so ask the workspace for it. */
async function mainWorktreeId(gitOps: GitOps, repoId: string): Promise<string> {
  const workspace = (gitOps as unknown as { workspace: Workspace }).workspace;
  const worktrees = await workspace.listWorktrees(repoId);
  const main = worktrees.find((w) => w.isMain);
  if (!main) throw new Error("no main worktree");
  return main.id;
}

describe("commit details", () => {
  let ctx: Awaited<ReturnType<typeof repo>>;
  let worktreeId: string;

  beforeEach(async () => {
    ctx = await repo();
    worktreeId = await mainWorktreeId(ctx.gitOps, ctx.repo.id);
  });

  it("carries author, committer, dates, body and diffstat", async () => {
    await writeFile(join(ctx.path, "a.txt"), "one\ntwo\nthree\n");
    await ctx.git.run(ctx.path, ["add", "a.txt"]);
    await ctx.git.run(ctx.path, [
      "commit",
      "-m",
      "Add a file\n\nWith a body that explains why.\nOver two lines.",
    ]);

    const graph = await ctx.gitOps.graph(worktreeId);
    const commit = [...graph.common, ...graph.ahead].find((c) => c.subject === "Add a file");

    expect(commit).toBeDefined();
    expect(commit?.body).toBe("With a body that explains why.\nOver two lines.");
    expect(commit?.author).toBeTruthy();
    expect(commit?.authorEmail).toContain("@");
    // ISO 8601, not a relative phrase.
    expect(commit?.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(commit?.committer).toBeTruthy();
    expect(commit?.committerDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(commit?.stats).toEqual({ files: 1, insertions: 3, deletions: 0 });
  });

  it("reports an empty body for a subject-only commit", async () => {
    await writeFile(join(ctx.path, "b.txt"), "x\n");
    await ctx.git.run(ctx.path, ["add", "b.txt"]);
    await ctx.git.run(ctx.path, ["commit", "-m", "Just a subject"]);

    const graph = await ctx.gitOps.graph(worktreeId);
    const commit = graph.common.find((c) => c.subject === "Just a subject");
    expect(commit?.body).toBe("");
    expect(commit?.stats).toEqual({ files: 1, insertions: 1, deletions: 0 });
  });

  it("does not lose or merge commits whose messages contain the field delimiter", async () => {
    await writeFile(join(ctx.path, "c.txt"), "x\n");
    await ctx.git.run(ctx.path, ["add", "c.txt"]);
    await ctx.git.run(ctx.path, ["commit", "-m", "Handle \x1f and \x1e in messages"]);
    await writeFile(join(ctx.path, "e.txt"), "y\n");
    await ctx.git.run(ctx.path, ["add", "e.txt"]);
    await ctx.git.run(ctx.path, ["commit", "-m", "A normal one after it"]);

    const graph = await ctx.gitOps.graph(worktreeId);
    // Commits are separated by NUL, which a message cannot contain, so a
    // strange message can blur its own fields but never swallow its neighbour.
    expect(graph.common.every((c) => /^[0-9a-f]{40}$/.test(c.sha))).toBe(true);
    expect(graph.common.map((c) => c.subject)).toContain("A normal one after it");
    expect(graph.common).toHaveLength(new Set(graph.common.map((c) => c.sha)).size);
  });

  it("counts deletions too", async () => {
    await writeFile(join(ctx.path, "d.txt"), "one\ntwo\nthree\n");
    await ctx.git.run(ctx.path, ["add", "d.txt"]);
    await ctx.git.run(ctx.path, ["commit", "-m", "Add three lines"]);
    await writeFile(join(ctx.path, "d.txt"), "one\n");
    await ctx.git.run(ctx.path, ["add", "d.txt"]);
    await ctx.git.run(ctx.path, ["commit", "-m", "Cut it down"]);

    const graph = await ctx.gitOps.graph(worktreeId);
    const commit = graph.common.find((c) => c.subject === "Cut it down");
    expect(commit?.stats).toEqual({ files: 1, insertions: 0, deletions: 2 });
  });
});

describe("what a commit changed", () => {
  let ctx: Awaited<ReturnType<typeof repo>>;
  let worktreeId: string;

  beforeEach(async () => {
    ctx = await repo();
    worktreeId = await mainWorktreeId(ctx.gitOps, ctx.repo.id);
  });

  /** Commit whatever is in the worktree, and answer with the new HEAD. */
  async function commit(message: string): Promise<string> {
    await ctx.git.run(ctx.path, ["add", "--all"]);
    await ctx.git.run(ctx.path, ["commit", "-m", message]);
    const { stdout } = await ctx.git.run(ctx.path, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  it("lists every file, what happened to it, and how much moved", async () => {
    await writeFile(join(ctx.path, "keep.txt"), "one\ntwo\n");
    await writeFile(join(ctx.path, "goes.txt"), "gone\n");
    await commit("Groundwork");

    await writeFile(join(ctx.path, "keep.txt"), "one\ntwo\nthree\n");
    await writeFile(join(ctx.path, "new.txt"), "fresh\n");
    await ctx.git.run(ctx.path, ["rm", "goes.txt"]);
    const sha = await commit("Move some things around");

    const detail = await ctx.gitOps.commitDetail(worktreeId, sha);
    expect(detail.commit.subject).toBe("Move some things around");

    const byPath = new Map(detail.files.map((f) => [f.path, f]));
    expect(byPath.get("keep.txt")).toMatchObject({ kind: "modified", insertions: 1, deletions: 0 });
    expect(byPath.get("new.txt")).toMatchObject({ kind: "added", insertions: 1, deletions: 0 });
    expect(byPath.get("goes.txt")).toMatchObject({ kind: "deleted", insertions: 0, deletions: 1 });
  });

  it("says where a renamed file came from", async () => {
    await writeFile(join(ctx.path, "before.txt"), "a\nb\nc\nd\ne\n");
    await commit("Add it");
    await ctx.git.run(ctx.path, ["mv", "before.txt", "after.txt"]);
    const sha = await commit("Rename it");

    const detail = await ctx.gitOps.commitDetail(worktreeId, sha);
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]).toMatchObject({
      path: "after.txt",
      kind: "renamed",
      renamedFrom: "before.txt",
    });
  });

  it("hands back one file's diff as that commit made it", async () => {
    await writeFile(join(ctx.path, "poem.txt"), "roses\n");
    await commit("First line");
    await writeFile(join(ctx.path, "poem.txt"), "roses\nviolets\n");
    const sha = await commit("Second line");

    const diff = await ctx.gitOps.commitDiff(worktreeId, sha, "poem.txt");
    expect(diff.path).toBe("poem.txt");
    const added = diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === "add");
    expect(added.map((l) => l.content)).toEqual(["violets"]);
  });

  it("refuses anything that isn't a commit id", async () => {
    // The history panel only ever produces object names; a ref or a flag
    // reaching git as a revision is a bug, not a feature.
    await expect(ctx.gitOps.commitDetail(worktreeId, "--upload-pack=touch /tmp/x")).rejects.toThrow(
      /commit id/i,
    );
    await expect(ctx.gitOps.commitDiff(worktreeId, "HEAD", "poem.txt")).rejects.toThrow(
      /commit id/i,
    );
  });
});

describe("file search", () => {
  let ctx: Awaited<ReturnType<typeof repo>>;
  let worktreeId: string;

  beforeEach(async () => {
    ctx = await repo();
    worktreeId = await mainWorktreeId(ctx.gitOps, ctx.repo.id);
    await mkdir(join(ctx.path, "src/components/dialogs"), { recursive: true });
    await mkdir(join(ctx.path, "node_modules/react"), { recursive: true });
    await mkdir(join(ctx.path, "dist"), { recursive: true });
    for (const [path, body] of [
      ["src/components/GitPanel.tsx", "panel"],
      ["src/components/AgentPanel.tsx", "panel"],
      ["src/components/dialogs/AboutDialog.tsx", "dialog"],
      ["src/index.ts", "entry"],
      ["node_modules/react/index.js", "noise"],
      ["dist/index.js", "noise"],
    ] as const) {
      await writeFile(join(ctx.path, path), body);
    }
  });

  it("finds a file by name, case-insensitively", async () => {
    const { results } = await ctx.gitOps.searchFiles(worktreeId, "gitpanel");
    expect(results[0]?.path).toBe("src/components/GitPanel.tsx");
  });

  it("finds files by a path fragment", async () => {
    const { results } = await ctx.gitOps.searchFiles(worktreeId, "components/dial");
    expect(results.map((r) => r.path)).toContain("src/components/dialogs/AboutDialog.tsx");
  });

  it("ranks an exact name above a mere substring", async () => {
    const { results } = await ctx.gitOps.searchFiles(worktreeId, "index.ts");
    expect(results[0]?.path).toBe("src/index.ts");
  });

  it("reaches a name by its scattered letters", async () => {
    const { results } = await ctx.gitOps.searchFiles(worktreeId, "apnl");
    expect(results.map((r) => r.path)).toContain("src/components/AgentPanel.tsx");
  });

  it("skips the directories the watcher ignores", async () => {
    const { results } = await ctx.gitOps.searchFiles(worktreeId, "index");
    const paths = results.map((r) => r.path);
    expect(paths).toContain("src/index.ts");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("dist/"))).toBe(false);
  });

  it("finds a file that git has never seen", async () => {
    await writeFile(join(ctx.path, "src/JustCreated.tsx"), "new");
    const { results } = await ctx.gitOps.searchFiles(worktreeId, "justcreated");
    expect(results[0]?.path).toBe("src/JustCreated.tsx");
  });

  it("returns nothing for an empty query", async () => {
    const { results, truncated } = await ctx.gitOps.searchFiles(worktreeId, "   ");
    expect(results).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("reports when results were capped", async () => {
    const { results, truncated } = await ctx.gitOps.searchFiles(worktreeId, "s", {
      maxResults: 1,
    });
    expect(results).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});
