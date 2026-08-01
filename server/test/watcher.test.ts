import { describe, expect, it } from "vitest";
import { isIgnored } from "../src/services/watcher.js";

describe("watcher ignore rules", () => {
  it("watches ordinary source files", () => {
    expect(isIgnored("src/index.ts")).toBe(false);
    expect(isIgnored("README.md")).toBe(false);
    expect(isIgnored("apps/web/src/deeply/nested/file.tsx")).toBe(false);
  });

  it("ignores heavy directories at any depth", () => {
    // These are what exhaust the descriptor table on real repos.
    expect(isIgnored("node_modules/react/index.js")).toBe(true);
    expect(isIgnored("apps/web/node_modules/pkg/a.js")).toBe(true);
    expect(isIgnored(".git/objects/ab/cdef")).toBe(true);
    expect(isIgnored("dist/bundle.js")).toBe(true);
    expect(isIgnored("packages/api/.venv/lib/python3/site.py")).toBe(true);
  });

  it("ignores paths escaping the worktree root and empty paths", () => {
    expect(isIgnored("../outside.txt")).toBe(true);
    expect(isIgnored("")).toBe(true);
  });

  it("does not ignore files whose names merely contain a blocked word", () => {
    expect(isIgnored("src/node_modules_helper.ts")).toBe(false);
    expect(isIgnored("docs/dist-strategy.md")).toBe(false);
  });
});
