import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { circleMembers, GROVE_ID, type Attachment, type PermissionRequest } from "sylva-shared";
import { applyMention, mentionAt, PathMentions, type Mention } from "./PathMentions";
import { applySlash, slashAt, SlashCommands, type SlashToken } from "./SlashCommands";
import { api, ApiFailure } from "../lib/api";

import { playCue } from "../lib/audio";
import { compactTokens } from "../lib/format";
import {
  attachmentLabels,
  attachmentNote,
  attachmentToken,
  relabelAttachments,
} from "../lib/attachments";
import { insertAtCaret, removeFromText } from "../lib/insertAtCaret";
import { ensureNotifyPermission } from "../lib/notify";
import { useWords } from "../lib/theme";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eraser,
  GitBranch,
  ListPlus,
  Paperclip,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { confirm } from "../lib/confirm";
import { BranchName } from "./BranchName";
import { ComposerSettings } from "./ComposerSettings";
import { CopyButton } from "./CopyButton";
import { EMPTY_DRAFT, NO_EVENTS, useSylva } from "../state/store";
import { Markdown } from "./Markdown";
import { PromptNav, type PromptMark } from "./PromptNav";
import { ToolGroup } from "./ToolGroup";
import { sameBlock, useBlocks, type Block } from "./transcriptBlocks";

/**
 * How much of a long conversation is drawn at once, and how much more each
 * "show earlier" reveals.
 *
 * A day-long session runs to thousands of blocks, and every one of them is
 * markdown that React re-reconciles on each streamed chunk — which is what
 * makes a long chat crawl while the agent is mid-answer. The newest blocks are
 * the ones being read; the rest are history, and history can wait to be asked
 * for.
 */
const WINDOW_START = 60;
const WINDOW_STEP = 40;

/** Distance from the bottom, in px, still counted as "at the bottom". */
const BOTTOM_SLACK = 60;

/**
 * How far one press of an arrow key moves the transcript. Roughly a line of
 * chat at the default text size — small enough to creep the last few pixels
 * into view, which is the whole reason the keys are wired up.
 */
const LINE_STEP = 44;

/**
 * How tall the composer may grow before it stops and scrolls instead.
 *
 * A prompt worth twenty lines is worth seeing while you write it, but the
 * conversation it is about has to stay on screen too — so the box takes what it
 * needs up to a share of the window, and no more.
 */
function promptCeiling(): number {
  return Math.min(280, Math.round(window.innerHeight * 0.4));
}

