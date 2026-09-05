import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "sylva-shared";
import { GitService } from "../src/services/git.js";
import { SessionManager } from "../src/services/sessions.js";
import { Store } from "../src/services/store.js";
import { Workspace } from "../src/services/workspace.js";
import type { WatcherManager } from "../src/services/watcher.js";
import type { WsHub } from "../src/ws/hub.js";

const WORKTREE = "abc123worktree";

/**
 * A turn's result is not always the last word.
 *
 * The SDK ends a turn when the model stops. Background work reporting back —
 * a task finishing, a subagent coming home — starts it again with no prompt
 * from anyone, and a session left idle on that result would show a dryad
 * asleep at the camp while its agent types.
 *
 * The other half matters just as much: while a *subagent* is talking, the
 * model really is idle, and calling that "running" would send the next prompt
 * to the queue to wait behind work that isn't its turn.
 */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  const store = new Store(home);
  await store.init();

  const workspace = new Workspace(store, new GitService());
  const watchers = { addSessionWatch() {}, removeSessionWatch() {} } as unknown as WatcherManager;
  const broadcasts: ServerEvent[] = [];
  const hub = {
    broadcast(event: ServerEvent) {
      broadcasts.push(event);
    },
  } as unknown as WsHub;

  const sessions = new SessionManager(store, workspace, watchers, hub);

  const session = {
    info: {
      id: "sess-1",
      worktreeId: WORKTREE,
      branch: "main",
      status: "running" as string,
      sdkSessionId: "sdk-abc",
      totalCostUsd: 0,
      totalTokens: 0,
      queuedPrompts: [] as unknown[],
      backgroundTasks: [] as { id: string; description: string }[],
      createdAt: new Date().toISOString(),
    },
    worktreePath: "/tmp/nowhere",
    repoId: "repo-1",
    isGrove: false,
    watch: [],
    input: { push() {} },
    q: null,
    alwaysAllow: new Set<string>(),
    pendingPermissions: new Map(),
    loopDone: null,
    tasks: new Map<string, string>(),
    taskSetSeen: false,
    cleared: false,
  };

  // handleMessage is where the SDK's stream turns into a session's state, and
  // it is private for good reason — driving it directly is the only way to ask
  // about an ordering that a real SDK would take a background task to produce.
  const inner = sessions as unknown as {
    handleMessage: (session: unknown, message: unknown) => void;
  };
  const feed = (message: unknown) => inner.handleMessage.call(sessions, session, message);

  /** The end of a turn, as the SDK reports it. */
  const finished = () =>
    feed({
      type: "result",
      subtype: "success",
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    });

  /** The model talking. A subagent's words carry the tool use that spawned it. */
  const said = (text: string, parent: string | null = null) =>
    feed({
      type: "assistant",
      parent_tool_use_id: parent,
      session_id: "sdk-abc",
      message: { content: [{ type: "text", text }] },
    });

  /** One of the SDK's own words about background work. */
  const system = (message: Record<string, unknown>) =>
    feed({ type: "system", session_id: "sdk-abc", uuid: "u1", ...message });

  return { session, broadcasts, finished, said, system };
}

describe("a turn that carries on after its result", () => {
  it("leaves the dryad resting when the turn really ends", async () => {
    const { session, finished } = await harness();
    finished();
    expect(session.info.status).toBe("idle");
  });

  it("puts it back to work when the model starts again on its own", async () => {
    const { session, broadcasts, finished, said } = await harness();
    finished();
    said("The agents are back — here is what they found.");

    expect(session.info.status).toBe("running");
    // And says so, or the sprite and the tab badge go on claiming otherwise.
    const told = broadcasts.filter((e) => e.type === "agent.session");
    expect(told.at(-1)).toMatchObject({ session: { status: "running" } });
  });

  it("doesn't wake it for a subagent still finishing up", async () => {
    const { session, finished, said } = await harness();
    finished();
    said("Reading the third file.", "toolu_01");

    // The model is idle; only its helper is busy. Your next prompt goes
    // straight out rather than queueing behind work that isn't a turn.
    expect(session.info.status).toBe("idle");
  });

  it("leaves an interrupted turn interrupted", async () => {
    const { session, said } = await harness();
    session.info.status = "interrupted";
    said("…as I was saying");

    // Nothing is resuming here: what is arriving is the tail of a turn that
    // was stopped, not the start of one that wasn't.
    expect(session.info.status).toBe("interrupted");
  });
});

