import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  /** The consequence, in a sentence. Shown below the title. */
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button as destructive. */
  tone?: "normal" | "danger";
}

interface Pending extends ConfirmRequest {
  id: number;
  resolve: (answer: boolean) => void;
}

interface ConfirmState {
  pending: Pending | null;
  answer: (ok: boolean) => void;
  ask: (request: ConfirmRequest) => Promise<boolean>;
}

let nextId = 0;

/**
 * The browser's confirm() blocks the page, ignores every token in the design,
 * and cannot be styled at all. This is the replacement: one host mounted beside
 * the tooltip layer, and a promise at the call site, so that swapping a
 * confirm() for a real dialog stays a two-line change rather than a state
 * management exercise.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,

  answer: (ok) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(ok);
  },

  ask: (request) =>
    new Promise<boolean>((resolve) => {
      // A second question while one is open would replace it and leave the
      // first promise hanging forever; decline it instead.
      const existing = get().pending;
      if (existing) {
        set({ pending: null });
        existing.resolve(false);
      }
      set({ pending: { ...request, id: nextId++, resolve } });
    }),
}));

/** Ask the user to confirm something. Resolves false on cancel, Escape or backdrop. */
export function confirm(request: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().ask(request);
}
