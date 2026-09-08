import { describe, expect, it } from "vitest";
import { cpuPercent, parseMemInfo, parseVmStat } from "../src/services/machine.js";

describe("cpuPercent", () => {
  it("is the share of ticks that weren't idle", () => {
    const from = { idle: 1000, total: 2000, at: 0 };
    const to = { idle: 1100, total: 2400, at: 1000 };
    expect(cpuPercent(from, to)).toBe(75);
  });

  it("says nothing rather than zero when the counters didn't move", () => {
    const sample = { idle: 1000, total: 2000, at: 0 };
    expect(cpuPercent(sample, sample)).toBeNull();
  });
});

/** Trimmed from a real `vm_stat`, keeping the lines the reading depends on. */
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    27040.
Pages active:                                 398543.
Pages inactive:                               389850.
Pages wired down:                             117722.
Pages purgeable:                                8140.
Anonymous pages:                              487373.
Pages occupied by compressor:                  70839.
`;

describe("parseVmStat", () => {
  it("counts memory the way Activity Monitor does", () => {
    // anonymous - purgeable + wired + compressed, in 16 KiB pages.
    const pages = 487373 - 8140 + 117722 + 70839;
    expect(parseVmStat(VM_STAT)).toBe(pages * 16384);
  });

  it("leaves out the page cache, so a busy machine isn't reported as full", () => {
    const used = parseVmStat(VM_STAT) as number;
    const resident = (27040 + 398543 + 389850 + 117722 + 70839) * 16384;
    expect(used).toBeLessThan(resident);
  });

  it("gives up rather than guess when the output isn't what it expects", () => {
    expect(parseVmStat("vm_stat: command not found")).toBeNull();
  });
});

describe("parseMemInfo", () => {
  it("treats reclaimable cache as available, not as used", () => {
    const meminfo = `MemTotal:       16000000 kB
MemFree:          200000 kB
MemAvailable:    8000000 kB
Cached:          7000000 kB
`;
    expect(parseMemInfo(meminfo)).toBe(8000000 * 1024);
  });

  it("returns null when MemAvailable is missing", () => {
    expect(parseMemInfo("MemTotal:       16000000 kB\nMemFree:          200000 kB\n")).toBeNull();
  });
});
