import { beforeEach, describe, expect, it } from "vitest";
import {
  attentionQueue,
  clampSidebar,
  fileKey,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  useSylva,
} from "./store";

/**
 * The Files tab is an editor now, and an editor's tabs have to behave the way
 * every other editor's do — otherwise the muscle memory you bring to it is
 * wrong in small ways all day. These pin the parts that are easy to get subtly
 * wrong: which tab is left selected after a close, what a cap is allowed to
 * evict, and what happens to text you typed and haven't saved.
 */

const PANE = () => useSylva.getState().panes[0]!;

function reset() {
  useSylva.setState({ fileDrafts: {} });
  const pane = PANE();
  useSylva.setState({
    panes: [{ ...pane, worktreeId: "wt-a", files: [], activeFile: null, tab: "files" }],
    activePaneId: pane.id,
  });
}

function open(path: string, worktreeId = "wt-a") {
  useSylva.getState().openFile(PANE().id, { worktreeId, path });
}

function paths(): string[] {
  return PANE().files.map((f) => f.path);
}

describe("opening files", () => {
  beforeEach(reset);

  it("appends each new file and reads the one just opened", () => {
    open("a.ts");
    open("b.ts");
    expect(paths()).toEqual(["a.ts", "b.ts"]);
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "b.ts" }));
  });

  it("re-selects an already-open file rather than opening it twice", () => {
    open("a.ts");
    open("b.ts");
    open("a.ts");
    expect(paths()).toEqual(["a.ts", "b.ts"]);
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "a.ts" }));
  });

  it("takes you to the Files tab, wherever you were", () => {
    useSylva.setState({ panes: [{ ...PANE(), tab: "agent" }] });
    open("a.ts");
    expect(PANE().tab).toBe("files");
  });

  it("keeps two worktrees' copies of the same path apart", () => {
    open("src/index.ts", "wt-a");
    open("src/index.ts", "wt-b");
    expect(PANE().files).toHaveLength(2);
  });

  it("moves the view when an open file is asked for at a line", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().openFile(PANE().id, { worktreeId: "wt-a", path: "a.ts", line: 42 });
    expect(paths()).toEqual(["a.ts", "b.ts"]);
    expect(PANE().files[0]?.line).toBe(42);
  });

  it("forgets that line once you come back to the tab yourself", () => {
    useSylva.getState().openFile(PANE().id, { worktreeId: "wt-a", path: "a.ts", line: 42 });
    open("b.ts");
    useSylva.getState().setActiveFile(PANE().id, fileKey({ worktreeId: "wt-a", path: "a.ts" }));
    expect(PANE().files[0]?.line).toBeUndefined();
  });
});

describe("closing files", () => {
  beforeEach(reset);

  it("lands on the neighbour to the right", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    useSylva.getState().setActiveFile(PANE().id, fileKey({ worktreeId: "wt-a", path: "b.ts" }));
    useSylva.getState().closeFile(PANE().id, fileKey({ worktreeId: "wt-a", path: "b.ts" }));
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "c.ts" }));
  });

  it("falls back to the last tab when the one closed was last", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().closeFile(PANE().id, fileKey({ worktreeId: "wt-a", path: "b.ts" }));
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "a.ts" }));
  });

  it("leaves nothing selected once the last file goes", () => {
    open("a.ts");
    useSylva.getState().closeFile(PANE().id, fileKey({ worktreeId: "wt-a", path: "a.ts" }));
    expect(PANE().files).toEqual([]);
    expect(PANE().activeFile).toBeNull();
  });

  it("closing a file you weren't reading doesn't move you", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().closeFile(PANE().id, fileKey({ worktreeId: "wt-a", path: "a.ts" }));
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "b.ts" }));
  });

  it("drops the draft with the tab, so nothing invisible survives", () => {
    open("a.ts");
    const key = fileKey({ worktreeId: "wt-a", path: "a.ts" });
    useSylva.getState().setFileDraft(key, "half a thought");
    useSylva.getState().closeFile(PANE().id, key);
    expect(useSylva.getState().fileDrafts[key]).toBeUndefined();
  });
});

/**
 * The tab menu builds a list of keys and hands it to one action. Which list is
 * the menu's business; landing somewhere sensible afterwards is this one's, and
 * it has to agree with what closing the same tabs one at a time would do.
 */
