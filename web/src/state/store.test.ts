import { beforeEach, describe, expect, it } from "vitest";
import { GROVE_ID, type SessionInfo } from "sylva-shared";
import { orderWorktrees, spriteStateFor, useSylva } from "./store";

/**
 * A dryad walks to the grove when a turn lands without you, and back to the
 * camp once you've looked. Both halves used to hang off "focused", which stops
 * meaning "on screen" the moment a pane can hold a worktree while the Forest
 * map or the Settings page covers it.
 */
function result(worktreeId: string) {
  useSylva.getState().applyServerEvent({
    type: "agent.event",
    sessionId: "s1",
    worktreeId,
    event: { kind: "result", outcome: "success", at: new Date().toISOString() },
  });
}

function stateOf(worktreeId: string) {
  return spriteStateFor(useSylva.getState(), worktreeId);
}

/** Put the pane on a worktree without going through the server. */
function showPane(worktreeId: string | null) {
  useSylva.getState().setPaneWorktree(worktreeId);
}

describe("celebrating a finished turn", () => {
  beforeEach(() => {
    useSylva.setState({
      celebrating: {},
      unseenActivity: {},
      sessions: {},
      pendingPermissions: {},
      view: "workspace",
      focusedWorktreeId: null,
    });
    showPane(null);
  });

  it("sends the dryad to the grove when the turn lands out of sight", () => {
    result("wt-a");
    expect(stateOf("wt-a")).toBe("success");
  });

  it("stays put when you are watching that worktree", () => {
    showPane("wt-a");
    result("wt-a");
    // You saw it finish; being asked to acknowledge it is being asked twice.
    expect(stateOf("wt-a")).toBe("idle");
  });

  it("celebrates a turn that lands while the Forest map is up", () => {
    // A pane still holds it and focus still names it, but the map is what's on
    // screen — which is exactly the case that used to be silently swallowed.
    showPane("wt-a");
    useSylva.setState({ view: "settings" });
    result("wt-a");
    expect(stateOf("wt-a")).toBe("success");
  });

  it("goes back to the camp once the worktree is actually on screen", () => {
    result("wt-a");
    expect(stateOf("wt-a")).toBe("success");

    showPane("wt-a");
    useSylva.getState().acknowledgeVisible();
    expect(stateOf("wt-a")).toBe("idle");
  });

  it("does not clear a worktree that is merely focused", () => {
    result("wt-a");
    // Focus alone is not looking: the Settings page is covering the pane.
    useSylva.setState({ focusedWorktreeId: "wt-a", view: "settings" });
    showPane("wt-a");
    useSylva.getState().acknowledgeVisible();
    expect(stateOf("wt-a")).toBe("success");
  });

  it("leaves other worktrees celebrating", () => {
    result("wt-a");
    result("wt-b");
    showPane("wt-a");
    useSylva.getState().acknowledgeVisible();

    expect(stateOf("wt-a")).toBe("idle");
    expect(stateOf("wt-b")).toBe("success");
  });

  it("acknowledges the grove only while the grove is open", () => {
    result(GROVE_ID);
    expect(stateOf(GROVE_ID)).toBe("success");

    useSylva.getState().acknowledgeVisible();
    expect(stateOf(GROVE_ID)).toBe("success");

    useSylva.setState({ view: "grove" });
    useSylva.getState().acknowledgeVisible();
    expect(stateOf(GROVE_ID)).toBe("idle");
  });

  it("clears the unseen dot along with the celebration", () => {
    result("wt-a");
    expect(useSylva.getState().unseenActivity["wt-a"]).toBe(true);

    showPane("wt-a");
    useSylva.getState().acknowledgeVisible();
    expect(useSylva.getState().unseenActivity["wt-a"]).toBe(false);
  });

  it("keeps a blocked dryad at the notice board even after you look", () => {
    useSylva.setState({
      pendingPermissions: {
        "wt-a": [
          {
            id: "p1",
            sessionId: "s1",
            worktreeId: "wt-a",
            tool: "Bash",
            summary: "rm -rf /",
            input: {},
            requestedAt: new Date().toISOString(),
          },
        ],
      },
    });
    showPane("wt-a");
    useSylva.getState().acknowledgeVisible();
    // Looking at it is not answering it. And it is *blocked*, not errored —
    // asking whether it may run a command is not a failure, and the two used
    // to share a state and therefore a colour.
    expect(stateOf("wt-a")).toBe("blocked");
  });
});

