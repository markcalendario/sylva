import { describe, expect, it } from "vitest";
import { describeTool, locateFile } from "../src/services/sessions.js";

const ROOT = "/Users/me/Desktop/GoRocky Repositories/erp and webapp/core";

describe("describeTool", () => {
  it("strips the cd prefix agents put in front of bash commands", () => {
    // This is the spam case: without stripping, every row reads "cd /Users/…".
    const { summary } = describeTool(
      "Bash",
      { command: `cd "${ROOT}" && pnpm --filter admin test` },
      ROOT,
    );
    expect(summary).toBe("pnpm --filter admin test");
  });

  it("strips repeated and unquoted cd prefixes", () => {
    expect(describeTool("Bash", { command: `cd "${ROOT}" && cd apps/web && ls` }, ROOT).summary).toBe(
      "ls",
    );
    expect(describeTool("Bash", { command: "cd /tmp && echo hi" }, ROOT).summary).toBe("echo hi");
  });

  it("flattens multi-line commands onto one line", () => {
    const { summary } = describeTool("Bash", { command: "git add -A &&\n  git status\n" }, ROOT);
    expect(summary).toBe("git add -A && git status");
  });

  it("shows file paths relative to the worktree", () => {
    const { summary } = describeTool(
      "Read",
      { file_path: `${ROOT}/apps/admin/src/campaigns/page.tsx` },
      ROOT,
    );
    expect(summary).toBe("apps/admin/src/campaigns/page.tsx");
  });

  it("keeps the filename visible when a path is too long to fit", () => {
    const deep = `${ROOT}/${"nested/".repeat(30)}important-file.tsx`;
    const { summary } = describeTool("Read", { file_path: deep }, ROOT);
    expect(summary.startsWith("…")).toBe(true);
    expect(summary.endsWith("important-file.tsx")).toBe(true);
  });

  it("leaves paths outside the worktree absolute", () => {
    const { summary } = describeTool("Read", { file_path: "/etc/hosts" }, ROOT);
    expect(summary).toBe("/etc/hosts");
  });

  it("keeps the full command as detail when the summary is truncated", () => {
    const long = `echo ${"x".repeat(400)}`;
    const { summary, detail } = describeTool("Bash", { command: `cd "${ROOT}" && ${long}` }, ROOT);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(detail).toBe(long);
  });

  it("labels search and task tools by intent", () => {
    expect(describeTool("Grep", { pattern: "sendCampaign" }, ROOT).summary).toBe("sendCampaign");
    expect(describeTool("TodoWrite", { todos: [] }, ROOT).summary).toBe("updated the task list");
    expect(describeTool("Task", { description: "audit mail templates" }, ROOT).summary).toBe(
      "audit mail templates",
    );
  });
});

/**
 * A transcript row that touched a file offers to open it, which means the
 * server has to say *which* file — a worktree and a path inside it. One dryad
 * can tend several worktrees, so "relative to the session" is not an answer.
 */
describe("locating a file a step touched", () => {
  const A = { worktreeId: "wt-a", path: "/repos/alpha" };
  const B = { worktreeId: "wt-b", path: "/repos/beta" };

  it("finds the worktree a path is inside", () => {
    expect(locateFile("/repos/beta/src/index.ts", [A, B])).toEqual({
      worktreeId: "wt-b",
      path: "src/index.ts",
    });
  });

  it("gives up on a path that is in none of them", () => {
    expect(locateFile("/etc/hosts", [A, B])).toBeNull();
  });

  it("picks the innermost when one worktree sits inside another", () => {
    const outer = { worktreeId: "wt-outer", path: "/repos/alpha" };
    const inner = { worktreeId: "wt-inner", path: "/repos/alpha/packages/ui" };
    expect(locateFile("/repos/alpha/packages/ui/Button.tsx", [outer, inner])).toEqual({
      worktreeId: "wt-inner",
      path: "Button.tsx",
    });
  });

  it("won't be talked out of a root by a path that climbs out of it", () => {
    expect(locateFile("/repos/alpha/../beta/secret.ts", [A])).toBeNull();
  });

  it("has nothing to say about the root itself", () => {
    expect(locateFile("/repos/alpha", [A])).toBeNull();
  });

  it("has nothing to say with no roots, which is the grove", () => {
    expect(locateFile("/repos/alpha/x.ts", [])).toBeNull();
  });
});