describe("closing several at once", () => {
  beforeEach(reset);

  const key = (path: string) => fileKey({ worktreeId: "wt-a", path });

  it("closes exactly what it is given", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    useSylva.getState().closeFiles(PANE().id, [key("a.ts"), key("c.ts")]);
    expect(paths()).toEqual(["b.ts"]);
  });

  it("closes unsaved files too — the asking happens before it gets here", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().setFileDraft(key("a.ts"), "typed");
    useSylva.getState().closeFiles(PANE().id, [key("a.ts"), key("b.ts")]);
    expect(paths()).toEqual([]);
    expect(useSylva.getState().fileDrafts[key("a.ts")]).toBeUndefined();
  });

  it("lands on the nearest survivor to the right", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    open("d.ts");
    useSylva.getState().setActiveFile(PANE().id, key("b.ts"));
    // Closing the one you're on and its right-hand neighbour.
    useSylva.getState().closeFiles(PANE().id, [key("b.ts"), key("c.ts")]);
    expect(PANE().activeFile).toBe(key("d.ts"));
  });

  it("falls back to the last survivor when nothing is left to the right", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    useSylva.getState().setActiveFile(PANE().id, key("c.ts"));
    useSylva.getState().closeFiles(PANE().id, [key("c.ts")]);
    expect(PANE().activeFile).toBe(key("b.ts"));
  });

  it("leaves you where you were when the closed tabs weren't yours", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    useSylva.getState().setActiveFile(PANE().id, key("c.ts"));
    useSylva.getState().closeFiles(PANE().id, [key("a.ts")]);
    expect(PANE().activeFile).toBe(key("c.ts"));
  });

  it("clears the selection when everything goes", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().closeFiles(PANE().id, [key("a.ts"), key("b.ts")]);
    expect(PANE().activeFile).toBeNull();
  });

  it("does nothing when handed an empty list", () => {
    open("a.ts");
    useSylva.getState().closeFiles(PANE().id, []);
    expect(paths()).toEqual(["a.ts"]);
  });

  it("ignores keys for files that aren't open", () => {
    open("a.ts");
    useSylva.getState().closeFiles(PANE().id, [key("nowhere.ts")]);
    expect(paths()).toEqual(["a.ts"]);
  });
});

describe("the cap on open files", () => {
  beforeEach(reset);

  it("lets the oldest go rather than growing forever", () => {
    for (let i = 0; i < 20; i++) open(`f${i}.ts`);
    expect(PANE().files.length).toBeLessThanOrEqual(14);
    // The one you just opened is never the one evicted.
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "f19.ts" }));
  });

  it("never evicts a file with unsaved edits", () => {
    open("precious.ts");
    useSylva.getState().setFileDraft(fileKey({ worktreeId: "wt-a", path: "precious.ts" }), "work");
    for (let i = 0; i < 30; i++) open(`f${i}.ts`);
    expect(paths()).toContain("precious.ts");
  });
});

describe("stepping and reordering", () => {
  beforeEach(reset);

  it("cycles forward and wraps", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().cycleFile(PANE().id, 1);
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "a.ts" }));
    useSylva.getState().cycleFile(PANE().id, 1);
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "b.ts" }));
  });

  it("cycles backward too", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    useSylva.getState().cycleFile(PANE().id, -1);
    expect(PANE().activeFile).toBe(fileKey({ worktreeId: "wt-a", path: "b.ts" }));
  });

  it("moves a dragged tab to where it was dropped", () => {
    open("a.ts");
    open("b.ts");
    open("c.ts");
    useSylva.getState().moveFile(PANE().id, 0, 2);
    expect(paths()).toEqual(["b.ts", "c.ts", "a.ts"]);
  });

  it("ignores a drop outside the strip", () => {
    open("a.ts");
    open("b.ts");
    useSylva.getState().moveFile(PANE().id, 0, 9);
    expect(paths()).toEqual(["a.ts", "b.ts"]);
  });
});

