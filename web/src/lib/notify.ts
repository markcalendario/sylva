import type { ServerEvent } from "sylva-shared";
import { api } from "./api";
import { useSylva } from "../state/store";

/** Ask for notification permission the first time the user talks to an agent. */
export function ensureNotifyPermission(): void {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/** Browser notification when an agent finishes somewhere the user isn't looking. */
export function notifyAgentEvent(event: ServerEvent): void {
  if (event.type !== "agent.event" || event.event.kind !== "result") return;
  const { focusedWorktreeId } = useSylva.getState();
  const backgrounded = event.worktreeId !== focusedWorktreeId || document.hidden;
  if (!backgrounded) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const outcome = event.event.outcome;
  const title =
    outcome === "success"
      ? "A dryad finished its task"
      : outcome === "interrupted"
        ? "Agent interrupted"
        : "Agent hit an error";
  const n = new Notification(`Sylva — ${title}`, {
    body: `Worktree ${event.worktreeId.slice(0, 8)} · click to open`,
    tag: `sylva-${event.worktreeId}`,
  });
  n.onclick = () => {
    window.focus();
    void api.setFocus(event.worktreeId);
    n.close();
  };
}
