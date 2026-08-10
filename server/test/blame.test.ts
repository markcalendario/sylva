import { describe, expect, it } from "vitest";
import { parseBlamePorcelain, parseChangedLines } from "../src/lib/parse.js";

/**
 * The two readings behind the editor's gutter and its blame bar. Both are
 * parsers over git's own output, which is stable and terse and has exactly one
 * awkward case each — an uncommitted line, and a hunk with no count.
 */

/** A porcelain block as `git blame --porcelain -L n,n` actually emits one. */
function porcelain(over: Record<string, string> = {}, sha = "c82622fa58f10c8d14931ab75f69a5a1"): string {
  const fields: Record<string, string> = {
    author: "Mark Kenneth Calendario",
    "author-mail": "<markcalendario@gmail.com>",
    "author-time": "1785164198",
    "author-tz": "+0800",
    committer: "Mark Kenneth Calendario",
    "committer-time": "1785164198",
    summary: "Rewrite the README",
    filename: "README.md",
    ...over,
  };
  const body = Object.entries(fields)
    .map(([k, v]) => `${k} ${v}`)
    .join("\n");
  return `${sha} 5 5 1\n${body}\n\tthe source line itself\n`;
}

describe("blaming one line", () => {
  it("reads the author, the commit and the subject", () => {
    const out = parseBlamePorcelain(porcelain(), 5);
    expect(out.committed).toBe(true);
    expect(out.author).toBe("Mark Kenneth Calendario");
    expect(out.authorEmail).toBe("markcalendario@gmail.com");
    expect(out.shortSha).toBe("c82622f");
    expect(out.summary).toBe("Rewrite the README");
    expect(out.line).toBe(5);
  });

  it("turns git's seconds into a real timestamp", () => {
    const out = parseBlamePorcelain(porcelain({ "author-time": "1700000000" }), 5);
    expect(out.authoredAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  /**
   * A line that exists only in the working tree. git blames it to a zero sha
   * and the author "Not Committed Yet" — passing that through as a person's
   * name would be a small lie the UI then has to un-tell.
   */
  it("reports an uncommitted line as uncommitted, not as an author", () => {
    const out = parseBlamePorcelain(
      porcelain({ author: "Not Committed Yet" }, "0".repeat(40)),
      12,
    );
    expect(out.committed).toBe(false);
    expect(out.author).toBe("");
    expect(out.shortSha).toBe("");
    expect(out.authoredAt).toBe("");
  });

  it("survives output it can make no sense of", () => {
    const out = parseBlamePorcelain("", 1);
    expect(out.committed).toBe(false);
    expect(out.line).toBe(1);
  });

  it("stops reading headers at the source line", () => {
    // The line's own text is tab-prefixed; a "summary" written inside the code
    // must not be mistaken for the commit's.
    const out = parseBlamePorcelain(`${porcelain()}\tsummary not-the-commit\n`, 5);
    expect(out.summary).toBe("Rewrite the README");
  });
});

describe("which lines a patch changed", () => {
  it("counts pure additions as added", () => {
    // Nothing removed: these lines weren't there before.
    expect(parseChangedLines("@@ -10,0 +11,3 @@")).toEqual({
      added: [11, 12, 13],
      modified: [],
    });
  });

  it("counts replacements as modified", () => {
    expect(parseChangedLines("@@ -10,2 +10,2 @@")).toEqual({
      added: [],
      modified: [10, 11],
    });
  });

  /** `@@ -5 +5 @@` means one line, written without the count. */
  it("reads a hunk with the count left off", () => {
    expect(parseChangedLines("@@ -5 +5 @@")).toEqual({ added: [], modified: [5] });
  });

  it("has nothing to mark for a pure deletion", () => {
    expect(parseChangedLines("@@ -8,3 +7,0 @@")).toEqual({ added: [], modified: [] });
  });

  it("reads every hunk in a patch, ignoring the rest of it", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "index 111..222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,0 +2,2 @@",
      "+one",
      "+two",
      "@@ -20,1 +22,1 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(parseChangedLines(patch)).toEqual({ added: [2, 3], modified: [22] });
  });

  it("says nothing about an unchanged file", () => {
    expect(parseChangedLines("")).toEqual({ added: [], modified: [] });
  });
});
