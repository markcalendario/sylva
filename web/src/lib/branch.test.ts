import { describe, expect, it } from "vitest";
import { branchFor, slugifyBranch, worktreeLabel } from "./branch";

describe("slugifying a name", () => {
  it("makes a typed phrase into a ref", () => {
    expect(slugifyBranch("Night Mode")).toBe("night-mode");
  });

  it("drops what git refuses", () => {
    expect(slugifyBranch("fix: the ~thing~ (again)?")).toBe("fix-the-thing-again");
  });

  it("collapses runs and trims the edges", () => {
    expect(slugifyBranch("  --a  --  b--  ")).toBe("a-b");
    expect(slugifyBranch("a..b")).toBe("a.b");
  });

  it("keeps a slash someone typed on purpose", () => {
    expect(slugifyBranch("auth/login")).toBe("auth/login");
  });

  it("is empty when there was nothing usable", () => {
    expect(slugifyBranch("~~~")).toBe("");
  });
});

describe("building the branch", () => {
  it("prefixes with the kind", () => {
    expect(branchFor("feature", "Night Mode")).toBe("feature/night-mode");
    expect(branchFor("fix", "Prescription Settings")).toBe("fix/prescription-settings");
    expect(branchFor("docs", "readme pass")).toBe("docs/readme-pass");
  });

  it("leaves a name that already carries a prefix alone", () => {
    expect(branchFor("feature", "chore/deps")).toBe("chore/deps");
    // Newly true of fix/ as well, now that it is one of the four.
    expect(branchFor("feature", "fix/login")).toBe("fix/login");
  });

  it("is empty when the name is", () => {
    expect(branchFor("chore", "   ")).toBe("");
  });
});

describe("what a worktree is called on screen", () => {
  it("is the last segment", () => {
    expect(worktreeLabel("feature/night-mode", "x")).toBe("night-mode");
    expect(worktreeLabel("a/b/c", "x")).toBe("c");
  });

  it("is the whole branch when there is no prefix", () => {
    expect(worktreeLabel("main", "x")).toBe("main");
  });

  it("falls back when the head is detached", () => {
    expect(worktreeLabel(null, "a1b2c3d")).toBe("a1b2c3d");
  });
});
