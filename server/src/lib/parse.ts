import type {
  BranchInfo,
  CommitFile,
  DiffHunk,
  DiffLine,
  FileChangeKind,
  FileDiff,
  LineBlame,
  StatusEntry,
  Worktree,
  WorktreeStatus,
} from "sylva-shared";
import { pathId } from "./id.js";

// ---------- git worktree list --porcelain ----------

export function parseWorktreeList(output: string, repoId: string): Worktree[] {
  const blocks = output.split("\n\n").filter((b) => b.trim().length > 0);
  const worktrees: Worktree[] = [];
  for (const [index, block] of blocks.entries()) {
    let path = "";
    let head = "";
    let branch: string | null = null;
    let detached = false;
    let bare = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line === "detached") detached = true;
      else if (line === "bare") bare = true;
    }
    if (!path || bare) continue;
    worktrees.push({
      id: pathId(path),
      repoId,
      path,
      branch,
      head,
      isMain: index === 0,
      isDetached: detached,
    });
  }
  return worktrees;
}

// ---------- git status --porcelain=v2 --branch ----------

const XY_KIND: Record<string, StatusEntry["kind"]> = {
  A: "added",
  M: "modified",
  T: "modified",
  D: "deleted",
  R: "renamed",
  C: "added",
};

export function parseStatusV2(output: string, worktreeId: string): WorktreeStatus {
  const status: WorktreeStatus = {
    worktreeId,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    base: null,
  };

  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const name = line.slice("# branch.head ".length);
      status.branch = name === "(detached)" ? null : name;
    } else if (line.startsWith("# branch.upstream ")) {
      status.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        status.ahead = Number(m[1]);
        status.behind = Number(m[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const isRename = line.startsWith("2 ");
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const x = xy[0] ?? ".";
      const y = xy[1] ?? ".";
      // Fields: 1 XY sub mH mI mW hH hI path  |  2 XY sub mH mI mW hH hI X<score> path\torigPath
      const rest = parts.slice(isRename ? 9 : 8).join(" ");
      let path = rest;
      let renamedFrom: string | undefined;
      if (isRename) {
        const [to, from] = rest.split("\t");
        path = to ?? rest;
        renamedFrom = from;
      }
      if (x !== ".") {
        status.staged.push({ path, kind: XY_KIND[x] ?? "modified", ...(renamedFrom ? { renamedFrom } : {}) });
      }
      if (y !== ".") {
        status.unstaged.push({ path, kind: XY_KIND[y] ?? "modified" });
      }
    } else if (line.startsWith("? ")) {
      status.untracked.push({ path: line.slice(2), kind: "untracked" });
    } else if (line.startsWith("u ")) {
      // Unmerged (conflict) — surface in unstaged so it is visible.
      const parts = line.split(" ");
      const path = parts.slice(10).join(" ");
      status.unstaged.push({ path, kind: "modified" });
    }
  }
  return status;
}

// ---------- git diff --patch ----------

export function parseDiff(output: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of output.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { path: "", binary: false, hunks: [] };
      files.push(current);
      hunk = null;
    } else if (!current) {
      continue;
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      current.binary = true;
    } else if (line.startsWith("rename from ")) {
      current.renamedFrom = line.slice("rename from ".length);
    } else if (line.startsWith("+++ b/")) {
      current.path = line.slice("+++ b/".length);
    } else if (line.startsWith("--- a/") && current.path === "") {
      current.path = line.slice("--- a/".length);
    } else if (line.startsWith("+++ /dev/null")) {
      // deleted file: keep the --- a/ path
    } else if (line.startsWith("@@")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = m ? Number(m[1]) : 0;
      newLine = m ? Number(m[2]) : 0;
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
    } else if (hunk) {
      let dl: DiffLine | null = null;
      if (line.startsWith("+")) dl = { type: "add", content: line.slice(1), oldLine: null, newLine: newLine++ };
      else if (line.startsWith("-")) dl = { type: "del", content: line.slice(1), oldLine: oldLine++, newLine: null };
      else if (line.startsWith(" ") || line === "")
        dl = { type: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ };
      if (dl) hunk.lines.push(dl);
    }
  }
  return files.filter((f) => f.path !== "");
}

// ---------- git show --name-status -z / --numstat -z ----------

const STATUS_KIND: Record<string, FileChangeKind> = {
  A: "added",
  M: "modified",
  T: "modified",
  D: "deleted",
  R: "renamed",
  C: "added",
};

/**
 * What a commit did to each file.
 *
 * `-z` rather than the readable form because a path may contain anything a
 * filesystem allows, including the spaces and quotes the default output escapes
 * — with NUL separators nothing needs unquoting, and a rename arrives as two
 * plain paths instead of the `{old => new}` shorthand.
 */
