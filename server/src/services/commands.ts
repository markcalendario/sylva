import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentCommand } from "sylva-shared";

/**
 * How long a directory's command list is treated as current.
 *
 * Long, because the list only changes when a file changes — a skill added, a
 * command written into `.claude/commands` — and asking is not free: without a
 * live session to borrow, every miss spawns a Claude Code process. Short enough
 * that a skill you just wrote shows up while you still remember writing it.
 */
const FRESH_MS = 2 * 60_000;

/** Long enough for a cold process to start and answer; short enough to give up on. */
const ASK_TIMEOUT_MS = 20_000;

/**
 * A prompt that never yields.
 *
 * The SDK wants an async iterable to read turns from, but "what commands do you
 * have" is not a turn — it goes over the control channel, and the process only
 * has to be alive to answer it. Ending the stream would end the process before
 * it could.
 */
class SilentInput implements AsyncIterable<SDKUserMessage> {
  private release: (() => void) | null = null;

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
        timer = setTimeout(() => reject(new Error("Timed out asking for commands")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Cached {
  commands: AgentCommand[];
  atMs: number;
}

/**
 * The slash commands a dryad will answer to, so the prompt box can offer them.
 *
 * Typing `/` into Claude Code lists what it can do; typing `/` into Sylva used
 * to list nothing, and the commands were still there — you simply had to
 * remember them, and remember which of them this particular repository added.
 * This asks the thing that knows.
 *
 * Cached per target rather than globally: skills and `.claude/commands` belong
 * to a directory, so two worktrees genuinely have two answers.
 */
export class CommandsService {
  private cache = new Map<string, Cached>();
  private inFlight = new Map<string, Promise<AgentCommand[]>>();

  constructor(
    /** Where a target runs. */
    private readonly cwdFor: (targetId: string) => Promise<string>,
    /**
     * A live process already running there, when there is one. Borrowing costs
     * nothing; the fallback below spawns.
     */
    private readonly borrowQuery: (targetId: string) => Query | null,
  ) {}

  async list(targetId: string): Promise<AgentCommand[]> {
    const fresh = this.cache.get(targetId);
    if (fresh && Date.now() - fresh.atMs <= FRESH_MS) return fresh.commands;

    // Ten panes asking at once ask once.
    const already = this.inFlight.get(targetId);
    if (already) return already;

    const flight = this.read(targetId)
      .then((commands) => {
        this.cache.set(targetId, { commands, atMs: Date.now() });
        return commands;
      })
      .catch(() => {
        // A machine that can't answer this shouldn't be asked again on every
        // keystroke. An empty list simply means the popup doesn't appear.
        this.cache.set(targetId, { commands: [], atMs: Date.now() });
        return [] as AgentCommand[];
      })
      .finally(() => {
        this.inFlight.delete(targetId);
      });
    this.inFlight.set(targetId, flight);
    return flight;
  }

  private async read(targetId: string): Promise<AgentCommand[]> {
    const borrowed = this.borrowQuery(targetId);
    if (borrowed) return this.ask(borrowed);

    const cwd = await this.cwdFor(targetId);
    const input = new SilentInput();
    const q = query({ prompt: input, options: { cwd } });
    try {
      // The loop is what pumps the SDK's message handling; without something
      // draining it, the control response never gets delivered.
      const draining = (async () => {
        for await (const _ of q as AsyncIterable<unknown>) {
          // Nothing is prompted, so nothing but control traffic arrives here.
        }
      })().catch(() => {});
      const commands = await this.ask(q);
      input.end();
      await Promise.race([draining, new Promise((r) => setTimeout(r, 1000))]);
      return commands;
    } finally {
      input.end();
      // interrupt() is the SDK's way of saying "stop and clean up"; a process
      // left behind per ask would accumulate one per worktree.
      await Promise.resolve(q.interrupt?.()).catch(() => {});
    }
  }

  private async ask(q: Query): Promise<AgentCommand[]> {
    const raw = await withDeadline(q.supportedCommands(), ASK_TIMEOUT_MS);
    return raw
      .map((c) => ({
        name: c.name,
        description: c.description ?? "",
        argumentHint: c.argumentHint ?? "",
        ...(c.aliases?.length ? { aliases: c.aliases } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
