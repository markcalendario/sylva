import { open, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type {
  BaseDivergence,
  BranchInfo,
  ChangedLines,
  CommitDetail,
  CommitGraph,
  CommitManyResult,
  CommitOutcome,
  CommitStats,
  FileChangeKind,
  FileContent,
  FileDiff,
  FileEvent,
  ContentMatch,
  ContentSearchResponse,
  FileSearchResponse,
  FileSearchResult,
  GraphCommit,
  LineBlame,
  TreeEntry,
  TreeListing,
  WorktreeStatus,
} from "sylva-shared";
import { badRequest, conflict, GitError, HttpError } from "../lib/errors.js";
import {
  parseBlamePorcelain,
  parseBranches,
  parseChangedLines,
  parseDiff,
  parseNameStatusZ,
  parseNumstatZ,
  parseStatusV2,
} from "../lib/parse.js";
import type { GitService } from "./git.js";
import { isIgnored } from "./watcher.js";
import type { Workspace } from "./workspace.js";

/** `--shortstat`'s one line, e.g. " 3 files changed, 12 insertions(+), 4 deletions(-)". */
const SHORTSTAT =
  /^\s*(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?\s*$/;

/**
 * The body field arrives with the shortstat line appended, because git prints
 * the stat after the formatted record. Peel it back off.
 */
function splitBodyAndStats(raw: string): { body: string; stats?: CommitStats } {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const match = SHORTSTAT.exec(line);
    if (!match) break; // last non-blank line isn't a stat line: no stats here
    lines.splice(i, 1);
    return {
      body: lines.join("\n").trim(),
      stats: {
        files: Number(match[1] ?? 0),
        insertions: Number(match[2] ?? 0),
        deletions: Number(match[3] ?? 0),
      },
    };
  }
  return { body: raw.trim() };
}

/**
 * A revision, checked before it is handed to git as an argument.
 *
 * Only what the history panel can actually produce: a hex object name. It
 * cannot start with a dash, so it can never be read as an option, and it cannot
 * name a ref, so it can never mean something different tomorrow.
 */
function safeSha(sha: string): string {
  const trimmed = sha.trim();
  if (!/^[0-9a-f]{4,40}$/i.test(trimmed)) throw badRequest("That isn't a commit id");
  return trimmed;
}

/**
 * How well a path answers a query. Ranked so that typing a file's name finds
 * that file, typing a folder finds its contents, and typing initials still
 * gets there — `apnl` should reach AgentPanel.tsx.
 */
function scorePath(path: string, name: string, needle: string): number {
  const lowerPath = path.toLowerCase();
  const lowerName = name.toLowerCase();

  if (lowerName === needle) return 1000;
  if (lowerName.startsWith(needle)) return 900 - lowerName.length;
  if (lowerName.includes(needle)) return 800 - lowerName.length;
  if (lowerPath.includes(needle)) return 700 - lowerPath.length;
  // Scattered letters, in order: the fuzzy fallback.
  return isSubsequence(needle, lowerName)
    ? 600 - lowerName.length
    : isSubsequence(needle, lowerPath)
      ? 500 - lowerPath.length
      : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

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
    const { stdout } = await this.git.run(worktree.path, ["status", "--porcelain=v2", "--branch"]);
    const status = parseStatusV2(stdout, worktreeId);
    status.base = await this.baseDivergence(worktree.path, status.branch);
    return status;
  }

  /**
   * How far this worktree has drifted from the repository's base branch.
   * Prefers the remote's default branch, then a local main/master.
   */
  private async baseDivergence(cwd: string, branch: string | null): Promise<BaseDivergence | null> {
    const base = await this.resolveBaseRef(cwd);
    if (!base) return null;
    // Comparing a branch against itself is noise, not information.
    if (branch && (base === branch || base === `origin/${branch}`)) return null;
    try {
      const { stdout } = await this.git.run(cwd, [
        "rev-list",
        "--left-right",
        "--count",
        `${base}...HEAD`,
      ]);
      const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null;
      return { branch: base, ahead: ahead ?? 0, behind: behind ?? 0 };
    } catch {
      return null;
    }
  }

  private async resolveBaseRef(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await this.git.run(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
      const ref = stdout.trim().replace("refs/remotes/", "");
      if (ref) return ref;
    } catch {
      // No origin/HEAD configured; fall through to conventional names.
    }
    for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
      try {
        await this.git.run(cwd, ["rev-parse", "--verify", "--quiet", candidate]);
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * The worktree's current uncommitted changes as feed entries, timestamped by
   * each file's mtime.
   *
   * The Files tab watches the filesystem, so it only ever knew about changes
   * that happened while Sylva was watching — arriving at a worktree with weeks
   * of work in it showed an empty feed. This seeds that feed with what's
   * already changed, so the tab reads as "what's different here, newest first"
   * from the moment you open it.
   */
  async recentFiles(worktreeId: string, limit = 200): Promise<FileEvent[]> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const status = await this.status(worktreeId);

    // A path can be both staged and unstaged; the feed wants it once.
    const kinds = new Map<string, FileChangeKind>();
    for (const entry of [...status.staged, ...status.unstaged, ...status.untracked]) {
      // Later groups win: an unstaged edit is more recent than its staged copy.
      kinds.set(entry.path, entry.kind);
    }

    const events = await Promise.all(
      [...kinds].map(async ([path, kind]): Promise<FileEvent | null> => {
        const change =
          kind === "deleted"
            ? "deleted"
            : kind === "modified" || kind === "renamed"
              ? "changed"
              : "added";
        if (change === "deleted") {
          // Nothing on disk to stat; date it to now so it still sorts sensibly.
          return { worktreeId, path, change, at: new Date().toISOString() };
        }
        try {
          const st = await stat(join(worktree.path, path));
          return { worktreeId, path, change, at: new Date(st.mtimeMs).toISOString() };
        } catch {
          // Raced with a delete, or an unreadable path — drop it.
          return null;
        }
      }),
    );

    return events
      .filter((e): e is FileEvent => e !== null)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
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
          const res = await this.git.run(worktree.path, [
            "diff",
            "--no-index",
            "--",
            "/dev/null",
            rel,
          ]);
          patch = res.stdout;
        } catch (e) {
          if (e instanceof GitError && e.exitCode === 1) patch = e.stdout;
          else throw e;
        }
        const parsed = parseDiff(patch);
        return parsed[0] ?? { path: rel, binary: false, hunks: [] };
      }
    }

    const args = staged
      ? ["diff", "--cached", "--patch", "--", rel]
      : ["diff", "--patch", "--", rel];
    const { stdout } = await this.git.run(worktree.path, args);
    const parsed = parseDiff(stdout);
    return parsed[0] ?? { path: rel, binary: false, hunks: [] };
  }

  async stage(worktreeId: string, paths: string[] | "all"): Promise<void> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const args =
      paths === "all" ? ["add", "--all"] : ["add", "--", ...paths.map((p) => this.safeRelPath(p))];
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

  /**
   * Throw a change away.
   *
   * The one operation in Sylva with nothing behind it: an edit that was never
   * committed and is now restored has gone from the machine, and no part of
   * git remembers it. Everything about it is therefore deliberate.
   *
   * Two commands, because git has two ideas of "undo" and a file can need
   * both. `restore` puts a tracked file back to what the index or HEAD says —
   * `--staged --worktree` together, so discarding a file that was staged
   * doesn't leave it staged-and-reverted, which is a state nobody asked for.
   * `clean` is for untracked files, which `restore` has never heard of; it is
   * the half that actually deletes.
   */
  async discard(worktreeId: string, paths: string[] | "all"): Promise<void> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    if (paths !== "all" && paths.length === 0) throw badRequest("No paths given");

    if (paths === "all") {
      // `:/` rather than `.`: the whole worktree regardless of which directory
      // git happens to consider current.
      await this.git.runExclusive(worktree.path, [
        "restore",
        "--staged",
        "--worktree",
        "--source=HEAD",
        "--",
        ":/",
      ]);
      // -d for directories a build left behind, -f because git refuses
      // without it. Ignored files are deliberately spared: node_modules and a
      // .env are not "changes", and taking them would turn a discard into a
      // reason to reinstall.
      await this.git.runExclusive(worktree.path, ["clean", "-fd"]);
      return;
    }

    const safe = paths.map((p) => this.safeRelPath(p));
    // Untracked paths have no HEAD version to restore, and asking git to
    // restore one fails the whole command — so they are told apart first and
    // handed to the right half.
    const tracked: string[] = [];
    const untracked: string[] = [];
    for (const path of safe) {
      const { stdout } = await this.git.run(worktree.path, ["ls-files", "--", path]);
      (stdout.trim() ? tracked : untracked).push(path);
    }

    if (tracked.length > 0) {
      await this.git.runExclusive(worktree.path, [
        "restore",
        "--staged",
        "--worktree",
        "--source=HEAD",
        "--",
        ...tracked,
      ]);
    }
    if (untracked.length > 0) {
      await this.git.runExclusive(worktree.path, ["clean", "-fd", "--", ...untracked]);
    }
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

  /**
   * Commit the same message in several worktrees.
   *
   * One call rather than several from the client, because several can
   * half-fail and the client would then have to invent its own account of what
   * happened. This returns the account: which worktrees landed, and why the
   * others didn't. It keeps going after a failure — the successful commits are
   * real work, and abandoning the rest would be arbitrary.
   */
  async commitMany(worktreeIds: string[], message: string): Promise<CommitManyResult> {
    if (!message.trim()) throw badRequest("Commit message must not be empty");
    const results: CommitOutcome[] = [];
    for (const worktreeId of worktreeIds) {
      try {
        const { head } = await this.commit(worktreeId, message);
        results.push({ worktreeId, ok: true, head });
      } catch (e) {
        const detail =
          e instanceof HttpError
            ? (e.detail ?? e.message)
            : e instanceof Error
              ? e.message
              : String(e);
        results.push({ worktreeId, ok: false, error: detail });
      }
    }
    return { results };
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
    const args = setUpstream ? ["push", "--set-upstream", "origin", current.branch] : ["push"];
    const { stderr } = await this.git.runExclusive(worktree.path, args);
    return { output: stderr.trim() };
  }

  async pull(worktreeId: string): Promise<{ output: string }> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const { stderr, stdout } = await this.git.runExclusive(worktree.path, ["pull", "--ff-only"]);
    return { output: (stdout + stderr).trim() };
  }

  /**
   * This branch drawn against its base. Two ranges plus the merge base is all
   * the shape there is to a topic branch, and it answers the question the
   * ahead/behind counters only hint at: *what* am I ahead by?
   */
  async graph(worktreeId: string, cap = 25): Promise<CommitGraph> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const status = await this.status(worktreeId);
    const base = await this.resolveBaseRef(worktree.path);

    const sameBranch =
      base !== null &&
      status.branch !== null &&
      (base === status.branch || base === `origin/${status.branch}`);

    if (!base || sameBranch) {
      // On the base branch itself there is nothing to diverge from; show the
      // recent history so the panel still says something useful.
      const common = await this.log(worktree.path, ["-n", String(cap), "HEAD"]);
      return {
        branch: status.branch,
        base: sameBranch ? base : null,
        mergeBase: null,
        ahead: [],
        behind: [],
        common,
        truncated: common.length >= cap,
      };
    }

    let mergeBaseSha: string | null = null;
    try {
      const { stdout } = await this.git.run(worktree.path, ["merge-base", "HEAD", base]);
      mergeBaseSha = stdout.trim() || null;
    } catch {
      mergeBaseSha = null;
    }

    const [ahead, behind] = await Promise.all([
      this.log(worktree.path, ["-n", String(cap + 1), `${base}..HEAD`]),
      this.log(worktree.path, ["-n", String(cap + 1), `HEAD..${base}`]),
    ]);
    const mergeBase = mergeBaseSha
      ? ((await this.log(worktree.path, ["-n", "1", mergeBaseSha]))[0] ?? null)
      : null;
    const common = mergeBaseSha
      ? (await this.log(worktree.path, ["-n", "4", mergeBaseSha])).slice(1)
      : [];

    return {
      branch: status.branch,
      base,
      mergeBase,
      ahead: ahead.slice(0, cap),
      behind: behind.slice(0, cap),
      common,
      truncated: ahead.length > cap || behind.length > cap,
    };
  }

  /**
   * One commit, opened up: what it says and every file it touched.
   *
   * Two calls rather than one. `--name-status` knows what happened to a file —
   * added, deleted, renamed from where — and `--numstat` knows how much moved;
   * neither says both, and asking git twice is cheaper than parsing the
   * `{old => new}` path shorthand that a combined format would hand back.
   */
  async commitDetail(worktreeId: string, sha: string): Promise<CommitDetail> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rev = safeSha(sha);

    const [commit] = await this.log(worktree.path, ["-n", "1", rev]);
    if (!commit) throw badRequest(`No commit ${sha} in this worktree`);

    const [names, nums] = await Promise.all([
      this.git.run(worktree.path, [
        "show",
        "--format=",
        "--name-status",
        "-z",
        "-m",
        "--first-parent",
        rev,
      ]),
      this.git.run(worktree.path, [
        "show",
        "--format=",
        "--numstat",
        "-z",
        "-m",
        "--first-parent",
        rev,
      ]),
    ]);

    const counts = parseNumstatZ(nums.stdout);
    const files = parseNameStatusZ(names.stdout).map((file) => ({
      ...file,
      insertions: counts.get(file.path)?.insertions ?? null,
      deletions: counts.get(file.path)?.deletions ?? null,
    }));

    return { commit, files };
  }

  /** One file, as that commit changed it — the diff against its first parent. */
  async commitDiff(worktreeId: string, sha: string, filePath: string): Promise<FileDiff> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rev = safeSha(sha);
    const rel = this.safeRelPath(filePath);
    const { stdout } = await this.git.run(worktree.path, [
      "show",
      "--format=",
      "--patch",
      "--find-renames",
      // A merge shown plainly prints nothing at all; against its first parent it
      // prints what the merge brought in, which is what the row claims to be.
      "-m",
      "--first-parent",
      rev,
      "--",
      rel,
    ]);
    const parsed = parseDiff(stdout);
    return parsed[0] ?? { path: rel, binary: false, hunks: [] };
  }

  /**
   * git log with a record format that survives subjects containing anything.
   *
   * The body and the two identities cost nothing extra here, and `--shortstat`
   * gets the diffstat in the same invocation — one process for the whole range,
   * rather than one per commit, which is what makes it affordable to show this
   * much detail on hover.
   */
  private async log(cwd: string, args: string[]): Promise<GraphCommit[]> {
    const FIELD = "\x1f";
    // NUL separates commits because git forbids it inside a commit message —
    // it is the one byte that cannot appear, so commits can never be lost or
    // merged into each other however strange the messages are. Fields use a
    // control character, which a determined message *could* contain; that
    // degrades one commit's metadata rather than corrupting the list.
    const RECORD = "\0";
    const format = ["%H", "%h", "%s", "%an", "%ar", "%ae", "%aI", "%cn", "%ce", "%cI", "%b"].join(
      FIELD,
    );
    try {
      const { stdout } = await this.git.run(cwd, [
        "log",
        // `%x00` rather than a literal NUL: the byte we want git to *emit*
        // cannot itself be passed inside an argv string.
        `--format=%x00${format}`,
        "--shortstat",
        ...args,
      ]);
      // Leading RECORD rather than trailing: --shortstat prints its line *after*
      // the formatted record, so the delimiter has to open each commit for the
      // stat line to land inside it rather than on the next one.
      return stdout
        .split(RECORD)
        .filter((record) => record.trim().length > 0)
        .map((record) => {
          const fields = record.split(FIELD);
          const [
            sha,
            short,
            subject,
            author,
            relative,
            authorEmail,
            authorDate,
            committer,
            committerEmail,
            committerDate,
          ] = fields;
          // The body is the last field, so anything past it is a field
          // separator that appeared inside the message — put it back.
          const { body, stats } = splitBodyAndStats(fields.slice(10).join(FIELD));
          return {
            sha: sha ?? "",
            short: short ?? "",
            subject: subject ?? "",
            author: author ?? "",
            relative: relative ?? "",
            authorEmail: authorEmail ?? "",
            authorDate: authorDate ?? "",
            committer: committer ?? "",
            committerEmail: committerEmail ?? "",
            committerDate: committerDate ?? "",
            body,
            ...(stats ? { stats } : {}),
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Find files by name anywhere in the worktree.
   *
   * Walks rather than asking git: `git ls-files` misses untracked files, and
   * those are exactly the ones an agent has just created — the files you are
   * most likely to be looking for.
   */
  async searchFiles(
    worktreeId: string,
    query: string,
    { maxResults = 200, maxVisited = 20_000 } = {},
  ): Promise<FileSearchResponse> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const needle = query.trim().toLowerCase();
    if (!needle) return { query, results: [], truncated: false };

    const results: FileSearchResult[] = [];
    const queue: string[] = [""];
    let visited = 0;
    let truncated = false;

    // Breadth-first, so a shallow match is found before a deep walk finishes.
    while (queue.length > 0) {
      const rel = queue.shift() as string;
      if (visited >= maxVisited) {
        truncated = true;
        break;
      }
      let dirents;
      try {
        dirents = await readdir(rel ? join(worktree.path, rel) : worktree.path, {
          withFileTypes: true,
        });
      } catch {
        continue; // unreadable directory; the rest of the walk is still useful
      }
      for (const dirent of dirents) {
        const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
        if (isIgnored(childRel)) continue;
        visited++;
        if (dirent.isDirectory()) {
          queue.push(childRel);
        } else if (dirent.isFile()) {
          const score = scorePath(childRel, dirent.name, needle);
          if (score > 0) results.push({ path: childRel, name: dirent.name, score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    if (results.length > maxResults) truncated = true;
    return { query, results: results.slice(0, maxResults), truncated };
  }

  /**
   * One directory of the worktree. The Files feed only ever shows what changed;
   * this is for looking at what's there.
   */
  async tree(worktreeId: string, relPath: string): Promise<TreeListing> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rel = relPath ? this.safeRelPath(relPath) : "";
    const dir = rel ? join(worktree.path, rel) : worktree.path;

    const dirents = await readdir(dir, { withFileTypes: true });
    const entries: TreeEntry[] = [];
    for (const dirent of dirents) {
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (isIgnored(childRel)) continue;
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, path: childRel, kind: "dir" });
      } else if (dirent.isFile()) {
        let size: number | undefined;
        try {
          size = (await stat(join(dir, dirent.name))).size;
        } catch {
          size = undefined;
        }
        entries.push({
          name: dirent.name,
          path: childRel,
          kind: "file",
          ...(size === undefined ? {} : { size }),
        });
      }
    }
    // Directories first, then files, each alphabetically — the order every
    // file tree uses, so nobody has to learn this one.
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
    return { path: rel, entries };
  }

  /**
   * Where this worktree's git metadata lives. Not always `<worktree>/.git`: in
   * a linked worktree that is a *file* pointing at
   * `<repo>/.git/worktrees/<name>`, which is where its HEAD really is.
   */
  async gitDir(worktreeId: string): Promise<string> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const { stdout } = await this.git.run(worktree.path, ["rev-parse", "--absolute-git-dir"]);
    return stdout.trim();
  }

  /**
   * Search inside files, not just their names.
   *
   * `git grep` rather than a hand-rolled walk: it already skips .gitignore'd
   * paths and binaries, it is far faster than reading every file through Node,
   * and `--untracked` covers the files an agent has just created, which a plain
   * `git grep` would miss.
   */
  async searchContent(
    worktreeId: string,
    query: string,
    { maxMatches = 200 } = {},
  ): Promise<ContentSearchResponse> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const needle = query.trim();
    if (!needle) return { query, matches: [], fileCount: 0, truncated: false };

    let stdout = "";
    try {
      // -F: a literal search, so a stray ( or * is a character rather than a
      // syntax error. -I: skip binaries. -n: line numbers.
      const res = await this.git.run(worktree.path, [
        "grep",
        "--no-color",
        "-F",
        "-I",
        "-n",
        "-i",
        "--untracked",
        "--max-count",
        "20",
        "-e",
        needle,
      ]);
      stdout = res.stdout;
    } catch (e) {
      // git grep exits 1 when nothing matched, which is an answer, not a fault.
      if (e instanceof GitError && e.exitCode === 1)
        return { query, matches: [], fileCount: 0, truncated: false };
      throw e;
    }

    const matches: ContentMatch[] = [];
    for (const raw of stdout.split("\n")) {
      if (!raw) continue;
      // path:line:text — a path can contain a colon, so split from the left
      // only as far as the two fields we need.
      const first = raw.indexOf(":");
      if (first === -1) continue;
      const second = raw.indexOf(":", first + 1);
      if (second === -1) continue;
      const path = raw.slice(0, first);
      const line = Number(raw.slice(first + 1, second));
      if (!Number.isFinite(line)) continue;
      if (isIgnored(path)) continue;
      const text = raw.slice(second + 1).trim();
      matches.push({ path, line, text: text.length > 400 ? `${text.slice(0, 399)}…` : text });
      if (matches.length >= maxMatches) break;
    }

    return {
      query,
      matches,
      fileCount: new Set(matches.map((m) => m.path)).size,
      truncated: matches.length >= maxMatches,
    };
  }

  /**
   * Who last touched one line.
   *
   * Asked per line rather than for the whole file on purpose: this follows a
   * caret, so all but one of the answers would be thrown away, and blaming a
   * three-thousand-line file to show one row is work nobody asked for.
   *
   * `-w` ignores whitespace-only changes and `-C` follows lines moved between
   * files in the same commit — without them a reformat or a file split makes
   * everything look like it was written by whoever did the moving.
   */
  async blameLine(worktreeId: string, filePath: string, line: number): Promise<LineBlame> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rel = this.safeRelPath(filePath);
    if (!Number.isInteger(line) || line < 1) throw badRequest(`Invalid line: ${line}`);

    const { stdout } = await this.git.run(worktree.path, [
      "blame",
      "-w",
      "-C",
      "--porcelain",
      "-L",
      `${line},${line}`,
      "--",
      rel,
    ]);

    return parseBlamePorcelain(stdout, line);
  }

  /**
   * Which lines of a file differ from the last commit.
   *
   * Read from the same patch the Git tab shows, so the two can never disagree
   * about what changed. An untracked file has no patch and no baseline — every
   * line of it is new, and saying so is more honest than reporting nothing.
   */
  async changedLines(worktreeId: string, filePath: string): Promise<ChangedLines> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rel = this.safeRelPath(filePath);

    const { stdout: tracked } = await this.git
      .run(worktree.path, ["ls-files", "--error-unmatch", "--", rel])
      .catch(() => ({ stdout: "" }));

    if (!tracked.trim()) {
      return { path: rel, added: [], modified: [], tracked: false };
    }

    // Against HEAD rather than the index: the question is "what is new since
    // the last commit", and staging something doesn't make it old.
    const { stdout } = await this.git.run(worktree.path, [
      "diff",
      "HEAD",
      "--unified=0",
      "--no-color",
      "--",
      rel,
    ]);

    return { path: rel, ...parseChangedLines(stdout), tracked: true };
  }

  /** A file's text, capped, with binaries reported rather than streamed. */
  async fileContent(worktreeId: string, relPath: string, cap = 256 * 1024): Promise<FileContent> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rel = this.safeRelPath(relPath);
    const full = join(worktree.path, rel);

    const info = await stat(full);
    if (!info.isFile()) throw badRequest(`${rel} is not a file`);

    const handle = await open(full, "r");
    try {
      const buffer = Buffer.alloc(Math.min(info.size, cap));
      await handle.read(buffer, 0, buffer.byteLength, 0);
      // A NUL byte anywhere in the sampled region means this isn't text; no
      // encoding guessing beyond that.
      if (buffer.includes(0)) {
        return { path: rel, content: "", truncated: false, binary: true, size: info.size };
      }
      return {
        path: rel,
        content: buffer.toString("utf8"),
        truncated: info.size > cap,
        binary: false,
        size: info.size,
      };
    } finally {
      await handle.close();
    }
  }

  /**
   * Write a file back after an edit in the Files tab.
   *
   * Deliberately narrow: it overwrites a file that already exists and is text,
   * and refuses everything else. Creating files, writing binaries and touching
   * anything outside the worktree are all jobs the dryad or the terminal
   * already does, with more context than a text box has.
   */
  async writeFileContent(
    worktreeId: string,
    relPath: string,
    content: string,
  ): Promise<FileContent> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);
    const rel = this.safeRelPath(relPath);
    const full = join(worktree.path, rel);

    let info;
    try {
      info = await stat(full);
    } catch {
      throw badRequest(`${rel} doesn't exist in this worktree`);
    }
    if (!info.isFile()) throw badRequest(`${rel} is not a file`);

    // A binary read back as UTF-8 and written again is a corrupted binary, so
    // the same NUL-byte test that gates reading gates writing.
    const existing = await this.fileContent(worktreeId, rel);
    if (existing.binary) throw badRequest(`${rel} is a binary file`);
    if (existing.truncated) {
      throw badRequest(
        `${rel} is too large to edit here`,
        "Only the first 256 KB was read, so saving would truncate the file. Open it in your editor instead.",
      );
    }

    await writeFile(full, content, "utf8");
    return this.fileContent(worktreeId, rel);
  }
}
