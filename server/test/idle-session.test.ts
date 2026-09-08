import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "sylva-shared";
import { GitService } from "../src/services/git.js";
import { SessionManager } from "../src/services/sessions.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";
import type { WatcherManager } from "../src/services/watcher.js";
import type { WsHub } from "../src/ws/hub.js";

const WORKTREE = "abc123worktree";
const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * A session with nothing to do is still a CLI process holding a third of a
 * gigabyte, and a session is per worktree. A few worktrees left open over
 * lunch is a gigabyte of resident memory thinking about nothing, which on a
 * 16GB laptop is the difference between working and swapping.
 *
 * Letting the process go is safe because `sdkSessionId` is persisted and the
 * next prompt resumes from it — so what these check is that it is let go when
 * it is genuinely idle, and held on to whenever it isn't.
 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), "sylva-idle-"));
  const store = new Store(home);
  await store.init();

  const workspace = new Workspace(store, new GitService());
  const watchers = { addSessionWatch() {}, removeSessionWatch() {} } as unknown as WatcherManager;
  const hub = { broadcast(_e: ServerEvent) {} } as unknown as WsHub;
  const sessions = new SessionManager(store, workspace, watchers, hub);

  let ended = false;
  let interrupted = false;
  const session = {
    info: {
      id: "sess-1",
      worktreeId: WORKTREE,
      branch: "main",
      status: "running" as string,
      sdkSessionId: "sdk-abc",
      totalCostUsd: 0,
      totalTokens: 0,
      queuedPrompts: [] as { id: string; text: string }[],
      backgroundTasks: [] as { id: string; description: string }[],
      createdAt: new Date().toISOString(),
    },
    worktreePath: "/tmp/nowhere",
    repoId: "repo-1",
    isGrove: false,
    watch: [],
    input: {
      push() {},
      end() {
        ended = true;
      },
    },
    q: {
      async interrupt() {
        interrupted = true;
      },
    },
    alwaysAllow: new Set<string>(),
    pendingPermissions: new Map(),
    loopDone: null,
    idleTimer: null,
    tasks: new Map<string, string>(),
    taskSetSeen: false,
    cleared: false,
  };

  const inner = sessions as unknown as {
    sessions: Map<string, unknown>;
    byWorktree: Map<string, string>;
    handleMessage: (session: unknown, message: unknown) => void;
  };
  // Registered as a live session, because letting one go checks that it is
  // still the session it was before ending anything.
  inner.sessions.set(session.info.id, session);
  inner.byWorktree.set(WORKTREE, session.info.id);

  const finished = () =>
    inner.handleMessage.call(sessions, session, {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    });

  return { sessions, session, finished, wasEnded: () => ended, wasInterrupted: () => interrupted };
}

describe("an idle session's CLI process", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is let go once the session has sat idle long enough", async () => {
    const { session, finished, wasEnded, wasInterrupted } = await harness();
    finished();
    expect(session.info.status).toBe("idle");

    // Still there a quarter of an hour short of the mark.
    await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - 1000);
    expect(wasEnded()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(wasEnded()).toBe(true);
    expect(wasInterrupted()).toBe(true);
  });

  it("keeps the conversation, so the next prompt picks it up where it was", async () => {
    const { session, finished } = await harness();
    finished();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES + 1000);
    // What `create` passes as `resume`. Losing it would start a new
    // conversation rather than continuing this one.
    expect(session.info.sdkSessionId).toBe("sdk-abc");
  });

  it("is held on to while a prompt is still waiting to be sent", async () => {
    const { session, finished, wasEnded } = await harness();
    finished();
    session.info.queuedPrompts.push({ id: "q1", text: "and then this" });

    await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES + 1000);
    expect(wasEnded()).toBe(false);
  });

  it("is held on to while a permission is waiting on an answer", async () => {
    const { session, finished, wasEnded } = await harness();
    finished();
    session.pendingPermissions.set("req-1", {} as never);

    await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES + 1000);
    expect(wasEnded()).toBe(false);
  });

  it("is held on to when the session goes back to work before the time is up", async () => {
    const { sessions, session, finished, wasEnded } = await harness();
    finished();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - 5000);

    // A prompt, and the clock should be off entirely rather than merely later.
    (sessions as unknown as { dispatch(s: unknown, t: string): void }).dispatch(
      session,
      "one more thing",
    );
    expect(session.info.status).toBe("running");

    await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES * 2);
    expect(wasEnded()).toBe(false);
  });
});
