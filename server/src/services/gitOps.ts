import { isAbsolute, normalize } from "node:path";
import type { BranchInfo, FileDiff, WorktreeStatus } from "sylva-shared";
import { badRequest, conflict, GitError } from "../lib/errors.js";
import { parseBranches, parseDiff, parseStatusV2 } from "../lib/parse.js";
import type { GitService } from "./git.js";
import type { Workspace } from "./workspace.js";

/** Everyday git operations on a worktree. All mutations go through the exclusive queue. */
export class GitOps {
  constructor(
    private git: GitService,
    private workspace: Workspace,
  ) {}

  private safeRelPath(path: string): string {
    const normalized = normalize(path);
    if (isAbsolute(normalized) || normalized.startsWith("..")) {
      throw badRequest(`Invalid file path: ${path}`);
    }
    return normalized;
  }

  async status(worktreeId: string): Promise<WorktreeStatus> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const { stdout } = await this.git.run(worktree.path, [
      "status",
      "--porcelain=v2",
      "--branch",
    ]);
    return parseStatusV2(stdout, worktreeId);
  }

  async diff(worktreeId: string, filePath: string, staged: boolean): Promise<FileDiff> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rel = this.safeRelPath(filePath);

    // Untracked files have no diff against the index — synthesize one.
    if (!staged) {
      const { stdout: untracked } = await this.git.run(worktree.path, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        rel,
      ]);
      if (untracked.trim() === rel) {
        // --no-index exits 1 when the files differ; the patch is still on stdout.
        let patch = "";
        try {
          const res = await this.git.run(worktree.path, ["diff", "--no-index", "--", "/dev/null", rel]);
          patch = res.stdout;
        } catch (e) {
          if (e instanceof GitError && e.exitCode === 1) patch = e.stdout;
          else throw e;
        }
        const parsed = parseDiff(patch);
        return parsed[0] ?? { path: rel, binary: false, hunks: [] };
      }
    }

    const args = staged ? ["diff", "--cached", "--patch", "--", rel] : ["diff", "--patch", "--", rel];
    const { stdout } = await this.git.run(worktree.path, args);
    const parsed = parseDiff(stdout);
    return parsed[0] ?? { path: rel, binary: false, hunks: [] };
  }

  async stage(worktreeId: string, paths: string[] | "all"): Promise<void> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const args = paths === "all" ? ["add", "--all"] : ["add", "--", ...paths.map((p) => this.safeRelPath(p))];
    if (paths !== "all" && paths.length === 0) throw badRequest("No paths given");
    await this.git.runExclusive(worktree.path, args);
  }

  async unstage(worktreeId: string, paths: string[] | "all"): Promise<void> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const args =
      paths === "all"
        ? ["restore", "--staged", "."]
        : ["restore", "--staged", "--", ...paths.map((p) => this.safeRelPath(p))];
    if (paths !== "all" && paths.length === 0) throw badRequest("No paths given");
    await this.git.runExclusive(worktree.path, args);
  }

  async commit(worktreeId: string, message: string): Promise<{ head: string }> {
    if (!message.trim()) throw badRequest("Commit message must not be empty");
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const current = await this.status(worktreeId);
    if (current.staged.length === 0) throw badRequest("Nothing staged to commit");
    await this.git.runExclusive(worktree.path, ["commit", "-m", message]);
    const { stdout } = await this.git.run(worktree.path, ["rev-parse", "HEAD"]);
    return { head: stdout.trim() };
  }

  async branches(repoId: string): Promise<BranchInfo[]> {
    const repo = this.workspace.requireRepo(repoId);
    const worktrees = await this.workspace.listWorktrees(repoId);
    const { stdout } = await this.git.run(repo.path, ["branch", "--list"]);
    return parseBranches(stdout, worktrees);
  }

  async push(worktreeId: string, setUpstream: boolean): Promise<{ output: string }> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const current = await this.status(worktreeId);
    if (!current.branch) throw badRequest("Cannot push a detached HEAD");
    if (!current.upstream && !setUpstream) {
      throw conflict("no-upstream", `Branch ${current.branch} has no upstream`);
    }
    const args = setUpstream
      ? ["push", "--set-upstream", "origin", current.branch]
      : ["push"];
    const { stderr } = await this.git.runExclusive(worktree.path, args);
    return { output: stderr.trim() };
  }

  async pull(worktreeId: string): Promise<{ output: string }> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const { stderr, stdout } = await this.git.runExclusive(worktree.path, ["pull", "--ff-only"]);
    return { output: (stdout + stderr).trim() };
  }
}
