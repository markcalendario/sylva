import type { ServerEvent } from "sylva-shared";
import { api } from "./api";
import { useSylva } from "../state/store";

/** Ask for notification permission the first time the user talks to an agent. */
export function ensureNotifyPermission(): void {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/**
 * What to call a worktree in a notification. The session carries its branch,
 * and anything worth notifying about has a session; the id is a last resort.
 */
function label(worktreeId: string): string {
  const branch = useSylva.getState().sessions[worktreeId]?.branch;
  return branch ?? `worktree ${worktreeId.slice(0, 8)}`;
}

function show(worktreeId: string, title: string, body: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const n = new Notification(`Sylva — ${title}`, { body, tag: `sylva-${worktreeId}` });
  n.onclick = () => {
    window.focus();
    void api.setFocus(worktreeId);
    n.close();
  };
}

/** True when the user isn't already looking at this worktree. */
function backgrounded(worktreeId: string): boolean {
  const { focusedWorktreeId } = useSylva.getState();
  return worktreeId !== focusedWorktreeId || document.hidden;
}

/**
 * Notifications for the two things worth interrupting someone over: an agent
 * that finished, and an agent stuck waiting on a decision. The second matters
 * more — a finished agent costs nothing to notice late, a blocked one is
 * burning your afternoon — so it is the one that must never be silent.
 */
export function notifyAgentEvent(event: ServerEvent): void {
  if (event.type === "permission.request") {
    const { worktreeId, tool } = event.request;
    if (!backgrounded(worktreeId)) return;
    show(
      worktreeId,
      "A dryad needs your decision",
      `${label(worktreeId)} · ${tool} · click to answer`,
    );
    return;
  }

  if (event.type !== "agent.event" || event.event.kind !== "result") return;
  if (!backgrounded(event.worktreeId)) return;

  const outcome = event.event.outcome;
  const title =
    outcome === "success"
      ? "A dryad finished its task"
      : outcome === "interrupted"
        ? "Agent interrupted"
        : "Agent hit an error";
  show(event.worktreeId, title, `${label(event.worktreeId)} · click to open`);
}
