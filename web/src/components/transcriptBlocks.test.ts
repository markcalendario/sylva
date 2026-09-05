import { describe, expect, it } from "vitest";
import type { AgentEvent } from "sylva-shared";
import { foldEvent, toBlocks, type Block } from "./transcriptBlocks";

/**
 * Folding a transcript into rows, one event at a time.
 *
 * The panel folds a live conversation incrementally — it keeps what it built
 * last time and adds only what has arrived since — so two properties have to
 * hold, and neither is visible from the screen until a long session has gone
 * wrong. Folding in steps must give exactly what folding from scratch gives.
 * And a fold must not edit the blocks it produced earlier: the rows are
 * memoised on what they draw, so a block changed in place would keep drawing
 * what it used to say.
 */

const at = "2026-08-17T10:00:00Z";

const prompt = (text: string): AgentEvent => ({ kind: "user-prompt", text, at });
const said = (text: string): AgentEvent => ({ kind: "assistant-text", text, at });
const used = (toolUseId: string, tool = "Read"): AgentEvent => ({
  kind: "tool-use",
  toolUseId,
  tool,
  summary: `${tool} something`,
  at,
});
const failed = (toolUseId: string, summary = "no such file"): AgentEvent => ({
  kind: "tool-result",
  toolUseId,
  isError: true,
  summary,
  at,
});
const worked = (toolUseId: string): AgentEvent => ({
  kind: "tool-result",
  toolUseId,
  isError: false,
  summary: "ok",
  at,
});
const finished = (): AgentEvent => ({ kind: "result", outcome: "success", tokens: 12, at });
const stopped = (): AgentEvent => ({ kind: "result", outcome: "interrupted", at });
const broke = (): AgentEvent => ({ kind: "result", outcome: "error", at });

/** The stream a real turn produces, with every kind of event in it. */
const TURN: AgentEvent[] = [
  prompt("rename the widget"),
  said("Looking at it."),
  said("Two files use it."),
  used("t1"),
  used("t2"),
  worked("t1"),
  failed("t2"),
  said("The second one is gone."),
  finished(),
  { kind: "error", message: "the query stopped", at },
];

/**
 * A turn the model ended and then carried on past, which is what background
 * work reporting back looks like from here: a clean result, and then more of
 * the same conversation with nothing from you in between.
 */
const RESUMED: AgentEvent[] = [
  prompt("look into all six areas"),
  said("The agents are still running."),
  finished(),
  used("t9"),
  said("They're back — here is what they found."),
  finished(),
];

/** Fold one at a time, the way the panel does while a turn streams. */
function foldOneByOne(events: AgentEvent[]): Block[] {
  let blocks: Block[] = [];
  for (const event of events) {
    // A copy per step, exactly as the incremental path does — the previous
    // list has been handed to React and must survive untouched.
    blocks = [...blocks];
    foldEvent(blocks, event);
  }
  return blocks;
}

describe("folding a transcript", () => {
  it("groups the way the panel draws it", () => {
    const blocks = toBlocks(TURN);
    expect(blocks.map((b) => b.kind)).toEqual([
      "user",
      "assistant",
      "tools",
      "assistant",
      "result",
      "notice",
    ]);
  });

  it("rejoins assistant chunks into one document", () => {
    const blocks = toBlocks([said("One."), said("Two.")]);
    expect(blocks).toEqual([{ kind: "assistant", text: "One.\n\nTwo." }]);
  });

  it("marks the step that failed, and only that one", () => {
    const blocks = toBlocks(TURN);
    const tools = blocks.find((b) => b.kind === "tools");
    expect(tools?.kind === "tools" && tools.items.map((i) => i.error)).toEqual([
      undefined,
      "no such file",
    ]);
  });

  it("arrives at the same place whether folded in steps or in one go", () => {
    expect(foldOneByOne(TURN)).toEqual(toBlocks(TURN));
  });

  it("gives the same answer at every point along the way", () => {
    // Not just at the end: the screen is drawn from each of these.
    for (let i = 1; i <= TURN.length; i++) {
      const so_far = TURN.slice(0, i);
      expect(foldOneByOne(so_far)).toEqual(toBlocks(so_far));
    }
  });

  it("drops a turn-complete row the conversation went on past", () => {
    const blocks = toBlocks(RESUMED);
    // One completion, at the end, where the dryad actually stopped.
    expect(blocks.map((b) => b.kind)).toEqual([
      "user",
      "assistant",
      "tools",
      "assistant",
      "result",
    ]);
  });

  it("keeps a completion that nothing followed", () => {
    const blocks = toBlocks([prompt("hi"), said("Hello."), finished()]);
    expect(blocks.at(-1)).toEqual({ kind: "result", outcome: "success", tokens: 12 });
  });

  it("keeps a completion your next prompt followed", () => {
    const blocks = toBlocks([said("Done."), finished(), prompt("again"), said("Done.")]);
    expect(blocks.map((b) => b.kind)).toEqual(["assistant", "result", "user", "assistant"]);
  });

  it("keeps an error or an interruption whatever follows them", () => {
    // These happened. Work resuming afterwards doesn't unhappen them.
    expect(toBlocks([said("One."), broke(), said("Two.")]).map((b) => b.kind)).toEqual([
      "assistant",
      "result",
      "assistant",
    ]);
    expect(toBlocks([said("One."), stopped(), used("t1")]).map((b) => b.kind)).toEqual([
      "assistant",
      "result",
      "tools",
    ]);
  });

  it("folds a resumed turn the same way in steps as in one go", () => {
    for (let i = 1; i <= RESUMED.length; i++) {
      const so_far = RESUMED.slice(0, i);
      expect(foldOneByOne(so_far)).toEqual(toBlocks(so_far));
    }
  });

  it("never edits a block it has already produced", () => {
    const blocks = toBlocks([said("One."), used("t1")]);
    const before = structuredClone(blocks);
    const kept = [...blocks];

    // Each of these would have edited a block in place, once.
    foldEvent(kept, said("Two."));
    foldEvent(kept, used("t2"));
    foldEvent(kept, failed("t1"));

    expect(blocks).toEqual(before);
  });
});
