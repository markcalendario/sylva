import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import type { MachineLoad } from "sylva-shared";
import { now } from "../lib/id.js";

const run = promisify(execFile);

/**
 * How hard this machine is working.
 *
 * Two numbers, and neither of them is the obvious one. CPU has to be a delta —
 * `os.cpus()` reports ticks since boot, so a single reading describes the whole
 * uptime rather than the last few seconds. And memory has to be asked for
 * platform by platform, because `os.freemem()` answers a question nobody meant
 * to ask: on macOS it counts pages the kernel is deliberately holding as cache,
 * so a healthy laptop reports ninety-odd percent used, forever. A footer that
 * is permanently red is a footer nobody reads.
 */

/** One reading of the tick counters, kept so the next one can be a difference. */
export interface CpuSample {
  idle: number;
  total: number;
  at: number;
}

/**
 * Shortest window worth measuring. Under this the tick counters have barely
 * moved and the percentage is mostly rounding.
 */
const MIN_WINDOW_MS = 200;

/**
 * Longest a previous sample is still worth differencing against. A reading
 * averaged over five idle minutes says nothing about the turn you are watching
 * right now, so a stale sample is thrown away and a fresh window opened.
 */
const MAX_WINDOW_MS = 30_000;

/** Long enough for vm_stat on a busy machine; short enough not to stall a poll. */
const VM_STAT_TIMEOUT_MS = 3_000;

/** The previous reading, so a poll every few seconds averages over that gap. */
let previous: CpuSample | null = null;

export function sampleCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const [kind, ms] of Object.entries(cpu.times)) {
      total += ms;
      if (kind === "idle") idle += ms;
    }
  }
  return { idle, total, at: Date.now() };
}

/**
 * How busy the cores were between two readings.
 *
 * Null rather than zero when the counters didn't move: "nothing happened" and
 * "I couldn't tell" are different answers, and only one of them is worth
 * printing.
 */
export function cpuPercent(from: CpuSample, to: CpuSample): number | null {
  const total = to.total - from.total;
  if (total <= 0) return null;
  const idle = to.idle - from.idle;
  const busy = ((total - idle) / total) * 100;
  return Math.max(0, Math.min(100, busy));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCpu(): Promise<number | null> {
  if (!previous || Date.now() - previous.at > MAX_WINDOW_MS) previous = sampleCpu();

  const waited = Date.now() - previous.at;
  if (waited < MIN_WINDOW_MS) await delay(MIN_WINDOW_MS - waited);

  const next = sampleCpu();
  const percent = cpuPercent(previous, next);
  previous = next;
  return percent;
}

/**
 * Bytes in use according to `vm_stat`.
 *
 * This is Activity Monitor's "Memory Used", which is the number a Mac owner
 * already has a feel for: anonymous pages that are actually resident, plus what
 * the kernel has wired down, plus what it has had to compress — and minus the
 * purgeable pages, which are anonymous but would be dropped the moment anything
 * else wanted them.
 */
export function parseVmStat(output: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

  const pages = (label: string): number | null => {
    const found = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, "m").exec(output);
    return found ? Number(found[1]) : null;
  };

  const anonymous = pages("Anonymous pages");
  const wired = pages("Pages wired down");
  const compressed = pages("Pages occupied by compressor");
  if (anonymous === null || wired === null || compressed === null) return null;

  const purgeable = pages("Pages purgeable") ?? 0;
  const used = anonymous - purgeable + wired + compressed;
  return Math.max(0, used) * pageSize;
}

/**
 * Bytes in use according to `/proc/meminfo`.
 *
 * MemAvailable rather than MemFree for the same reason as above: Linux spends
 * everything it isn't using on page cache, and counting that as pressure would
 * make every long-running box look full.
 */
export function parseMemInfo(output: string): number | null {
  const kb = (label: string): number | null => {
    const found = new RegExp(`^${label}:\\s+(\\d+) kB$`, "m").exec(output);
    return found ? Number(found[1]) : null;
  };

  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (total === null || available === null) return null;
  return Math.max(0, total - available) * 1024;
}

async function readMemoryUsed(): Promise<number> {
  // The fallback everywhere else, and whenever the platform's own accounting
  // can't be read: wrong on the generous side, but never missing.
  const naive = totalmem() - freemem();
  try {
    if (process.platform === "darwin") {
      const { stdout } = await run("vm_stat", [], { timeout: VM_STAT_TIMEOUT_MS });
      return parseVmStat(stdout) ?? naive;
    }
    if (process.platform === "linux") {
      return parseMemInfo(await readFile("/proc/meminfo", "utf8")) ?? naive;
    }
  } catch {
    // A missing vm_stat or an unreadable /proc is not worth an error in the
    // footer; the rough number is still better than an empty space.
  }
  return naive;
}

/** One reading of both, for the status strip. */
export async function readMachineLoad(): Promise<MachineLoad> {
  const [cpu, memoryUsed] = await Promise.all([readCpu(), readMemoryUsed()]);
  return {
    cpu,
    cores: cpus().length,
    memoryUsed,
    memoryTotal: totalmem(),
    sampledAt: now(),
  };
}

/** Test seam: forget the previous reading so a case starts from a clean slate. */
export function resetCpuSampler(): void {
  previous = null;
}
