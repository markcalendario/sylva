import { describe, expect, it } from "vitest";
import { rollUpChecks } from "../src/services/pr.js";

/**
 * GitHub's check rollup is two different shapes in one array — check runs,
 * which carry a status and a conclusion, and commit statuses, which carry only
 * a state. The card shows one word, so the rules for arriving at that word are
 * worth pinning: a branch reported green when a check has failed is the one
 * mistake here that costs something.
 */
describe("rolling checks up to one word", () => {
  it("says nothing at all when there are no checks", () => {
    expect(rollUpChecks([]).checks).toBe("none");
  });

  it("is passing when every check run succeeded", () => {
    const out = rollUpChecks([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "SUCCESS" },
    ]);
    expect(out).toEqual({ checks: "passing", passed: 2, failed: 0, pending: 0 });
  });

  it("counts neutral and skipped as passing, because they don't block a merge", () => {
    const out = rollUpChecks([
      { status: "COMPLETED", conclusion: "NEUTRAL" },
      { status: "COMPLETED", conclusion: "SKIPPED" },
    ]);
    expect(out.checks).toBe("passing");
  });

  it("is failing the moment one fails, however many passed", () => {
    const out = rollUpChecks([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "FAILURE" },
    ]);
    expect(out).toEqual({ checks: "failing", passed: 2, failed: 1, pending: 0 });
  });

  it("lets failure win over something still running", () => {
    const out = rollUpChecks([
      { status: "IN_PROGRESS" },
      { status: "COMPLETED", conclusion: "FAILURE" },
    ]);
    expect(out.checks).toBe("failing");
  });

  it("is pending while anything is still running, not passing-so-far", () => {
    const out = rollUpChecks([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "QUEUED" },
    ]);
    expect(out).toEqual({ checks: "pending", passed: 1, failed: 0, pending: 1 });
  });

  it("reads a commit status, which has a state and no status", () => {
    expect(rollUpChecks([{ state: "SUCCESS" }]).checks).toBe("passing");
    expect(rollUpChecks([{ state: "FAILURE" }]).checks).toBe("failing");
    expect(rollUpChecks([{ state: "PENDING" }]).checks).toBe("pending");
  });

  it("treats a cancelled run as a failure rather than quietly as a pass", () => {
    expect(rollUpChecks([{ status: "COMPLETED", conclusion: "CANCELLED" }]).checks).toBe("failing");
  });
});
