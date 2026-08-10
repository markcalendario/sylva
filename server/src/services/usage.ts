import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PlanUsage } from "sylva-shared";
import { now } from "../lib/id.js";

/**
 * How long a usage snapshot is treated as current.
 *
 * The windows it describes move in percentage points over hours, so asking
 * more often than this buys nothing — and asking is not free: without a live
 * session to borrow, every call spawns a Claude Code process.
 */
const FRESH_MS = 60_000;

/** Long enough for a cold process to start and answer; short enough to give up on. */
const ASK_TIMEOUT_MS = 20_000;

/**
 * A prompt that never yields.
 *
 * The SDK wants an async iterable to read turns from, but a usage question is
 * not a turn — it goes over the control channel, and the process only has to be
 * alive to answer it. Ending the stream would end the process before it could.
 */
class SilentInput implements AsyncIterable<SDKUserMessage> {
  private release: (() => void) | null = null;

  /** Let the iterator finish, which lets the SDK tear the process down. */
  end(): void {
    this.release?.();
    this.release = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
}

/** Reject rather than hang forever when the process never answers. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out asking for plan usage")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What is left of the Claude plan behind this machine's login.
 *
 * Sylva used to show what a session had cost in dollars. On a subscription that
 * number is trivia — nothing bills against it, and nobody changes what they do
 * because of it. What actually stops work is a weekly window running out, so
 * that is what this reports instead.
 *
 * The reading is per-machine, not per-worktree: the limits belong to the
 * account, so one snapshot serves every pane, and it is cached and shared
 * rather than fetched per session.
 */
export class UsageService {
  private cached: PlanUsage | null = null;
  private fetchedAtMs = 0;
  /** The flight already in progress, so ten panes asking at once ask once. */
  private inFlight: Promise<PlanUsage> | null = null;

  /**
   * A live session's query, when there is one. Borrowing an already-running
   * process makes this nearly free; the fallback below is what costs.
   */
  borrowQuery: (() => Query | null) | null = null;

  /** The last snapshot, refreshing it in the background when it has gone stale. */
  get(): PlanUsage | null {
    if (Date.now() - this.fetchedAtMs > FRESH_MS) void this.refresh().catch(() => {});
    return this.cached;
  }

  /** The current snapshot, waiting for one if there has never been a reading. */
  async current(): Promise<PlanUsage> {
    if (this.cached && Date.now() - this.fetchedAtMs <= FRESH_MS) return this.cached;
    return this.refresh();
  }

  private async refresh(): Promise<PlanUsage> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read()
      .then((usage) => {
        this.cached = usage;
        this.fetchedAtMs = Date.now();
        return usage;
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        const usage: PlanUsage = {
          available: false,
          subscription: null,
          fiveHour: null,
          sevenDay: null,
          models: [],
          reason,
          fetchedAt: now(),
        };
        // Cache the failure too: a machine without a claude.ai plan would
        // otherwise spawn a process on every single poll, forever.
        this.cached = usage;
        this.fetchedAtMs = Date.now();
        return usage;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async read(): Promise<PlanUsage> {
    const borrowed = this.borrowQuery?.() ?? null;
    if (borrowed) return this.ask(borrowed);

    // Nothing running to borrow, so stand a process up for the question alone.
    const input = new SilentInput();
    const q = query({ prompt: input, options: { cwd: process.cwd() } });
    try {
      // The loop is what pumps the SDK's message handling; without something
      // draining it, the control response never gets delivered.
      const draining = (async () => {
        for await (const _ of q as AsyncIterable<unknown>) {
          // Nothing is prompted, so nothing but control traffic arrives here.
        }
      })().catch(() => {});
      const usage = await this.ask(q);
      input.end();
      await Promise.race([draining, new Promise((r) => setTimeout(r, 1000))]);
      return usage;
    } finally {
      input.end();
      // interrupt() is the SDK's way of saying "stop and clean up"; a process
      // left behind per poll would accumulate one per minute.
      await Promise.resolve(q.interrupt?.()).catch(() => {});
    }
  }

  private async ask(q: Query): Promise<PlanUsage> {
    const raw = await withDeadline(
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      ASK_TIMEOUT_MS,
    );

    const window = (w: { utilization: number | null; resets_at: string | null } | null | undefined) =>
      w ? { utilization: w.utilization, resetsAt: w.resets_at } : null;

    return {
      available: raw.rate_limits_available,
      subscription: raw.subscription_type,
      fiveHour: window(raw.rate_limits?.five_hour),
      sevenDay: window(raw.rate_limits?.seven_day),
      models: (raw.rate_limits?.model_scoped ?? []).map((m) => ({
        name: m.display_name,
        utilization: m.utilization,
        resetsAt: m.resets_at,
      })),
      reason: raw.rate_limits_available
        ? null
        : "Plan limits don't apply to this login — it's an API key or a third-party provider.",
      fetchedAt: now(),
    };
  }
}
