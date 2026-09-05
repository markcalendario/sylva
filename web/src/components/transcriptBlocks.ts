import { useMemo, useRef } from "react";
import type { AgentEvent } from "sylva-shared";
import type { ToolItem } from "./ToolGroup";

/**
 * A conversation, as rows rather than as events.
 *
 * Its own module because it is the part of the Agent panel with an answer that
 * can be checked: the panel folds a live transcript incrementally, and whether
 * that gives the same thing as folding it from scratch is a question about
 * these functions and nothing else.
 */

export type Block =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tools"; items: ToolItem[] }
  | { kind: "result"; outcome: "success" | "error" | "interrupted"; tokens?: number }
  | { kind: "notice"; text: string };

/** Stable empty list, so an untouched conversation folds to one reference. */
const NONE: never[] = [];

/**
 * A `cd` into the worktree, however the agent chained what came after it —
 * `&&`, `;`, or just a newline.
 *
 * The `&&` form was the only one stripped, so a two-line script beginning with
 * `cd /Users/…/long-worktree-name` spent the whole visible width of the row
 * saying where it already was. Every command in a worktree runs in that
 * worktree; the path is the one part of the line carrying no information.
 */
const LEGACY_CD_PREFIX = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s&|;]+)\s*(?:&&|;|\n)\s*/;

/**
 * Transcripts written before the server learned to strip these still carry
 * `cd "<worktree>" && …` labels; tidy them on the way to the screen so old
 * conversations read as well as new ones.
 */
function tidySummary(summary: string): string {
  let out = summary;
  while (LEGACY_CD_PREFIX.test(out)) out = out.replace(LEGACY_CD_PREFIX, "");
  return out.trim() || summary;
}

/**
 * Fold one event into a list of blocks: consecutive tool calls become one
 * group, and streamed assistant chunks rejoin into one document so markdown
 * spanning several chunks still parses.
 *
 * The list is appended to in place, but the blocks in it are never edited —
 * a block that grows is *replaced* by a new one. Two things depend on that.
 * The rows are memoised on what they draw, and a block mutated behind React's
 * back would draw the old thing forever. And the fold below reuses everything
 * it has already built, so a block object handed out on one render is still
 * being held on the next.
 */
export function foldEvent(blocks: Block[], event: AgentEvent): void {
  // A turn that carries on was never over.
  //
  // The SDK ends a turn when the model stops, which is not always when the
  // dryad stops: a background task reporting back, or a subagent finishing,
  // starts it working again with no prompt from you. The "turn complete" row
  // already drawn then becomes a claim about a turn that is still going — the
  // thing people read as "it's finished" and then watch keep typing.
  //
  // Dropped rather than reworded, because there is nothing left for it to
  // mark: the completion it announced is the one further down. Only a clean
  // finish goes. An error or an interruption *happened*, whatever follows it.
  if (event.kind === "assistant-text" || event.kind === "tool-use") {
    const last = blocks[blocks.length - 1];
    if (last?.kind === "result" && last.outcome === "success") blocks.pop();
  }

  const at = blocks.length - 1;
  const tail = blocks[at];

  switch (event.kind) {
    case "user-prompt":
      blocks.push({ kind: "user", text: event.text });
      break;

    case "assistant-text":
      if (tail?.kind === "assistant") {
        blocks[at] = { kind: "assistant", text: `${tail.text}\n\n${event.text}` };
      } else {
        blocks.push({ kind: "assistant", text: event.text });
      }
      break;

    case "tool-use": {
      const item: ToolItem = {
        id: event.toolUseId,
        tool: event.tool,
        summary: tidySummary(event.summary),
        ...(event.detail ? { detail: event.detail } : {}),
        ...(event.file ? { file: event.file } : {}),
      };
      if (tail?.kind === "tools") blocks[at] = { kind: "tools", items: [...tail.items, item] };
      else blocks.push({ kind: "tools", items: [item] });
      break;
    }

    case "tool-result": {
      // Successful results are implied by the next step; only failures earn a row.
      if (!event.isError) break;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (block?.kind !== "tools") continue;
        const found = block.items.findIndex((it) => it.id === event.toolUseId);
        if (found === -1) continue;
        const items = [...block.items];
        items[found] = { ...items[found]!, error: event.summary || "Tool failed" };
        blocks[i] = { kind: "tools", items };
        break;
      }
      break;
    }

    case "result":
      blocks.push({
        kind: "result",
        outcome: event.outcome,
        ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
      });
      break;

    case "error":
      blocks.push({ kind: "notice", text: event.message });
      break;
  }
}

/** The whole stream, from nothing. For a transcript arriving off disk. */
export function toBlocks(events: AgentEvent[]): Block[] {
  const blocks: Block[] = [];
  for (const event of events) foldEvent(blocks, event);
  return blocks;
}

/**
 * Two blocks that would draw identically.
 *
 * Used by the row memo. Most rows answer it on the first line — the fold reuses
 * every block it doesn't have to rebuild — and the rest are compared on what
 * they actually draw rather than on identity, because the block at the end of
 * the conversation is replaced by a new object every time it grows.
 */
export function sameBlock(a: Block, b: Block): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "user":
    case "assistant":
      return a.text === (b as typeof a).text;
    case "notice":
      return a.text === (b as typeof a).text;
    case "result": {
      const other = b as typeof a;
      return a.outcome === other.outcome && a.tokens === other.tokens;
    }
    case "tools": {
      const other = b as typeof a;
      if (a.items.length !== other.items.length) return false;
      return a.items.every((item, i) => {
        const there = other.items[i];
        return (
          !!there &&
          item.id === there.id &&
          item.summary === there.summary &&
          item.detail === there.detail &&
          item.error === there.error &&
          item.file?.path === there.file?.path &&
          item.file?.worktreeId === there.file?.worktreeId
        );
      });
    }
  }
}

/**
 * The transcript as blocks, re-folded only from wherever it grew.
 *
 * A live turn appends an event every few hundred milliseconds, and folding the
 * whole stream each time is quadratic in a way that is invisible at fifty
 * events and unbearable at five thousand: every assistant paragraph ever
 * written gets re-joined, every tool group rebuilt, for one new line. Sessions
 * that had been running all day were the ones that "froze".
 *
 * The stream is append-only, so the previous fold is still valid — which the
 * last event of the old list, compared by identity, is enough to establish.
 */
export function useBlocks(events: AgentEvent[]): Block[] {
  const cache = useRef<{ events: AgentEvent[]; blocks: Block[] }>({
    events: NONE,
    blocks: NONE,
  });

  return useMemo(() => {
    const prev = cache.current;
    const from = prev.events.length;
    // Same events, plus some: the tail of what we folded is still where it was.
    const appended =
      events.length >= from && (from === 0 || events[from - 1] === prev.events[from - 1]);

    if (appended && events.length === from) return prev.blocks;

    let blocks: Block[];
    if (appended) {
      blocks = [...prev.blocks];
      for (let i = from; i < events.length; i++) {
        const event = events[i];
        if (event) foldEvent(blocks, event);
      }
    } else {
      // A different conversation, or one that was cleared and started again.
      blocks = toBlocks(events);
    }
    cache.current = { events, blocks };
    return blocks;
  }, [events]);
}