describe("changing what a pane holds", () => {
  beforeEach(reset);

  it("clears the tab bar, because those paths were somewhere else", () => {
    open("a.ts");
    useSylva.getState().setPaneWorktree(PANE().id, "wt-b");
    expect(PANE().files).toEqual([]);
    expect(PANE().activeFile).toBeNull();
  });

  it("leaves it alone when the pane is re-opened on the same worktree", () => {
    open("a.ts");
    useSylva.getState().setPaneWorktree(PANE().id, "wt-a");
    expect(paths()).toEqual(["a.ts"]);
  });
});

/**
 * The rail is dragged to a width and remembers it. The clamp is the part worth
 * pinning: a drag that runs off the edge of the window, or a stored value from
 * a monitor you no longer have, must not be able to leave the sidebar somewhere
 * it can't be dragged back from.
 */
describe("the sidebar's width", () => {
  it("holds a width inside the range untouched", () => {
    expect(clampSidebar(300)).toBe(300);
  });

  it("won't go narrower than a branch name needs", () => {
    expect(clampSidebar(20)).toBe(SIDEBAR_MIN);
    expect(clampSidebar(-500)).toBe(SIDEBAR_MIN);
  });

  it("won't swallow the pane you were reading", () => {
    expect(clampSidebar(4000)).toBe(SIDEBAR_MAX);
  });

  it("falls back to the default rather than trusting a nonsense value", () => {
    expect(clampSidebar(Number.NaN)).toBe(SIDEBAR_DEFAULT);
    expect(clampSidebar(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT);
  });

  it("rounds to whole pixels, since a drag reports fractions of one", () => {
    expect(clampSidebar(240.6)).toBe(241);
  });

  it("clamps what the store is told, not just what it is asked", () => {
    useSylva.getState().setSidebarWidth(9999);
    expect(useSylva.getState().sidebarWidth).toBe(SIDEBAR_MAX);
    useSylva.getState().setSidebarWidth(0);
    expect(useSylva.getState().sidebarWidth).toBe(SIDEBAR_MIN);
  });

  it("keeps a width it accepts", () => {
    useSylva.getState().setSidebarWidth(288);
    expect(useSylva.getState().sidebarWidth).toBe(288);
  });

  /* Persisting is wrapped in a try/catch precisely so it can be absent —
     private mode, a full quota, or a test running without a DOM. Setting a
     width must still work when there is nowhere to write it down. */
  it("survives having nowhere to remember it", () => {
    expect(() => useSylva.getState().setSidebarWidth(250)).not.toThrow();
    expect(useSylva.getState().sidebarWidth).toBe(250);
  });
});

describe("what is waiting on you", () => {
  beforeEach(() => {
    reset();
    useSylva.setState({
      pendingPermissions: {},
      sessions: {},
      celebrating: {},
      view: "workspace",
    });
    useSylva.setState({ panes: [{ ...PANE(), worktreeId: null }] });
  });

  it("puts a blocked dryad ahead of one that merely finished", () => {
    useSylva.setState({
      celebrating: { "wt-done": true },
      pendingPermissions: {
        "wt-blocked": [
          {
            id: "p1",
            sessionId: "s",
            worktreeId: "wt-blocked",
            tool: "Bash",
            summary: "rm -rf",
            input: {},
            requestedAt: "",
          },
        ],
      },
    });
    expect(attentionQueue(useSylva.getState()).map((e) => e.worktreeId)).toEqual([
      "wt-blocked",
      "wt-done",
    ]);
  });

  it("leaves out whatever is already on screen", () => {
    useSylva.setState({ celebrating: { "wt-a": true } });
    useSylva.setState({ panes: [{ ...PANE(), worktreeId: "wt-a" }] });
    expect(attentionQueue(useSylva.getState())).toEqual([]);
  });

  it("names a worktree once, however many ways it is waiting", () => {
    useSylva.setState({
      celebrating: { "wt-x": true },
      sessions: {
        "wt-x": {
          id: "s",
          worktreeId: "wt-x",
          branch: "b",
          status: "errored",
          settings: { bypassPermissions: false, model: null, effort: null },
          sdkSessionId: null,
          totalCostUsd: 0,
          totalTokens: 0,
          queuedPrompts: [],
          createdAt: "",
        },
      },
    });
    const queue = attentionQueue(useSylva.getState());
    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual({ worktreeId: "wt-x", reason: "errored" });
  });
});
