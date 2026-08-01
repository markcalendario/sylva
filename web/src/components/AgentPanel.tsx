import { useEffect, useRef, useState } from "react";
import type { AgentEvent, PermissionRequest } from "sylva-shared";
import { api } from "../lib/api";
import { ensureNotifyPermission } from "../lib/notify";
import { NO_EVENTS, useSylva } from "../state/store";

function ToolCall({ event }: { event: Extract<AgentEvent, { kind: "tool-use" }> }) {
  const [openDetail, setOpenDetail] = useState(false);
  return (
    <div className="tool-call">
      <button className="tool-head" onClick={() => setOpenDetail((o) => !o)}>
        <span className="tool-chip">{event.tool}</span>
        <span className="tool-summary">{event.summary}</span>
      </button>
      {openDetail && event.input !== undefined && (
        <pre className="tool-detail">{JSON.stringify(event.input, null, 2)}</pre>
      )}
    </div>
  );
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

function EventRow({ event }: { event: AgentEvent }) {
  switch (event.kind) {
    case "user-prompt":
      return <div className="msg msg-user">{event.text}</div>;
    case "assistant-text":
      return <div className="msg msg-assistant">{event.text}</div>;
    case "tool-use":
      return <ToolCall event={event} />;
    case "tool-result":
      return event.isError ? (
        <div className="tool-result-error">{event.summary || "Tool failed"}</div>
      ) : null;
    case "result":
      return (
        <div className={`turn-result turn-${event.outcome}`}>
          {event.outcome === "success" ? "✦ turn complete" : `✕ ${event.outcome}`}
          {event.costUsd !== undefined && (
            <span className="turn-cost">${event.costUsd.toFixed(3)}</span>
          )}
        </div>
      );
    case "error":
      return <div className="tool-result-error">{event.message}</div>;
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
        {transcript.length === 0 && (
          <div className="chat-empty">
            Ask for anything — the dryad works right here in this worktree.
          </div>
        )}
        {transcript.map((event, i) => (
          <EventRow key={i} event={event} />
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
