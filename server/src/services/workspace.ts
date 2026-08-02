import { access, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Repo, Worktree } from "sylva-shared";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { pathId } from "../lib/id.js";
import { parseWorktreeList } from "../lib/parse.js";
import type { GitService } from "./git.js";
import type { Store } from "./store.js";

export interface ResolvedWorktree {
  repo: Repo;
  worktree: Worktree;
}

/** Repo registry + worktree operations + focus state. */
export class Workspace {
  private focusedWorktreeId: string | null = null;
  private paneWorktreeIds = new Set<string>();
  onFocusChange: (worktreeId: string | null) => void = () => {};
  onOpenChange: (entries: { worktreeId: string; path: string }[]) => void = () => {};

  constructor(
    private store: Store,
    private git: GitService,
  ) {}

  // ---------- repos ----------

  async listRepos(): Promise<Repo[]> {
    const repos: Repo[] = [];
    for (const r of this.store.repos) {
      let available = true;
      try {
        await access(r.path);
      } catch {
        available = false;
      }
      repos.push({ ...r, available });
    }
    return repos;
  }

  async registerRepo(rawPath: string): Promise<Repo> {
    if (!isAbsolute(rawPath)) throw badRequest("Path must be absolute");
    const path = resolve(rawPath);

    let st;
    try {
      st = await stat(path);
    } catch {
      throw badRequest(`Path does not exist: ${path}`);
    }
    if (!st.isDirectory()) throw badRequest(`Not a directory: ${path}`);

    try {
      await this.git.run(path, ["rev-parse", "--git-dir"]);
    } catch {
      throw badRequest(`Not a git repository: ${path}`);
    }

    const id = pathId(path);
    const existing = this.store.repos.find((r) => r.id === id || r.path === path);
    if (existing) throw conflict(`Repository already registered as "${existing.name}"`, existing.id);

    const repo = { id, name: basename(path), path };
    await this.store.addRepo(repo);
    return { ...repo, available: true };
  }

  async removeRepo(repoId: string): Promise<void> {
    this.requireRepo(repoId);
    if (this.focusedWorktreeId) {
      const focused = await this.tryResolveWorktree(this.focusedWorktreeId);
      if (focused?.repo.id === repoId) this.setFocus(null);
    }
    await this.store.removeRepo(repoId);
  }

  requireRepo(repoId: string): Omit<Repo, "available"> {
    const repo = this.store.repos.find((r) => r.id === repoId);
    if (!repo) throw notFound("repository");
    return repo;
  }

  // ---------- worktrees ----------

  async listWorktrees(repoId: string): Promise<Worktree[]> {
    const repo = this.requireRepo(repoId);
    const { stdout } = await this.git.run(repo.path, ["worktree", "list", "--porcelain"]);
    return parseWorktreeList(stdout, repoId);
  }

  async createWorktree(
    repoId: string,
    opts: { branch: string; baseRef?: string; path?: string },
  ): Promise<Worktree> {
    const repo = this.requireRepo(repoId);
    if (!opts.branch.trim()) throw badRequest("Branch name is required");
    const branch = opts.branch.trim();
    if (branch.startsWith("-")) throw badRequest("Invalid branch name");

    const targetPath = opts.path
      ? resolve(opts.path)
      : join(dirname(repo.path), `${basename(repo.path)}-worktrees`, branch.replace(/\//g, "-"));

    const args = ["worktree", "add"];
    if (opts.baseRef) {
      args.push("-b", branch, targetPath, opts.baseRef);
    } else {
      args.push(targetPath, branch);
    }
    await this.git.runExclusive(repo.path, args);

    const worktrees = await this.listWorktrees(repoId);
    const created = worktrees.find((w) => w.path === targetPath);
    if (!created) throw new Error("worktree created but not found in list");
    return created;
  }

  async removeWorktree(worktreeId: string, force: boolean): Promise<void> {
    const { repo, worktree } = await this.resolveWorktree(worktreeId);
    if (worktree.isMain) throw badRequest("The main worktree cannot be removed");
    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(worktree.path);
    await this.git.runExclusive(repo.path, args);
    if (this.focusedWorktreeId === worktreeId) this.setFocus(null);
  }

  /** Resolve a worktree ID across all registered repos. */
  async resolveWorktree(worktreeId: string): Promise<ResolvedWorktree> {
    const found = await this.tryResolveWorktree(worktreeId);
    if (!found) throw notFound("worktree");
    return found;
  }

  async tryResolveWorktree(worktreeId: string): Promise<ResolvedWorktree | null> {
    for (const r of await this.listRepos()) {
      if (!r.available) continue;
      let worktrees: Worktree[];
      try {
        worktrees = await this.listWorktrees(r.id);
      } catch {
        continue;
      }
      const worktree = worktrees.find((w) => w.id === worktreeId);
      if (worktree) return { repo: r, worktree };
    }
    return null;
  }

  // ---------- focus ----------

  get focused(): string | null {
    return this.focusedWorktreeId;
  }

  setFocus(worktreeId: string | null): void {
    if (this.focusedWorktreeId === worktreeId) return;
    this.focusedWorktreeId = worktreeId;
    this.onFocusChange(worktreeId);
    void this.syncWatched();
  }

  /**
   * Everything the panes hold. Focus stays a single id — it is what quick-start
   * and `focus.changed` mean by "where you are" — and this runs beside it as
   * the wider set of worktrees that have to stay live.
   */
  get openWorktrees(): string[] {
    return [...this.paneWorktreeIds];
  }

  async setOpenWorktrees(worktreeIds: string[]): Promise<void> {
    this.paneWorktreeIds = new Set(worktreeIds);
    await this.syncWatched();
  }

  /**
   * Resolve the union of the panes and the focused worktree, and hand it to
   * whoever is watching. Focus is unioned in rather than assumed to be among
   * the panes: it can move without the client saying anything — a quick-start,
   * or the focused worktree being removed — and a focused worktree that isn't
   * being watched is a panel that quietly stops updating.
   *
   * Ids that no longer resolve are dropped rather than raised: a pane holding a
   * worktree someone deleted from a terminal shouldn't fail the whole call.
   */
  private async syncWatched(): Promise<void> {
    const wanted = new Set(this.paneWorktreeIds);
    if (this.focusedWorktreeId) wanted.add(this.focusedWorktreeId);

    const resolved: { worktreeId: string; path: string }[] = [];
    for (const id of wanted) {
      const found = await this.tryResolveWorktree(id);
      if (found) resolved.push({ worktreeId: id, path: found.worktree.path });
    }
    this.onOpenChange(resolved);
  }
}
