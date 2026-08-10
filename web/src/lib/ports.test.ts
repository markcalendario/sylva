import { describe, expect, it } from "vitest";
import { MAX_PORTS, parsePorts } from "./ports";

/**
 * Reading a list of ports.
 *
 * The failure that matters is the eager one: this list is handed straight to a
 * button that kills processes, so anything that can't be read has to end up in
 * `error` rather than quietly in `ports`.
 */
describe("parsing a port list", () => {
  it("reads a single port", () => {
    expect(parsePorts("3000")).toEqual({ ports: [3000], error: null });
  });

  it("reads a comma-separated list", () => {
    expect(parsePorts("3000, 5173, 4611").ports).toEqual([3000, 5173, 4611]);
  });

  it("reads a list separated by spaces alone", () => {
    expect(parsePorts("3000 5173").ports).toEqual([3000, 5173]);
  });

  it("reads a range", () => {
    expect(parsePorts("3000-3003").ports).toEqual([3000, 3001, 3002, 3003]);
  });

  it("reads a range with spaces around the dash", () => {
    expect(parsePorts("3000 - 3002").ports).toEqual([3000, 3001, 3002]);
  });

  it("reads an en dash and a double dot as ranges too", () => {
    expect(parsePorts("3000–3001").ports).toEqual([3000, 3001]);
    expect(parsePorts("3000..3001").ports).toEqual([3000, 3001]);
  });

  it("reads a range written backwards", () => {
    expect(parsePorts("3003-3000").ports).toEqual([3000, 3001, 3002, 3003]);
  });

  it("mixes single ports and ranges", () => {
    expect(parsePorts("3000, 5173-5175, 8080").ports).toEqual([3000, 5173, 5174, 5175, 8080]);
  });

  it("keeps the order given and drops repeats", () => {
    expect(parsePorts("5173, 3000, 5173, 3000-3001").ports).toEqual([5173, 3000, 3001]);
  });

  it("is empty for empty input", () => {
    expect(parsePorts("   ")).toEqual({ ports: [], error: null });
  });

  it("rejects anything that isn't a number", () => {
    const parsed = parsePorts("3000, http, 5173");
    expect(parsed.ports).toEqual([3000, 5173]);
    expect(parsed.error).toContain("http");
  });

  it("rejects ports outside the range a port can be", () => {
    expect(parsePorts("0").error).not.toBeNull();
    expect(parsePorts("65536").error).not.toBeNull();
    expect(parsePorts("65535").error).toBeNull();
  });

  it("refuses a range wider than the cap rather than truncating it", () => {
    const parsed = parsePorts("3000-30000");
    expect(parsed.ports).toEqual([]);
    expect(parsed.error).toContain(String(MAX_PORTS));
  });

  it("stops collecting once the cap is reached", () => {
    const parsed = parsePorts(`1-${MAX_PORTS} 9000`);
    expect(parsed.ports).toHaveLength(MAX_PORTS);
    expect(parsed.error).toContain(String(MAX_PORTS));
  });
});