/**
 * A turn ending is not the work ending.
 *
 * A subagent left running in the background keeps talking long after the result
 * that ended the dryad's turn, and the session is genuinely idle in between —
 * you can prompt it, and the prompt goes straight through. The sprite used to
 * read that idleness as rest and sit the dryad down mid-sentence.
 */
describe("a dryad with work still running behind it", () => {
  const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
    id: "s1",
    worktreeId: "wt-a",
    branch: "main",
    status: "idle",
    settings: { permissionMode: "acceptEdits", model: null, effort: null },
    sdkSessionId: null,
    totalCostUsd: 0,
    totalTokens: 0,
    queuedPrompts: [],
    backgroundTasks: [],
    createdAt: new Date().toISOString(),
    ...over,
  });

  beforeEach(() => {
    useSylva.setState({
      celebrating: {},
      unseenActivity: {},
      sessions: {},
      pendingPermissions: {},
      view: "workspace",
      focusedWorktreeId: null,
    });
    showPane(null);
  });

  it("keeps working while a background task is still running", () => {
    useSylva
      .getState()
      .setSession(
        "wt-a",
        session({ backgroundTasks: [{ id: "t1", description: "Review the diff" }] }),
      );
    expect(stateOf("wt-a")).toBe("working");
  });

  it("rests once the last one reports back", () => {
    useSylva.getState().setSession("wt-a", session({ backgroundTasks: [] }));
    expect(stateOf("wt-a")).toBe("idle");
  });

  /**
   * Background work is not the dryad's turn, so it must not outrank the two
   * things that actually want you — a decision, or an error.
   */
  it("still yields to anything that needs you", () => {
    useSylva.getState().setSession(
      "wt-a",
      session({
        status: "errored",
        backgroundTasks: [{ id: "t1", description: "Run the tests" }],
      }),
    );
    expect(stateOf("wt-a")).toBe("error");
  });
});

/**
 * A cleared dryad has to look untouched afterwards. The transcript is the
 * obvious half; the easy thing to leave behind is the rest of what the old
 * conversation set — a celebration, an unseen dot, a session line in the header
 * still quoting what the forgotten turns cost.
 */
describe("clearing a dryad", () => {
  const cleared = (worktreeId: string) =>
    useSylva.getState().applyServerEvent({ type: "agent.cleared", worktreeId });

  beforeEach(() => {
    useSylva.setState({
      celebrating: {},
      unseenActivity: {},
      sessions: {},
      transcripts: {},
      pendingPermissions: {},
      drafts: {},
      view: "workspace",
    });
    showPane(null);
  });

  it("empties the transcript and puts the dryad back to resting", () => {
    result("wt-a");
    expect(useSylva.getState().transcripts["wt-a"]).toHaveLength(1);
    expect(stateOf("wt-a")).toBe("success");

    cleared("wt-a");

    expect(useSylva.getState().transcripts["wt-a"]).toBeUndefined();
    expect(useSylva.getState().sessions["wt-a"]).toBeUndefined();
    expect(useSylva.getState().unseenActivity["wt-a"]).toBeUndefined();
    expect(stateOf("wt-a")).toBe("idle");
  });

  it("keeps what you had already typed", () => {
    useSylva.getState().setDraft("wt-a", { text: "half a thought" });
    cleared("wt-a");
    // Clearing is usually the prelude to asking again; discarding the draft
    // would be a second deletion nobody asked for.
    expect(useSylva.getState().drafts["wt-a"]?.text).toBe("half a thought");
  });

  it("leaves every other dryad exactly as it was", () => {
    result("wt-a");
    result("wt-b");

    cleared("wt-a");

    expect(useSylva.getState().transcripts["wt-b"]).toHaveLength(1);
    expect(stateOf("wt-b")).toBe("success");
  });
});

/**
 * Option+Tab walks the tab strip. The wrap is the part worth pinning down: the
 * ask was that Terminal steps round to Agent rather than stopping at the end.
 */
describe("cycling the pane's tabs", () => {
  beforeEach(() => {
    useSylva.setState({ view: "workspace" });
    showPane("wt-a");
    useSylva.getState().setPaneTab("agent");
  });

  const tab = () => useSylva.getState().pane.tab;

  it("steps forward through the strip", () => {
    const { cycleActiveTab } = useSylva.getState();
    cycleActiveTab(1);
    expect(tab()).toBe("files");
    cycleActiveTab(1);
    expect(tab()).toBe("git");
    cycleActiveTab(1);
    expect(tab()).toBe("terminal");
  });

  it("wraps from Terminal back to Agent", () => {
    const { cycleActiveTab, setPaneTab } = useSylva.getState();
    setPaneTab("terminal");
    cycleActiveTab(1);
    expect(tab()).toBe("agent");
  });

  it("walks backwards, wrapping the other way", () => {
    useSylva.getState().cycleActiveTab(-1);
    expect(tab()).toBe("terminal");
  });

  it("does nothing while the settings page covers the tabs", () => {
    useSylva.setState({ view: "settings" });
    useSylva.getState().cycleActiveTab(1);
    expect(tab()).toBe("agent");
  });

  it("does nothing in an empty pane, which has no tabs to step through", () => {
    showPane(null);
    useSylva.getState().cycleActiveTab(1);
    expect(tab()).toBe("agent");
  });
});

