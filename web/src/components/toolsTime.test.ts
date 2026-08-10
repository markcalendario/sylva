import { describe, expect, it } from "vitest";
import { readMoment, relativeTo } from "./ToolsView";

/**
 * Reading a timestamp out of whatever was pasted in.
 *
 * The heuristic that matters is digit count: the same number is a different
 * moment read as seconds or as milliseconds, and getting it backwards puts the
 * answer fifty thousand years out rather than slightly wrong.
 */
describe("reading a moment", () => {
  it("reads ten digits as seconds since the epoch", () => {
    expect(readMoment("1754812800")?.toISOString()).toBe("2025-08-10T08:00:00.000Z");
  });

  it("reads thirteen digits as milliseconds", () => {
    expect(readMoment("1754812800000")?.toISOString()).toBe("2025-08-10T08:00:00.000Z");
  });

  it("reads sixteen digits as microseconds", () => {
    expect(readMoment("1754812800000000")?.toISOString()).toBe("2025-08-10T08:00:00.000Z");
  });

  it("reads an ISO string", () => {
    expect(readMoment("2025-08-10T08:00:00Z")?.toISOString()).toBe("2025-08-10T08:00:00.000Z");
  });

  it("reads the epoch itself rather than treating 0 as nothing", () => {
    expect(readMoment("0")?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("reads a negative timestamp as a date before the epoch", () => {
    expect(readMoment("-86400")?.toISOString()).toBe("1969-12-31T00:00:00.000Z");
  });

  it("ignores surrounding whitespace", () => {
    expect(readMoment("  1754812800  ")?.toISOString()).toBe("2025-08-10T08:00:00.000Z");
  });

  it("is nothing for an empty box", () => {
    expect(readMoment("   ")).toBeNull();
  });

  it("is nothing for something that isn't a time", () => {
    expect(readMoment("port 3000")).toBeNull();
  });
});

describe("saying how long ago", () => {
  const from = new Date("2025-08-10T08:00:00Z");

  it("counts backwards in the largest unit that fits", () => {
    expect(relativeTo(new Date("2025-08-10T07:00:00Z"), from)).toContain("hour");
    expect(relativeTo(new Date("2025-08-09T08:00:00Z"), from)).toContain("day");
    expect(relativeTo(new Date("2024-08-10T08:00:00Z"), from)).toContain("year");
  });

  it("counts forwards too", () => {
    expect(relativeTo(new Date("2025-08-10T09:00:00Z"), from)).toMatch(/in|hour/);
  });
});
