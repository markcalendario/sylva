import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, Attachment, PermissionRequest } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { compactTokens } from "../lib/format";
import { ensureNotifyPermission } from "../lib/notify";
import { ArrowDown, Eraser, Paperclip, Sparkles, Square, X } from "lucide-react";
import { confirm } from "../lib/confirm";
import { AgentSettingsButton } from "./AgentSettingsButton";
import { SavedPromptsButton } from "./SavedPromptsButton";
import { EMPTY_DRAFT, NO_EVENTS, useSylva } from "../state/store";
import { Markdown } from "./Markdown";
import { PromptNav, type PromptMark } from "./PromptNav";
import { ToolGroup, type ToolItem } from "./ToolGroup";

type Block =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tools"; items: ToolItem[] }
  | { kind: "result"; outcome: "success" | "error" | "interrupted"; costUsd?: number }
  | { kind: "notice"; text: string };

/**
 * How much of a long conversation is drawn at once, and how much more each
 * "show earlier" reveals.
 *
 * A day-long session runs to thousands of blocks, and every one of them is
 * markdown that React re-reconciles on each streamed chunk — which is what
 * makes a long chat crawl while the dryad is mid-answer. The newest blocks are
 * the ones being read; the rest are history, and history can wait to be asked
 * for.
 */
const WINDOW_START = 60;
const WINDOW_STEP = 40;

/** Distance from the bottom, in px, still counted as "at the bottom". */
const BOTTOM_SLACK = 60;

const LEGACY_CD_PREFIX = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s&|;]+)\s*&&\s*/;

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
 * Fold the raw event stream into renderable blocks: consecutive tool calls
 * become one group, and streamed assistant chunks rejoin into one document so
 * markdown spanning several chunks still parses.
 */
function toBlocks(events: AgentEvent[]): Block[] {
  const blocks: Block[] = [];
  const last = () => blocks[blocks.length - 1];

  for (const event of events) {
    switch (event.kind) {
      case "user-prompt":
        blocks.push({ kind: "user", text: event.text });
        break;

      case "assistant-text": {
        const tail = last();
        if (tail?.kind === "assistant") tail.text += `\n\n${event.text}`;
        else blocks.push({ kind: "assistant", text: event.text });
        break;
      }

      case "tool-use": {
        const tail = last();
        const item: ToolItem = {
          id: event.toolUseId,
          tool: event.tool,
          summary: tidySummary(event.summary),
          ...(event.detail ? { detail: event.detail } : {}),
        };
        if (tail?.kind === "tools") tail.items.push(item);
        else blocks.push({ kind: "tools", items: [item] });
        break;
      }

      case "tool-result": {
        // Successful results are implied by the next step; only failures earn a row.
        if (!event.isError) break;
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i];
          if (block?.kind !== "tools") continue;
          const item = block.items.find((it) => it.id === event.toolUseId);
          if (item) {
            item.error = event.summary || "Tool failed";
            break;
          }
        }
        break;
      }

      case "result":
        blocks.push({
          kind: "result",
          outcome: event.outcome,
          ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        });
        break;

      case "error":
        blocks.push({ kind: "notice", text: event.message });
        break;
    }
  }
  return blocks;
}

function PermissionCard({ request }: { request: PermissionRequest }) {
  const [busy, setBusy] = useState(false);
  const answer = (a: "allow" | "allow-always" | "deny") => {
    setBusy(true);
    void api.answerPermission(request.id, a).finally(() => setBusy(false));
  };
  return (
    <div className="permission-card">
      <div className="permission-title">
        <span className="pixel-label" data-tip="The dryad is paused until you answer">
          permission
        </span>
        The dryad wants to use <strong>{request.tool}</strong>
      </div>
      <pre className="permission-summary" data-tip="Exactly what the dryad wants to run">
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
          data-tip="Refuse — the dryad continues without it"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

/**
 * Two blocks that would draw identically.
 *
 * `toBlocks` rebuilds the whole list from the event stream on every streamed
 * chunk, so every block is a new object even when nothing about it changed —
 * which means identity tells React nothing and it re-renders (and re-parses
 * the markdown of) the entire conversation for each token that arrives.
 * Comparing what is actually drawn is what makes the memo below bite.
 */
function sameBlock(a: Block, b: Block): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "user":
    case "assistant":
      return a.text === (b as typeof a).text;
    case "notice":
      return a.text === (b as typeof a).text;
    case "result": {
      const other = b as typeof a;
      return a.outcome === other.outcome && a.costUsd === other.costUsd;
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
          item.error === there.error
        );
      });
    }
  }
}