export function parseNameStatusZ(output: string): Omit<CommitFile, "insertions" | "deletions">[] {
  const tokens = output.split("\0").filter((t) => t.length > 0);
  const files: Omit<CommitFile, "insertions" | "deletions">[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i] ?? "";
    const letter = status[0] ?? "";
    const kind = STATUS_KIND[letter];
    if (!kind) continue;
    // R and C carry a similarity score and two paths; everything else, one.
    if (letter === "R" || letter === "C") {
      const from = tokens[++i];
      const to = tokens[++i];
      if (!to) break;
      files.push({ path: to, kind, ...(from ? { renamedFrom: from } : {}) });
    } else {
      const path = tokens[++i];
      if (!path) break;
      files.push({ path, kind });
    }
  }
  return files;
}

/** How much each file moved. `-` counts mean binary, where git counts nothing. */
export function parseNumstatZ(output: string): Map<string, { insertions: number | null; deletions: number | null }> {
  const tokens = output.split("\0").filter((t) => t.length > 0);
  const counts = new Map<string, { insertions: number | null; deletions: number | null }>();
  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i] ?? "";
    const parts = record.split("\t");
    if (parts.length < 3) continue;
    const [adds, dels, rest] = parts;
    // A rename leaves the path field empty and puts old and new in the two
    // tokens that follow.
    const path = rest === "" ? ((i += 2), tokens[i]) : rest;
    if (!path) continue;
    counts.set(path, {
      insertions: adds === "-" ? null : Number(adds),
      deletions: dels === "-" ? null : Number(dels),
    });
  }
  return counts;
}

// ---------- git branch list ----------

export function parseBranches(
  output: string,
  worktrees: Worktree[],
): BranchInfo[] {
  const byBranch = new Map<string, Worktree>();
  for (const wt of worktrees) {
    if (wt.branch) byBranch.set(wt.branch, wt);
  }
  const branches: BranchInfo[] = [];
  for (const raw of output.split("\n")) {
    if (!raw.trim()) continue;
    const isCurrent = raw.startsWith("*");
    const name = raw.replace(/^[*+ ] /, "").split(" ")[0] ?? "";
    if (!name || name.includes("HEAD")) continue;
    const wt = byBranch.get(name);
    branches.push({
      name,
      isCurrent,
      checkedOutAt: wt?.path ?? null,
      worktreeId: wt?.id ?? null,
    });
  }
  return branches;
}

/** All-zero sha: git's way of saying a line isn't in any commit yet. */
const UNCOMMITTED_SHA = /^0+$/;

/**
 * One line's blame, from `git blame --porcelain`.
 *
 * The porcelain format leads with a header line carrying the sha, then a run of
 * `key value` lines, then the source line prefixed by a tab. Only the first
 * block matters here, because the caller asked about exactly one line.
 */
export function parseBlamePorcelain(output: string, line: number): LineBlame {
  const lines = output.split("\n");
  const header = lines[0]?.split(" ") ?? [];
  const sha = header[0] ?? "";

  const fields = new Map<string, string>();
  for (const raw of lines.slice(1)) {
    // The source line itself is tab-prefixed and ends the header block.
    if (raw.startsWith("\t")) break;
    const space = raw.indexOf(" ");
    if (space === -1) {
      if (raw) fields.set(raw, "");
      continue;
    }
    fields.set(raw.slice(0, space), raw.slice(space + 1));
  }

  const committed = sha !== "" && !UNCOMMITTED_SHA.test(sha);
  const seconds = Number(fields.get("author-time"));
  // git reports seconds; an uncommitted line has no meaningful time at all.
  const authoredAt =
    committed && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : "";

  return {
    line,
    committed,
    sha: committed ? sha : "",
    shortSha: committed ? sha.slice(0, 7) : "",
    author: committed ? (fields.get("author") ?? "") : "",
    authorEmail: committed ? (fields.get("author-mail") ?? "").replace(/^<|>$/g, "") : "",
    authoredAt,
    summary: committed ? (fields.get("summary") ?? "") : "",
  };
}

/** A hunk header from `diff --unified=0`, e.g. `@@ -12,3 +12,4 @@`. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Which line numbers a patch adds or changes, in the new file.
 *
 * With `--unified=0` every hunk is exactly the change and nothing around it, so
 * the header's ranges are the answer without reading a single body line. A hunk
 * that removes as well as adds is a modification — the lines are replacements
 * rather than insertions, and marking them differently is the difference
 * between "this is new" and "this used to say something else".
 */
export function parseChangedLines(output: string): { added: number[]; modified: number[] } {
  const added: number[] = [];
  const modified: number[] = [];

  for (const raw of output.split("\n")) {
    const match = HUNK.exec(raw);
    if (!match) continue;

    const removedCount = match[2] === undefined ? 1 : Number(match[2]);
    const start = Number(match[3]);
    const addedCount = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isFinite(start) || addedCount === 0) continue;

    const into = removedCount > 0 ? modified : added;
    for (let i = 0; i < addedCount; i++) into.push(start + i);
  }

  return { added, modified };
}
