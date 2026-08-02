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