const BlockRow = memo(function BlockRow({ block }: { block: Block }) {
  switch (block.kind) {
    case "user":
      return <div className="msg msg-user">{block.text}</div>;
    case "assistant":
      return (
        <div className="msg msg-assistant">
          <Markdown text={block.text} />
        </div>
      );
    case "tools":
      return <ToolGroup items={block.items} />;
    case "result":
      return (
        <div
          className={`turn-result turn-${block.outcome}`}
          data-tip={
            block.outcome === "success"
              ? "The dryad finished this turn cleanly"
              : block.outcome === "interrupted"
                ? "You stopped this turn before it finished"
                : "This turn ended in an error"
          }
        >
          {block.outcome === "success" ? (
            <>
              <Sparkles size={12} /> turn complete
            </>
          ) : (
            <>
              <X size={12} /> {block.outcome}
            </>
          )}
          {block.costUsd !== undefined && (
            <span className="turn-cost" data-tip="What this turn cost">
              ${block.costUsd.toFixed(3)}
            </span>
          )}
        </div>
      );
    case "notice":
      return (
        <div className="tool-result-error" data-tip="Something went wrong in this session">
          {block.text}
        </div>
      );
  }
}, (prev, next) => sameBlock(prev.block, next.block));

export function AgentPanel({ worktreeId }: { worktreeId: string }) {
  const transcript = useSylva((s) => s.transcripts[worktreeId] ?? NO_EVENTS);
  const session = useSylva((s) => s.sessions[worktreeId]);
  const permissions = useSylva((s) => s.pendingPermissions[worktreeId] ?? NO_EVENTS);
  const availability = useSylva((s) => s.availability);

  // The draft lives in the store so switching tabs (which unmounts this panel)
  // doesn't discard what you've typed.
  const draft = useSylva((s) => s.drafts[worktreeId] ?? EMPTY_DRAFT);
  const { text, attachments } = draft;
  const setText = (next: string) =>
    useSylva.getState().setDraft(worktreeId, { text: next });
  const setAttachments = (next: (current: Attachment[]) => Attachment[]) => {
    const store = useSylva.getState();
    const current = store.drafts[worktreeId]?.attachments ?? EMPTY_DRAFT.attachments;
    store.setDraft(worktreeId, { attachments: next(current) });
  };

  /** Set for one animation when a prompt leaves the box. */
  const [sent, setSent] = useState(0);
  const [clearing, setClearing] = useState(false);
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

  const blocks = useMemo(() => toBlocks(transcript), [transcript]);

  const prompts = useMemo<PromptMark[]>(
    () =>
      blocks.flatMap((block, i) =>
        block.kind === "user" ? [{ blockIndex: i, text: block.text }] : [],
      ),
    [blocks],
  );

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
    container.scrollTo({ top: el.offsetTop - container.offsetTop - 12, behavior: "smooth" });
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
  const waiting = permissions.length > 0;
  /**
   * What the dryad is doing, as one word. Everything in the chat that reacts —
   * the header, the ambient motes, the composer's glow — reads this, so there
   * is one answer rather than four opinions.
   */
  const state = waiting ? "waiting" : running ? "working" : session?.status === "errored" ? "trouble" : session ? "resting" : "new";
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

  const upload = async (files: FileList | File[]) => {
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const attachment = await api.attach(worktreeId, file);
        setAttachments((list) => [...list, attachment]);
      } catch (e) {
        setUploadError(
          e instanceof ApiFailure ? (e.detail ?? e.message) : `Couldn't attach ${file.name}`,
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  /**
   * Start the conversation over. Worth asking first: the transcript is deleted
   * from disk, and there is nowhere to get it back from.
   */
  const clearSession = async () => {
    const ok = await confirm({
      title: "Clear this dryad?",
      body: "It forgets this conversation entirely — the transcript is deleted and the running cost goes back to zero. Its worktrees and settings stay as they are.",
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
    // The agent reads attachments off disk, so the prompt carries paths only.
    const attachmentNote = attachments.length
      ? `\n\nAttached files (read them from these paths):\n${attachments
          .map((a) => `- ${a.path}`)
          .join("\n")}`
      : "";
    useSylva.getState().clearDraft(worktreeId);
    // Bump a counter rather than toggling a boolean: sending twice quickly has
    // to restart the animation, and re-adding a class it already has doesn't.
    setSent((n) => n + 1);
    void api.prompt(worktreeId, `${prompt}${attachmentNote}`.trim());
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
          has cost, and the two controls that act on the session — so it stays
          a strip rather than growing into a second header. */}
      <div className={`chat-header chat-header-${state}`}>
        <span className="chat-state" data-tip={stateTip}>
          <span className="chat-state-dot" />
          {stateWord}
        </span>

        {session && (
          <span className="chat-header-facts">
            <span data-tip="What this session has cost so far">
              ${session.totalCostUsd.toFixed(3)}
            </span>
            <span className="chat-header-sep" aria-hidden>
              ·
            </span>
            <span data-tip="Tokens read and written across this session">
              {compactTokens(session.totalTokens)}
            </span>
          </span>
        )}

        <div className="chat-header-actions">
          {running && (
            <button
              className="chat-stop"
              onClick={() => void api.interrupt(worktreeId)}
              data-tip="Interrupt the dryad's current turn"
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
          <AgentSettingsButton worktreeId={worktreeId} />
        </div>
      </div>
      <div className={`agent-body agent-body-${state}`}>
        <div
          className="chat-scroll"
          ref={scrollRef}
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
              Ask for anything — the dryad works right here in this worktree.
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
                className="block-anchor"
                ref={(el) => {
                  if (el) blockRefs.current.set(index, el);
                  else blockRefs.current.delete(index);
                }}
              >
                <BlockRow block={block} />
              </div>
            );
          })}
          {permissions.map((p) => (
            <PermissionCard key={p.id} request={p} />
          ))}
          {running && permissions.length === 0 && (
            <div className="thinking" data-tip="Output streams in live as the agent works">
              <span className="fireflies" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              the dryad is working…
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
              <span className="queue-text" data-tip="Queued prompt — sends when the current turn ends">
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
            {attachments.map((a) => (
              <span key={a.path} className="attach-chip" data-tip={`Attached · ${a.path}`}>
                {a.name}
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Remove ${a.name}`}
                  data-tip="Remove this attachment"
                  onClick={() => setAttachments((l) => l.filter((x) => x.path !== a.path))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
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

        <div className="prompt-row">
          <button
            type="button"
            className="attach-btn"
            aria-label="Attach a file"
            data-tip="Attach files for the dryad to read — or just drop them here"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={15} />
          </button>
          <SavedPromptsButton
            onInsert={(snippet) =>
              setText(text.trim().length > 0 ? `${text.trimEnd()}\n\n${snippet}` : snippet)
            }
          />
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
          <textarea
            rows={2}
            data-tip="Enter sends · Shift+Enter starts a new line"
            placeholder={
              dragging
                ? "Drop to attach"
                : running
                  ? "Queue a follow-up…"
                  : "Tell the dryad what to do…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                void upload(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <div className="prompt-actions">
              <button
                type="submit"
                className="btn-quiet"
                disabled={!text.trim()}
                data-tip="Line this up to send once the current turn ends"
              >
                Queue
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void api.interrupt(worktreeId)}
                data-tip="Interrupt the dryad's current turn"
              >
                Stop
              </button>
            </div>
          ) : (
            <button
              type="submit"
              className="btn-primary"
              disabled={!text.trim() && attachments.length === 0}
              data-tip="Send this prompt to the dryad"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
