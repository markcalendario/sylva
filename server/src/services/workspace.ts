import { access, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Repo, Worktree } from "sylva-shared";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.js";
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

  /**
   * Start a repository rather than adopt one. `git init` alone leaves HEAD
   * unborn, and `git worktree add` refuses to work against an unborn HEAD — so
   * a repository created here would be registered, visible, and unable to do
   * the one thing Sylva is for. The initial commit is what makes it usable.
   */
  async createRepo(parentPath: string, rawName: string): Promise<Repo> {
    if (!isAbsolute(parentPath)) throw badRequest("Path must be absolute");
    const name = rawName.trim();
    if (!name) throw badRequest("Repository name is required");
    if (name.startsWith("-")) throw badRequest("Repository name cannot start with a dash");
    if (name === "." || name === ".." || /[/\\]/.test(name)) {
      throw badRequest("Repository name cannot contain a path separator");
    }

    const parent = resolve(parentPath);
    try {
      const info = await stat(parent);
      if (!info.isDirectory()) throw badRequest(`Not a directory: ${parent}`);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw badRequest(`Path does not exist: ${parent}`);
    }

    const path = join(parent, name);
    try {
      await access(path);
      throw conflict(`${path} already exists`);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // ENOENT is the good case: nothing is in the way.
    }

    let created = false;
    try {
      await mkdir(path);
      created = true;
      await this.git.runExclusive(path, ["init", "-b", "main"]);
      await writeFile(
        join(path, "README.md"),
        `# ${name}\n\nStarted with Sylva.\n`,
        "utf8",
      );
      await this.git.runExclusive(path, ["add", "README.md"]);
      try {
        await this.git.runExclusive(path, ["commit", "-m", "Initial commit"]);
      } catch (err) {
        // git's own words here are a wall of configuration advice ending in a
        // fatal; say the one thing that fixes it.
        const message = err instanceof Error ? err.message : String(err);
        if (/user\.email|user\.name|author identity/i.test(message)) {
          throw badRequest(
            "git doesn't know who you are yet",
            'Set your identity first: git config --global user.name "Your Name" and git config --global user.email "you@example.com".',
          );
        }
        throw err;
      }
      return await this.registerRepo(path);
    } catch (err) {
      // Half a repository is worse than none: leave the disk as we found it.
      if (created) await rm(path, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
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

    // git reports worktrees by their real path, so an exact string match fails
    // whenever any part of the path is a symlink — /tmp on macOS, an external
    // volume, a symlinked home. The worktree is created and then reported
    // missing, which reads as a much worse failure than it is.
    const worktrees = await this.listWorktrees(repoId);
    const wanted = await realpath(targetPath).catch(() => targetPath);
    const created =
      worktrees.find((w) => w.path === targetPath) ?? worktrees.find((w) => w.path === wanted);
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
