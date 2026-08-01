import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, PermissionRequest } from "sylva-shared";
import { api } from "../lib/api";
import { ensureNotifyPermission } from "../lib/notify";
import { NO_EVENTS, useSylva } from "../state/store";
import { Markdown } from "./Markdown";
import { ToolGroup, type ToolItem } from "./ToolGroup";

type Block =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tools"; items: ToolItem[] }
  | { kind: "result"; outcome: "success" | "error" | "interrupted"; costUsd?: number }
  | { kind: "notice"; text: string };

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
        <span className="pixel-label">permission</span>
        The dryad wants to use <strong>{request.tool}</strong>
      </div>
      <pre className="permission-summary">{request.summary}</pre>
      <div className="permission-actions">
        <button className="btn-primary" disabled={busy} onClick={() => answer("allow")}>
          Allow
        </button>
        <button className="btn-quiet" disabled={busy} onClick={() => answer("allow-always")}>
          Allow always this session
        </button>
        <button className="btn-danger" disabled={busy} onClick={() => answer("deny")}>
          Deny
        </button>
      </div>
    </div>
  );
}

function BlockRow({ block }: { block: Block }) {
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
        <div className={`turn-result turn-${block.outcome}`}>
          {block.outcome === "success" ? "✦ turn complete" : `✕ ${block.outcome}`}
          {block.costUsd !== undefined && (
            <span className="turn-cost">${block.costUsd.toFixed(3)}</span>
          )}
        </div>
      );
    case "notice":
      return <div className="tool-result-error">{block.text}</div>;
  }
}

export function AgentPanel({ worktreeId }: { worktreeId: string }) {
  const transcript = useSylva((s) => s.transcripts[worktreeId] ?? NO_EVENTS);
  const session = useSylva((s) => s.sessions[worktreeId]);
  const permissions = useSylva((s) => s.pendingPermissions[worktreeId] ?? NO_EVENTS);
  const availability = useSylva((s) => s.availability);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const blocks = useMemo(() => toBlocks(transcript), [transcript]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript.length, permissions.length]);

  const running = session?.status === "running";

  const send = () => {
    const prompt = text.trim();
    if (!prompt) return;
    ensureNotifyPermission();
    setText("");
    void api.prompt(worktreeId, prompt);
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
      <div className="agent-meta">
        {session && (
          <>
            <span title="Total session cost">${session.totalCostUsd.toFixed(3)}</span>
            <span className="agent-meta-sep">·</span>
            <span title="Total tokens">{session.totalTokens.toLocaleString()} tokens</span>
          </>
        )}
      </div>
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {blocks.length === 0 && (
          <div className="chat-empty">
            Ask for anything — the dryad works right here in this worktree.
          </div>
        )}
        {blocks.map((block, i) => (
          <BlockRow key={i} block={block} />
        ))}
        {permissions.map((p) => (
          <PermissionCard key={p.id} request={p} />
        ))}
        {running && permissions.length === 0 && <div className="thinking">the dryad is working…</div>}
      </div>

      {(session?.queuedPrompts.length ?? 0) > 0 && (
        <div className="queue-list">
          {session?.queuedPrompts.map((q) => (
            <div key={q.id} className="queue-item">
              <span className="queue-text">{q.text}</span>
              <button
                className="ghost"
                title="Remove from queue"
                onClick={() => void api.removeQueued(worktreeId, q.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className="prompt-bar"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          rows={2}
          placeholder={running ? "Queue a follow-up…" : "Tell the dryad what to do…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <div className="prompt-actions">
            <button type="submit" className="btn-quiet" disabled={!text.trim()}>
              Queue
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void api.interrupt(worktreeId)}
            >
              Stop
            </button>
          </div>
        ) : (
          <button type="submit" className="btn-primary" disabled={!text.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
