import { describe, expect, it } from "vitest";
import { CIRCLE_PREFIX, circleId, circleMembers, isSharedTarget, GROVE_ID } from "sylva-shared";

/**
 * The circle id carries its own membership, so these are the rules that decide
 * which conversation you land in. Getting them wrong forks a transcript.
 */
describe("circle ids", () => {
  it("is stable regardless of the order worktrees were picked in", () => {
    expect(circleId(["bbb", "aaa"])).toBe(circleId(["aaa", "bbb"]));
  });

  it("round-trips its members", () => {
    const id = circleId(["aaa", "bbb", "ccc"]);
    expect(circleMembers(id)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("ignores a worktree picked twice", () => {
    expect(circleMembers(circleId(["aaa", "aaa", "bbb"]))).toEqual(["aaa", "bbb"]);
  });

  it("is not a circle with fewer than two worktrees", () => {
    // One worktree is just that worktree; treating it as a circle would give it
    // a second, separate transcript from the one it already has.
    expect(circleMembers(circleId(["aaa"]))).toBeNull();
    expect(circleMembers(CIRCLE_PREFIX)).toBeNull();
  });

  it("leaves ordinary worktree ids and the grove alone", () => {
    expect(circleMembers("d993432bf6fe")).toBeNull();
    expect(circleMembers(GROVE_ID)).toBeNull();
  });

  it("recognizes every id that names a shared session", () => {
    expect(isSharedTarget(GROVE_ID)).toBe(true);
    expect(isSharedTarget(circleId(["aaa", "bbb"]))).toBe(true);
    expect(isSharedTarget("d993432bf6fe")).toBe(false);
  });

  it("lands the same set back in the same conversation", () => {
    // Same worktrees chosen again on another day resolve to the same id, which
    // is the same transcript file — resuming rather than starting over.
    const monday = circleId(["old-system", "new-system"]);
    const friday = circleId(["new-system", "old-system"]);
    expect(monday).toBe(friday);
  });
});