/**
 * The gap between the two.
 *
 * A backgrounded subagent runs on after the result that ended the turn, and the
 * session is idle for the whole of it — correctly, because a prompt sent then
 * belongs to the model, not to a queue behind work that isn't its turn. But the
 * dryad was drawn from that idleness alone, so it sat down at the camp while
 * its own subagent was still typing.
 */
describe("work left running after the turn", () => {
  it("says the dryad is busy without claiming it is the dryad's turn", async () => {
    const { session, broadcasts, finished, system } = await harness();
    finished();
    system({ subtype: "task_started", task_id: "t1", description: "Review the diff" });

    expect(session.info.backgroundTasks).toEqual([{ id: "t1", description: "Review the diff" }]);
    // Idle is what decides whether your next prompt is sent or queued, and this
    // is not the dryad's turn — so it has to stay idle.
    expect(session.info.status).toBe("idle");
    expect(broadcasts.at(-1)).toMatchObject({ type: "agent.session" });
  });

  it("takes a task off the list when it reports back", async () => {
    const { session, finished, system } = await harness();
    finished();
    system({ subtype: "task_started", task_id: "t1", description: "Review the diff" });
    system({
      subtype: "task_notification",
      task_id: "t1",
      status: "completed",
      output_file: "/tmp/out",
      summary: "found two things",
    });

    expect(session.info.backgroundTasks).toEqual([]);
  });

  it("takes the whole live set when the SDK hands one over", async () => {
    const { session, finished, system } = await harness();
    finished();
    system({ subtype: "task_started", task_id: "stale", description: "Something older" });
    system({
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: "t1", task_type: "agent", description: "Review the diff" },
        { task_id: "t2", task_type: "bash", description: "Run the tests" },
      ],
    });

    // Replace, not merge: the payload is the whole truth about what is running.
    expect(session.info.backgroundTasks.map((t) => t.id)).toEqual(["t1", "t2"]);

    system({ subtype: "background_tasks_changed", tasks: [] });
    expect(session.info.backgroundTasks).toEqual([]);
  });

  /**
   * The two streams don't agree on order, and only one of them is a statement
   * about what is running *now*. A "started" that arrives after the set has
   * already let that task go would otherwise leave the dryad working at
   * nothing until something else happened to change.
   */
  it("stops listening to the bookends once it has been handed the set", async () => {
    const { session, finished, system } = await harness();
    finished();
    system({ subtype: "background_tasks_changed", tasks: [] });
    system({ subtype: "task_started", task_id: "late", description: "Already finished" });

    expect(session.info.backgroundTasks).toEqual([]);
  });

  /**
   * The set is per-process and nothing is emitted at startup, so a session
   * whose CLI restarts has to forget rather than carry the last one's word.
   */
  it("forgets what the last CLI process was running", async () => {
    const { session, finished, system } = await harness();
    finished();
    system({ subtype: "task_started", task_id: "t1", description: "Run the tests" });
    expect(session.info.backgroundTasks).toHaveLength(1);

    system({ subtype: "init", session_id: "sdk-abc" });
    expect(session.info.backgroundTasks).toEqual([]);
  });

  it("drops a task the moment it is marked finished", async () => {
    const { session, finished, system } = await harness();
    finished();
    system({ subtype: "task_started", task_id: "t1", description: "Run the tests" });
    system({ subtype: "task_updated", task_id: "t1", patch: { status: "running" } });
    expect(session.info.backgroundTasks).toHaveLength(1);

    system({ subtype: "task_updated", task_id: "t1", patch: { status: "failed" } });
    expect(session.info.backgroundTasks).toEqual([]);
  });

  it("keeps quiet when nothing about it changed", async () => {
    const { broadcasts, finished, system } = await harness();
    finished();
    system({ subtype: "task_started", task_id: "t1", description: "Run the tests" });
    const after = broadcasts.length;
    system({ subtype: "task_progress", task_id: "t1", description: "Run the tests", usage: {} });

    // A progress ping every second that re-renders the forest is a cost paid
    // for nothing: the set of live work is the same set it was.
    expect(broadcasts.length).toBe(after);
  });
});
