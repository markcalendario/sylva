import type {
  BranchInfo,
  DiffHunk,
  DiffLine,
  FileDiff,
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
