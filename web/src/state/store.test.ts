import { beforeEach, describe, expect, it } from "vitest";
import { GROVE_ID } from "sylva-shared";
import { spriteStateFor, useSylva } from "./store";

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

/** Put one pane on a worktree without going through the server. */
function showPane(worktreeId: string | null) {
  const { panes, setPaneWorktree } = useSylva.getState();
  const pane = panes[0];
  if (pane) setPaneWorktree(pane.id, worktreeId);
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
    // Looking at it is not answering it.
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
describe("cycling the active pane's tabs", () => {
  beforeEach(() => {
    useSylva.setState({ view: "workspace" });
    showPane("wt-a");
    const { panes, setPaneTab } = useSylva.getState();
    if (panes[0]) setPaneTab(panes[0].id, "agent");
  });

  const tab = () => useSylva.getState().panes[0]?.tab;

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
    const { cycleActiveTab, setPaneTab, panes } = useSylva.getState();
    if (panes[0]) setPaneTab(panes[0].id, "terminal");
    cycleActiveTab(1);
    expect(tab()).toBe("agent");
  });

  it("walks backwards, wrapping the other way", () => {
    useSylva.getState().cycleActiveTab(-1);
    expect(tab()).toBe("terminal");
  });

  it("only moves the pane you are working in", () => {
    useSylva.getState().splitPane();
    const [first, second] = useSylva.getState().panes;
    if (!first || !second) throw new Error("expected two panes");
    useSylva.getState().cycleActiveTab(1);
    expect(useSylva.getState().panes[1]?.tab).toBe("files");
    expect(useSylva.getState().panes[0]?.tab).toBe("agent");
    useSylva.getState().closePane(second.id);
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

  function paneId(): string {
    const id = useSylva.getState().panes[0]?.id;
    if (!id) throw new Error("expected a pane");
    return id;
  }

  it("restores the tab a worktree was left on", () => {
    showPane("wt-a");
    useSylva.getState().setPaneTab(paneId(), "terminal");

    showPane("wt-b");
    expect(useSylva.getState().panes[0]?.tab).toBe("agent");

    showPane("wt-a");
    expect(useSylva.getState().panes[0]?.tab).toBe("terminal");
  });

  it("does not drag one worktree's tab onto another", () => {
    showPane("wt-a");
    useSylva.getState().setPaneTab(paneId(), "git");
    showPane("wt-b");
    expect(useSylva.getState().panes[0]?.tab).toBe("agent");
    expect(useSylva.getState().tabByWorktree["wt-b"]).toBeUndefined();
  });

  it("counts stepping with the keyboard as choosing a tab", () => {
    showPane("wt-a");
    useSylva.getState().cycleActiveTab(1);
    expect(useSylva.getState().tabByWorktree["wt-a"]).toBe("files");
  });

  it("remembers the tab an opened diff switched to", () => {
    showPane("wt-a");
    useSylva
      .getState()
      .setPaneDiff(paneId(), { worktreeId: "wt-a", path: "a.ts", staged: false }, "git");
    expect(useSylva.getState().tabByWorktree["wt-a"]).toBe("git");
  });

  it("starts a worktree it has never seen on the agent", () => {
    showPane("wt-new");
    expect(useSylva.getState().panes[0]?.tab).toBe("agent");
  });
});