/**
 * A tab belongs to the worktree you were reading, not to the pane you were
 * reading it in. Leaving one tree at its Terminal used to put every tree you
 * opened afterwards into a terminal too.
 */
describe("remembering the tab per worktree", () => {
  beforeEach(() => {
    useSylva.setState({ tabByWorktree: {}, view: "workspace" });
    showPane(null);
  });

  it("restores the tab a worktree was left on", () => {
    showPane("wt-a");
    useSylva.getState().setPaneTab("terminal");

    showPane("wt-b");
    expect(useSylva.getState().pane.tab).toBe("agent");

    showPane("wt-a");
    expect(useSylva.getState().pane.tab).toBe("terminal");
  });

  it("does not drag one worktree's tab onto another", () => {
    showPane("wt-a");
    useSylva.getState().setPaneTab("git");
    showPane("wt-b");
    expect(useSylva.getState().pane.tab).toBe("agent");
    expect(useSylva.getState().tabByWorktree["wt-b"]).toBeUndefined();
  });

  it("counts stepping with the keyboard as choosing a tab", () => {
    showPane("wt-a");
    useSylva.getState().cycleActiveTab(1);
    expect(useSylva.getState().tabByWorktree["wt-a"]).toBe("files");
  });

  it("remembers the tab an opened diff switched to", () => {
    showPane("wt-a");
    useSylva.getState().setPaneDiff({ worktreeId: "wt-a", path: "a.ts", staged: false }, "git");
    expect(useSylva.getState().tabByWorktree["wt-a"]).toBe("git");
  });

  it("starts a worktree it has never seen on the agent", () => {
    showPane("wt-new");
    expect(useSylva.getState().pane.tab).toBe("agent");
  });
});

describe("the sidebar's own order", () => {
  const trees = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("leaves git's order alone when nothing has been arranged", () => {
    expect(orderWorktrees(trees, []).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("follows the arrangement", () => {
    expect(orderWorktrees(trees, ["c", "a", "b"]).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("puts a worktree created since at the end, in git's order", () => {
    // "d" and "e" were made after the list was last arranged.
    const later = [...trees, { id: "d" }, { id: "e" }];
    expect(orderWorktrees(later, ["c", "a"]).map((t) => t.id)).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("ignores an id whose worktree is gone", () => {
    expect(orderWorktrees(trees, ["z", "c", "a", "b"]).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

describe("waiting and failing are different news", () => {
  const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
    id: "s1",
    worktreeId: "wt-a",
    branch: "main",
    status: "idle",
    settings: { permissionMode: "acceptEdits", model: null, effort: null },
    sdkSessionId: null,
    totalCostUsd: 0,
    totalTokens: 0,
    queuedPrompts: [],
    backgroundTasks: [],
    createdAt: new Date().toISOString(),
    ...over,
  });

  it("calls a pending permission blocked, not an error", () => {
    useSylva.setState({
      pendingPermissions: {
        "wt-a": [
          {
            id: "p1",
            sessionId: "s1",
            worktreeId: "wt-a",
            tool: "Bash",
            summary: "git push",
            input: {},
            requestedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(stateOf("wt-a")).toBe("blocked");
  });

  it("still calls an errored session an error", () => {
    useSylva.getState().setSession("wt-a", session({ status: "errored" }));
    expect(stateOf("wt-a")).toBe("error");
  });

  it("lets a real failure outrank a question", () => {
    // A session that errored *and* has a request outstanding is broken, and
    // the louder, redder reading is the honest one.
    useSylva.getState().setSession("wt-a", session({ status: "errored" }));
    useSylva.setState({
      pendingPermissions: {
        "wt-a": [
          {
            id: "p2",
            sessionId: "s1",
            worktreeId: "wt-a",
            tool: "Bash",
            summary: "ls",
            input: {},
            requestedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(stateOf("wt-a")).toBe("error");
  });
});