function PermissionCard({ request }: { request: PermissionRequest }) {
  const words = useWords();
  const [busy, setBusy] = useState(false);
  const answer = (a: "allow" | "allow-always" | "deny") => {
    setBusy(true);
    void api.answerPermission(request.id, a).finally(() => setBusy(false));
  };
  return (
    <div className="permission-card">
      <div className="permission-title">
        <span className="pixel-label" data-tip={`The ${words.agent} is paused until you answer`}>
          permission
        </span>
        The {words.agent} wants to use <strong>{request.tool}</strong>
      </div>
      <pre className="permission-summary" data-tip={`Exactly what the ${words.agent} wants to run`}>
        {request.summary}
      </pre>
      <div className="permission-actions">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => answer("allow")}
          data-tip="Permit this one use and carry on"
        >
          Allow
        </button>
        <button
          className="btn-quiet"
          disabled={busy}
          onClick={() => answer("allow-always")}
          data-tip="Stop asking for this tool until the session ends"
        >
          Allow always this session
        </button>
        <button
          className="btn-danger"
          disabled={busy}
          onClick={() => answer("deny")}
          data-tip={`Refuse — the ${words.agent} continues without it`}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

const BlockRow = memo(
  function BlockRow({ block, fresh }: { block: Block; fresh: boolean }) {
    const words = useWords();
    switch (block.kind) {
      case "user":
        return (
          <div className="msg-block msg-block-user">
            <div className="msg msg-user">{block.text}</div>
            <CopyButton text={block.text} className="msg-copy" tip="Copy this message" />
          </div>
        );
      case "assistant":
        return (
          <div className="msg-block msg-block-assistant">
            <div className="msg msg-assistant">
              <Markdown text={block.text} />
            </div>
            {/* The markdown as the agent wrote it, not as it was drawn: pasting
              a rendered heading into a file loses the thing that made it one. */}
            <CopyButton text={block.text} className="msg-copy" tip="Copy this reply as markdown" />
          </div>
        );
      case "tools":
        return <ToolGroup items={block.items} />;
      case "result":
        return (
          <div
            className={`turn-seal turn-${block.outcome} ${fresh ? "turn-fresh" : ""}`}
            data-tip={
              block.outcome === "success"
                ? `The ${words.agent} finished this turn cleanly`
                : block.outcome === "interrupted"
                  ? "You stopped this turn before it finished"
                  : "This turn ended in an error"
            }
          >
            <span className="turn-seal-rule" aria-hidden />
            <span className="turn-seal-badge">
              <span className="turn-seal-icon" aria-hidden>
                {block.outcome === "success" ? (
                  <Check size={11} strokeWidth={2.5} />
                ) : block.outcome === "interrupted" ? (
                  /* The shape of the button you pressed to cause it. */
                  <Square size={9} fill="currentColor" strokeWidth={0} />
                ) : (
                  <TriangleAlert size={11} />
                )}
              </span>
              {block.outcome === "success" ? "complete" : block.outcome}
              {block.tokens !== undefined && (
                <span className="turn-seal-cost" data-tip="Tokens this turn read and wrote">
                  {compactTokens(block.tokens)}
                </span>
              )}
            </span>
            <span className="turn-seal-rule" aria-hidden />
          </div>
        );
      case "notice":
        return (
          <div className="tool-result-error" data-tip="Something went wrong in this session">
            {block.text}
          </div>
        );
    }
  },
  (prev, next) => prev.fresh === next.fresh && sameBlock(prev.block, next.block),
);

export function AgentPanel({ worktreeId }: { worktreeId: string }) {
  const words = useWords();
  const transcript = useSylva((s) => s.transcripts[worktreeId] ?? NO_EVENTS);
  const session = useSylva((s) => s.sessions[worktreeId]);
  const permissions = useSylva((s) => s.pendingPermissions[worktreeId] ?? NO_EVENTS);
  const availability = useSylva((s) => s.availability);
  // The draft lives in the store so switching tabs (which unmounts this panel)
  // doesn't discard what you've typed.
  const draft = useSylva((s) => s.drafts[worktreeId] ?? EMPTY_DRAFT);
  const { text, attachments } = draft;
  /** What each attached file is called in the prompt. Order decides it. */
  const attachLabels = attachmentLabels(attachments.map((a) => a.name));
  const setText = (next: string) => useSylva.getState().setDraft(worktreeId, { text: next });
  const setAttachments = (next: (current: Attachment[]) => Attachment[]) => {
    const store = useSylva.getState();
    const current = store.drafts[worktreeId]?.attachments ?? EMPTY_DRAFT.attachments;
    store.setDraft(worktreeId, { attachments: next(current) });
  };

  /** Set for one animation when a prompt leaves the box. */
  const [sent, setSent] = useState(0);
  const [clearing, setClearing] = useState(false);
  /** The `@path` being typed, when one is. Drives the completion popup. */
  const [mention, setMention] = useState<Mention | null>(null);
  /** The `/command` being typed, when one is. Same idea, at the start only. */
  const [slash, setSlash] = useState<SlashToken | null>(null);
  /**
   * Where the caret was last seen.
   *
   * Kept in a ref rather than read at the moment it is needed, because the
   * moment it is needed the textarea has usually just lost focus — clicking the
   * paperclip, dropping a file, opening the file picker. The caret is gone by
   * then, and this is the memory of where it was.
   */
  const caretRef = useRef(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Every worktree this dryad can reach — what `@` searches. A circle tends
   * several, and naming a file in the one it *isn't* pointed at is exactly the
   * case a shared dryad exists for.
   */
  const members = useMemo(() => circleMembers(worktreeId) ?? [worktreeId], [worktreeId]);

  /*
   * What this conversation is about, in git's own words.
   *
   * The pane header above says it too, but that header belongs to the *pane* —
   * it is still there when you are reading a diff three tabs away, and it goes
   * when the grove or a circle is what's open. This one belongs to the
   * session: it names every worktree the agent can actually touch, which for a
   * circle is several and for the grove is none.
   *
   * Select the maps themselves, never a derived array: a fresh array on each
   * call changes the snapshot identity every render and spins the loop.
   */
  const statuses = useSylva((s) => s.statuses);
  const index = useSylva((s) => s.worktreeIndex);
  const branches = useMemo(
    () =>
      worktreeId === GROVE_ID
        ? []
        : members.map((id) => statuses[id]?.branch ?? index[id]?.branch ?? null),
    [members, statuses, index, worktreeId],
  );
  const named = branches.filter((b): b is string => Boolean(b));
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const [activePrompt, setActivePrompt] = useState<number | null>(null);
  /**
   * The same fact as `stickToBottom`, in state rather than a ref, because the
   * jump button has to appear the moment you scroll away — and a ref changing
   * renders nothing.
   */
  const [atBottom, setAtBottom] = useState(true);
  const [windowSize, setWindowSize] = useState(WINDOW_START);
  /** Distance from the bottom to restore after older blocks are prepended. */
  const growthAnchor = useRef<number | null>(null);
  /** A prompt to jump to once the window has grown far enough back to hold it. */
  const [pendingJump, setPendingJump] = useState<number | null>(null);

  const blocks = useBlocks(transcript);

  /**
   * Grow the composer to whatever has been typed into it.
   *
   * Measured rather than counted: a wrapped line is a line, and `\n`s alone
   * would leave a paragraph pasted in from somewhere else hidden behind a
   * scrollbar. `height: auto` first, because scrollHeight can only ever report
   * a box that is already too small.
   */
  useLayoutEffect(() => {
    const node = promptRef.current;
    if (!node) return;
    node.style.height = "auto";
    // The `rows` attribute sets the floor: with `auto` in place, scrollHeight
    // never reports less than the two rows the box starts at.
    const borders = node.offsetHeight - node.clientHeight;
    const wanted = node.scrollHeight + borders;
    const ceiling = promptCeiling();
    node.style.height = `${Math.min(wanted, ceiling)}px`;
    node.style.overflowY = wanted > ceiling ? "auto" : "hidden";
  }, [text]);

  /**
   * The jump rail, and which of its entries didn't work out.
   *
   * A turn's outcome is announced at the far end of it, which by then is
   * several screens below the prompt that caused it — so the rail, which is
   * the one place the whole conversation is visible at once, was the one place
   * that couldn't tell you a prompt had failed. Walking the blocks once pairs
   * each result with the prompt it belongs to.
   */
  const prompts = useMemo<PromptMark[]>(() => {
    const marks: PromptMark[] = [];
    for (const [i, block] of blocks.entries()) {
      if (block.kind === "user") marks.push({ blockIndex: i, text: block.text, failed: false });
      else if (block.kind === "result" && block.outcome !== "success") {
        const last = marks[marks.length - 1];
        // Only the prompt that started this turn, and only once: a result with
        // no prompt above it belongs to a turn from before the window.
        if (last && !last.failed) marks[marks.length - 1] = { ...last, failed: true };
      }
    }
    return marks;
  }, [blocks]);

  /**
   * The tail of the conversation, and how much of it is being withheld. Indices
   * stay absolute — the jump rail, the active-prompt highlight and the refs all
   * speak in positions within the whole transcript, not within the slice.
   */
  const hidden = Math.max(0, blocks.length - windowSize);
  const shown = hidden > 0 ? blocks.slice(hidden) : blocks;

  // A different dryad is a different conversation: back to the newest blocks,
  // pinned to the bottom, with nothing of the last one's scroll position left.
  useEffect(() => {
    setWindowSize(WINDOW_START);
    setPendingJump(null);
    setActivePrompt(null);
    stickToBottom.current = true;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [worktreeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript.length, permissions.length]);

  /**
   * Revealing older blocks adds height above the viewport, which would
   * otherwise shove the line you were reading down the screen. Measuring from
   * the *bottom* and restoring that instead keeps it exactly where it was.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = growthAnchor.current;
    growthAnchor.current = null;
    if (el && anchor !== null) el.scrollTop = el.scrollHeight - anchor;
  }, [windowSize]);

  const revealOlder = () => {
    // A growth already measured but not yet restored: scroll events arrive far
    // faster than renders, and each one would otherwise reveal another slab.
    if (hidden === 0 || growthAnchor.current !== null) return;
    const el = scrollRef.current;
    growthAnchor.current = el ? el.scrollHeight - el.scrollTop : null;
    setWindowSize((n) => n + WINDOW_STEP);
  };

  const goToBottom = () => {
    const el = scrollRef.current;
    stickToBottom.current = true;
    setAtBottom(true);
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  /** Highlight the prompt whose section the reader is currently inside. */
  const syncActivePrompt = () => {
    const container = scrollRef.current;
    if (!container || prompts.length === 0) return;
    const top = container.scrollTop;
    let current: number | null = prompts[0]?.blockIndex ?? null;
    for (const prompt of prompts) {
      const el = blockRefs.current.get(prompt.blockIndex);
      if (!el) continue;
      // A prompt owns the view once its heading has passed just under the top.
      if (el.offsetTop - container.offsetTop <= top + 24) current = prompt.blockIndex;
      else break;
    }
    setActivePrompt(current);
  };

  useEffect(syncActivePrompt, [blocks.length, prompts.length]);

  const scrollToBlock = (blockIndex: number) => {
    const container = scrollRef.current;
    const el = blockRefs.current.get(blockIndex);
    if (!container || !el) return;
    stickToBottom.current = false;
    setAtBottom(false);
    container.scrollTo({
      top: el.offsetTop - container.offsetTop - 12,
      behavior: "smooth",
    });
    setActivePrompt(blockIndex);
  };

  const jumpTo = (blockIndex: number) => {
    // The rail lists every prompt in the conversation, including ones older
    // than the window. Reach back far enough to hold the target, then jump
    // once it has actually been drawn.
    if (!blockRefs.current.has(blockIndex)) {
      growthAnchor.current = null;
      setWindowSize((n) => Math.max(n, blocks.length - blockIndex + WINDOW_STEP));
      setPendingJump(blockIndex);
      return;
    }
    scrollToBlock(blockIndex);
  };

  useLayoutEffect(() => {
    if (pendingJump === null || !blockRefs.current.has(pendingJump)) return;
    scrollToBlock(pendingJump);
    setPendingJump(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, windowSize]);

  const running = session?.status === "running";
  /**
   * Working, but not necessarily its turn.
   *
   * `running` is the turn — it decides whether a prompt is sent or queued, and
   * whether there is anything to stop. Background work is neither: you can talk
   * to a dryad whose subagent is still grinding away. Only the parts that say
   * what is happening read this one.
   */
  const busy = running || (session?.backgroundTasks.length ?? 0) > 0;
  const waiting = permissions.length > 0;
  /**
   * What the dryad is doing, as one word. Everything in the chat that reacts —
   * the header, the ambient motes, the composer's glow — reads this, so there
   * is one answer rather than four opinions.
   */
  const state = waiting
    ? "waiting"
    : busy
      ? "working"
      : session?.status === "errored"
        ? "trouble"
        : session
          ? "resting"
          : "new";
  const stateWord =
    state === "waiting"
      ? "needs you"
      : state === "working"
        ? "working"
        : state === "trouble"
          ? "hit trouble"
          : state === "resting"
            ? "resting"
            : "not started";
  const stateTip =
    state === "waiting"
      ? "Paused until you answer the permission request below"
      : state === "working"
        ? "A turn is in flight right now"
        : state === "trouble"
          ? "The last turn ended in an error"
          : state === "resting"
            ? "Waiting for your next prompt"
            : "Nothing has been asked here yet";

  /**
   * Which completion popup, if either, the caret is currently in.
   *
   * Asked in one place because they are mutually exclusive: `/` only means a
   * command at the very start, `@` never does, and running both tests from the
   * same event is what keeps them from both claiming the Enter key.
   */
  const syncPopups = (value: string, caret: number) => {
    caretRef.current = caret;
    setMention(mentionAt(value, caret));
    setSlash(slashAt(value, caret));
  };

  /** Put the caret after what was just inserted, once React has written it. */
  const moveCaret = (caret: number) => {
    requestAnimationFrame(() => {
      const node = promptRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  /**
   * Attach files, and write each one's *name* into the prompt where you were.
   *
   * Reading the draft out of the store rather than closing over `text`: several
   * files upload one after another, and each has to build on the sentence the
   * one before it just changed.
   */
  const upload = async (files: FileList | File[]) => {
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const attachment = await api.attach(worktreeId, file);
        setAttachments((list) => [...list, attachment]);

        const store = useSylva.getState();
        const current = store.drafts[worktreeId]?.text ?? "";
        // Labelled against the list this file is joining. A first arrival keeps
        // its own name, which is why nothing already in the sentence has to
        // move when one more file lands.
        const list = store.drafts[worktreeId]?.attachments ?? [];
        const labels = attachmentLabels([...list.map((a) => a.name), attachment.name]);
        const label = labels[labels.length - 1] ?? attachment.name;
        const next = insertAtCaret(current, caretRef.current, attachmentToken(label));
        store.setDraft(worktreeId, { text: next.text });
        caretRef.current = next.caret;
      } catch (e) {
        setUploadError(
          e instanceof ApiFailure ? (e.detail ?? e.message) : `Couldn't attach ${file.name}`,
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
    // Back to the sentence, after the last path that went into it.
    moveCaret(caretRef.current);
  };

  /**
   * Start the conversation over. Worth asking first: the transcript is deleted
   * from disk, and there is nowhere to get it back from.
   */
  const clearSession = async () => {
    const ok = await confirm({
      title: `Clear this ${words.agent}?`,
      body: "It forgets this conversation entirely — the transcript is deleted and its token count goes back to zero. Its worktrees and settings stay as they are.",
      confirmLabel: "Clear",
      tone: "danger",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await api.clearSession(worktreeId);
      // The server broadcasts agent.cleared, and the store empties itself from
      // that — so both panes showing this dryad forget it, not just this one.
    } finally {
      setClearing(false);
    }
  };

  const send = () => {
    const prompt = text.trim();
    if (!prompt && attachments.length === 0) return;
    ensureNotifyPermission();
    playCue(running ? "queue" : "send");
    // The sentence says `[photo.png]` where you attached it; the paths follow
    // it as a block. Every attachment is listed, not only the ones you deleted
    // out of the sentence — a name mid-prompt needs somewhere to resolve.
    const labels = attachmentLabels(attachments.map((a) => a.name));
    const note = attachmentNote(
      attachments.map((a, i) => ({ label: labels[i] ?? a.name, path: a.path })),
    );
    useSylva.getState().clearDraft(worktreeId);
    // Bump a counter rather than toggling a boolean: sending twice quickly has
    // to restart the animation, and re-adding a class it already has doesn't.
    setSent((n) => n + 1);
    void api.prompt(worktreeId, `${prompt}${note}`.trim());
  };

  if (!availability.available) {
    return (
      <div className="agent-unavailable">
        <div className="pixel-label">agent unavailable</div>
        <p>{availability.reason}</p>
        <p>
          Sylva runs agents through Claude Code. Make sure you're logged in — run{" "}
          <code>claude</code> in a terminal and complete authentication, then try again.
        </p>
      </div>
    );
  }

  return (
    <div className="agent-panel">
      {/* One compact line. Everything here is glanceable — the state, what it
          has read and written, and the two controls that act on the session —
          so it stays a strip rather than growing into a second header. */}
      <div className={`chat-header chat-header-${state}`}>
        <span className="chat-state" data-tip={stateTip}>
          <span className="chat-state-dot" />
          {stateWord}
        </span>

        {named.length > 0 && (
          <span
            className="chat-branch"
            data-tip={
              named.length === 1
                ? `Branch checked out where this ${words.agent} works`
                : `Branches this ${words.agent} works across:\n${named.join("\n")}`
            }
          >
            <GitBranch size={11} />
            {named.map((b, i) => (
              <span key={b} className="chat-branch-one">
                {i > 0 && <span className="branch-prefix">+ </span>}
                <BranchName branch={b} />
              </span>
            ))}
          </span>
        )}

        {session && (
          <span className="chat-header-facts">
            <span data-tip="Tokens read and written across this session">
              {compactTokens(session.totalTokens)} tokens
            </span>
          </span>
        )}

        <div className="chat-header-actions">
          {running && (
            <button
              className="chat-stop"
              onClick={() => void api.interrupt(worktreeId)}
              data-tip={`Interrupt the ${words.agent}'s current turn`}
            >
              <Square size={11} fill="currentColor" />
              Stop
            </button>
          )}
          {/* Nothing to forget until something has been said, so the control
              only appears once there is. */}
          {!running && (session || blocks.length > 0) && (
            <button
              className="chat-clear"
              disabled={clearing}
              onClick={() => void clearSession()}
              data-tip="Forget this conversation — the next prompt starts fresh"
            >
              <Eraser size={11} />
              Clear
            </button>
          )}
        </div>
      </div>
      <div className={`agent-body agent-body-${state}`}>
        <div
          className="chat-scroll"
          ref={scrollRef}
          // Focusable so the arrows reach it. Dragging out a selection puts
          // focus here on the way, which is exactly when you want them: the
          // drag has to leave the box to keep scrolling and overshoots by half
          // a screen, and a key that moves it back by a line fixes that.
          tabIndex={0}
          role="region"
          aria-label="Conversation"
          onKeyDown={(e) => {
            const el = e.currentTarget;
            // Anything with a caret of its own owns its arrow keys.
            const target = e.target as HTMLElement;
            if (target !== el && target.closest("input, textarea, [contenteditable]")) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            const page = Math.max(el.clientHeight - LINE_STEP, LINE_STEP);
            const by =
              e.key === "ArrowDown"
                ? LINE_STEP
                : e.key === "ArrowUp"
                  ? -LINE_STEP
                  : e.key === "PageDown"
                    ? page
                    : e.key === "PageUp"
                      ? -page
                      : e.key === "End"
                        ? el.scrollHeight
                        : e.key === "Home"
                          ? -el.scrollHeight
                          : 0;
            if (by === 0) return;
            e.preventDefault();
            el.scrollBy({ top: by });
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
            stickToBottom.current = bottom;
            setAtBottom((was) => (was === bottom ? was : bottom));
            // Reaching the top is the ordinary way to ask for more history;
            // the button below it is for anyone who'd rather say so.
            if (el.scrollTop < 48) revealOlder();
            syncActivePrompt();
          }}
        >
          {blocks.length === 0 && (
            <div className="chat-empty">
              Ask for anything — the {words.agent} works right here in this worktree.
            </div>
          )}
          {hidden > 0 && (
            <button className="chat-older" onClick={revealOlder} data-tip="Load older messages">
              {hidden} earlier {hidden === 1 ? "message" : "messages"} — show more
            </button>
          )}
          {shown.map((block, i) => {
            const index = i + hidden;
            return (
              <div
                key={index}
                className={`block-anchor ${i === shown.length - 1 ? "block-fresh" : ""}`}
                ref={(el) => {
                  if (el) blockRefs.current.set(index, el);
                  else blockRefs.current.delete(index);
                }}
              >
                <BlockRow block={block} fresh={i === shown.length - 1} />
              </div>
            );
          })}
          {permissions.map((p) => (
            <PermissionCard key={p.id} request={p} />
          ))}
          {busy && permissions.length === 0 && (
            <div
              className="thinking"
              data-tip={
                running
                  ? "Output streams in live as the agent works"
                  : "The turn is over, but work it started is still running"
              }
            >
              <span className="fireflies" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {running
                ? `the ${words.agent} is working…`
                : `still running: ${session?.backgroundTasks[0]?.description ?? "background work"}${
                    (session?.backgroundTasks.length ?? 0) > 1
                      ? ` +${(session?.backgroundTasks.length ?? 1) - 1} more`
                      : ""
                  }`}
            </div>
          )}
        </div>

        {/* Only while you're actually away from the newest message: a button
            that never leaves is a button that stops being read. */}
        {!atBottom && blocks.length > 0 && (
          <button
            className="chat-jump"
            onClick={goToBottom}
            data-tip="Back to the newest message"
            aria-label="Jump to the newest message"
          >
            <ArrowDown size={13} />
            Latest
          </button>
        )}

        <PromptNav prompts={prompts} activeIndex={activePrompt} onJump={jumpTo} />
      </div>

      {(session?.queuedPrompts.length ?? 0) > 0 && (
        <div className="queue-list">
          {session?.queuedPrompts.map((q) => (
            <div key={q.id} className="queue-item">
              <span
                className="queue-text"
                data-tip="Queued prompt — sends when the current turn ends"
              >
                {q.text}
              </span>
              <button
                className="ghost"
                data-tip="Drop this prompt from the queue"
                onClick={() => void api.removeQueued(worktreeId, q.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        key={`bar-${sent}`}
        className={`prompt-bar ${dragging ? "prompt-bar-drop" : ""} ${sent > 0 ? "prompt-bar-sent" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
      >
        {(attachments.length > 0 || uploading > 0 || uploadError) && (
          <div className="attach-list">
            {attachments.map((a, i) => {
              const label = attachLabels[i] ?? a.name;
              return (
                <span
                  key={a.path}
                  className="attach-chip"
                  data-tip={
                    text.includes(attachmentToken(label))
                      ? `Named as [${label}] in your prompt · ${a.path}`
                      : `Attached — listed under Attachments when you send · ${a.path}`
                  }
                >
                  {label}
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Remove ${label}`}
                    data-tip="Remove this attachment, and its name from the prompt"
                    onClick={() => {
                      const rest = attachments.filter((x) => x.path !== a.path);
                      setAttachments(() => rest);
                      // The name went into the sentence when the file arrived,
                      // so it comes back out when the file goes — and whatever
                      // was called "photo (2).png" because of this file is
                      // called "photo.png" again, in the sentence too.
                      const without = removeFromText(text, attachmentToken(label));
                      const remaining = attachLabels.filter((_, j) => j !== i);
                      setText(
                        relabelAttachments(
                          without,
                          remaining,
                          attachmentLabels(rest.map((x) => x.name)),
                        ),
                      );
                    }}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            {uploading > 0 && (
              <span className="attach-pending" data-tip="Copying files into the worktree">
                attaching {uploading}…
              </span>
            )}
            {uploadError && (
              <span className="attach-error" data-tip="This file couldn't be attached">
                {uploadError}
              </span>
            )}
          </div>
        )}

        <div className="composer-box">
          <div className="composer-field">
            <textarea
              ref={promptRef}
              rows={2}
              className="composer-input"
              data-tip="Enter sends · Shift+Enter starts a new line · @ names a file · / lists commands · an attached file's name lands at the caret"
              placeholder={
                dragging
                  ? "Drop to attach"
                  : running
                    ? "Queue a follow-up…"
                    : `Tell the ${words.agent} what to do…`
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                syncPopups(e.target.value, e.target.selectionStart);
              }}
              // The caret can move without the text changing, and an `@` three
              // words back is no longer being typed once you click away from it.
              onSelect={(e) => syncPopups(text, e.currentTarget.selectionStart)}
              onBlur={(e) => {
                // The popups go, but where you were does not: an attachment
                // arriving a moment later still belongs at that spot.
                caretRef.current = e.currentTarget.selectionStart;
                setMention(null);
                setSlash(null);
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  // A pasted screenshot belongs exactly where you pasted it.
                  caretRef.current = e.currentTarget.selectionStart;
                  void upload(files);
                }
              }}
              onKeyDown={(e) => {
                // A popup owns Enter while it is open — it means "choose this
                // one", and the popup has already handled it.
                if (e.key === "Enter" && !e.shiftKey && !mention && !slash) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <PathMentions
              members={members}
              mention={mention}
              onDismiss={() => setMention(null)}
              onPick={(path) => {
                if (!mention) return;
                const next = applyMention(text, mention, path);
                setText(next.text);
                setMention(null);
                moveCaret(next.caret);
              }}
            />
            <SlashCommands
              worktreeId={worktreeId}
              token={slash}
              onDismiss={() => setSlash(null)}
              onPick={(name) => {
                if (!slash) return;
                const next = applySlash(text, slash, name);
                setText(next.text);
                setSlash(null);
                moveCaret(next.caret);
              }}
            />
          </div>

          {/* Everything that acts on what you have written, on the floor of the
              same box — so the box is the composer rather than one control in a
              row of them. What it will be sent *with* sits on the left, what
              sends it on the right. */}
          <div className="composer-foot">
            <ComposerSettings worktreeId={worktreeId} />

            <div className="composer-tools">
              <button
                type="button"
                className="composer-icon"
                aria-label="Attach a file"
                data-tip={`Attach files for the ${words.agent} to read — their names land where the caret is, and their paths at the end. Or just drop them here.`}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={15} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void upload(e.target.files);
                  e.target.value = "";
                }}
              />

              {running && (
                <button
                  type="button"
                  className="composer-icon composer-stop"
                  onClick={() => void api.interrupt(worktreeId)}
                  aria-label="Stop the current turn"
                  data-tip={`Interrupt the ${words.agent}'s current turn`}
                >
                  <Square size={11} fill="currentColor" strokeWidth={0} />
                </button>
              )}

              <button
                type="submit"
                className="composer-send"
                disabled={running ? !text.trim() : !text.trim() && attachments.length === 0}
                aria-label={running ? "Queue this prompt" : "Send this prompt"}
                data-tip={
                  running
                    ? "Line this up to send once the current turn ends"
                    : `Send this prompt to the ${words.agent}`
                }
              >
                {running ? <ListPlus size={15} /> : <ArrowUp size={16} strokeWidth={2.4} />}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
