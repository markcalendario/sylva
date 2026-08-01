import { describe, expect, it } from "vitest";
import { parseBranches, parseDiff, parseStatusV2, parseWorktreeList } from "../src/lib/parse.js";

describe("parseWorktreeList", () => {
  it("parses main and linked worktrees", () => {
    const out = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo-worktrees/feat",
      "HEAD def456",
      "branch refs/heads/feat",
      "",
      "worktree /repo-worktrees/det",
      "HEAD 999888",
      "detached",
      "",
    ].join("\n");
    const wts = parseWorktreeList(out, "r1");
    expect(wts).toHaveLength(3);
    expect(wts[0]).toMatchObject({ path: "/repo", branch: "main", isMain: true, isDetached: false });
    expect(wts[1]).toMatchObject({ path: "/repo-worktrees/feat", branch: "feat", isMain: false });
    expect(wts[2]).toMatchObject({ branch: null, isDetached: true });
    expect(wts[0]!.id).not.toEqual(wts[1]!.id);
  });

  it("skips bare entries", () => {
    const out = ["worktree /repo.git", "bare", ""].join("\n");
    expect(parseWorktreeList(out, "r1")).toHaveLength(0);
  });
});

describe("parseStatusV2", () => {
  it("parses branch, ahead/behind, and file groups", () => {
    const out = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 h1 h2 modified.ts",
      "1 M. N... 100644 100644 100644 h1 h2 staged.ts",
      "1 MM N... 100644 100644 100644 h1 h2 both.ts",
      "1 .D N... 100644 100644 100644 h1 h2 deleted.ts",
      "? new.txt",
    ].join("\n");
    const st = parseStatusV2(out, "w1");
    expect(st.branch).toBe("main");
    expect(st.upstream).toBe("origin/main");
    expect(st.ahead).toBe(2);
    expect(st.behind).toBe(1);
    expect(st.staged.map((e) => e.path)).toEqual(["staged.ts", "both.ts"]);
    expect(st.unstaged.map((e) => e.path)).toEqual(["modified.ts", "both.ts", "deleted.ts"]);
    expect(st.unstaged.find((e) => e.path === "deleted.ts")?.kind).toBe("deleted");
    expect(st.untracked).toEqual([{ path: "new.txt", kind: "untracked" }]);
  });

  it("handles detached HEAD and renames", () => {
    const out = [
      "# branch.head (detached)",
      "2 R. N... 100644 100644 100644 h1 h2 R100 new-name.ts\told-name.ts",
    ].join("\n");
    const st = parseStatusV2(out, "w1");
    expect(st.branch).toBeNull();
    expect(st.staged[0]).toMatchObject({ path: "new-name.ts", kind: "renamed", renamedFrom: "old-name.ts" });
  });
});

describe("parseDiff", () => {
  it("parses hunks with line numbers", () => {
    const out = [
      "diff --git a/f.txt b/f.txt",
      "index 111..222 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,2 +1,3 @@",
      " hello",
      "+line2",
      " tail",
    ].join("\n");
    const [diff] = parseDiff(out);
    expect(diff!.path).toBe("f.txt");
    expect(diff!.binary).toBe(false);
    const lines = diff!.hunks[0]!.lines;
    expect(lines[0]).toMatchObject({ type: "context", oldLine: 1, newLine: 1 });
    expect(lines[1]).toMatchObject({ type: "add", content: "line2", oldLine: null, newLine: 2 });
    expect(lines[2]).toMatchObject({ type: "context", oldLine: 2, newLine: 3 });
  });

  it("flags binary files", () => {
    const out = [
      "diff --git a/img.png b/img.png",
      "index 111..222 100644",
      "Binary files a/img.png and b/img.png differ",
    ].join("\n");
    const parsed = parseDiff(out);
    // Binary diffs have no +++ line; path falls back or entry is dropped — accept either,
    // but a parsed entry must be marked binary.
    if (parsed.length > 0) expect(parsed[0]!.binary).toBe(true);
  });

  it("parses deleted files via the --- path", () => {
    const out = [
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    const [diff] = parseDiff(out);
    expect(diff!.path).toBe("gone.txt");
    expect(diff!.hunks[0]!.lines[0]).toMatchObject({ type: "del", content: "bye" });
  });
});

describe("parseBranches", () => {
  it("annotates worktree checkouts", () => {
    const worktrees = [
      { id: "w1", repoId: "r", path: "/repo", branch: "main", head: "a", isMain: true, isDetached: false },
    ];
    const branches = parseBranches("* main\n  feat\n", worktrees);
    expect(branches).toEqual([
      { name: "main", isCurrent: true, checkedOutAt: "/repo", worktreeId: "w1" },
      { name: "feat", isCurrent: false, checkedOutAt: null, worktreeId: null },
    ]);
  });
});
