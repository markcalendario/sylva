import { useSyncExternalStore } from "react";

const STORAGE_KEY = "sylva.chat-motion";

/**
 * How a new block arrives in the conversation.
 *
 * Text used to appear — one frame it wasn't there, the next it was, at full
 * size and full contrast. That is the harshest thing a screen can do, and it
 * happens twenty times a turn: every sentence, every tool call, every result.
 * A hundred and sixty milliseconds of movement is enough to turn each of those
 * into something that arrived rather than something that was suddenly true.
 *
 * Three, because they are genuinely different tastes rather than three amounts
 * of the same one — and none of them is slow enough to wait for.
 */
export const CHAT_MOTIONS = ["fade", "rise", "unfold"] as const;

export type ChatMotion = (typeof CHAT_MOTIONS)[number];

export const DEFAULT_MOTION: ChatMotion = "rise";

export const MOTION_LABEL: Record<ChatMotion, string> = {
  fade: "Fade",
  rise: "Rise",
  unfold: "Unfold",
};

export const MOTION_TIP: Record<ChatMotion, string> = {
  fade: "Opacity only. The quietest — nothing moves, it just stops being absent.",
  rise: "Comes up a few pixels as it fades in, the way a new line pushes a page.",
  unfold: "Opens downward from its top edge, as though the block were being set down.",
};

export function isChatMotion(value: unknown): value is ChatMotion {
  return CHAT_MOTIONS.includes(value as ChatMotion);
}

export function loadMotion(): ChatMotion {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isChatMotion(raw) ? raw : DEFAULT_MOTION;
  } catch {
    // Private windows and blocked site data both throw here.
    return DEFAULT_MOTION;
  }
}

let current: ChatMotion = DEFAULT_MOTION;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Put it on the document, where the stylesheet can see it.
 *
 * An attribute rather than a class on each block: the choice is a property of
 * the app, and every block asking React which animation it is having would put
 * a preference into twenty components that have no other reason to know.
 */
export function applyMotion(motion: ChatMotion): ChatMotion {
  current = motion;
  document.documentElement.setAttribute("data-motion", motion);
  try {
    localStorage.setItem(STORAGE_KEY, motion);
  } catch {
    // Worth doing, not worth throwing over.
  }
  for (const listener of listeners) listener();
  return motion;
}

/** Called before React mounts, so the first blocks arrive the right way. */
export function initMotion(): ChatMotion {
  return applyMotion(loadMotion());
}

export function useChatMotion(): ChatMotion {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_MOTION,
  );
}
