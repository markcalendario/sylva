import { useEffect, useRef } from "react";
import { useConfirmStore } from "../lib/confirm";
import { Dialog } from "./Dialog";

/**
 * Renders whatever question is currently being asked. Mounted once, beside the
 * tooltip layer, so any call site can ask one without wiring state through the
 * tree to get there.
 */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const answer = useConfirmStore((s) => s.answer);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the action, not the dialog: the answer is usually already decided by
  // the time the question appears, and Enter should be able to give it.
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending?.id]);

  if (!pending) return null;

  const danger = pending.tone === "danger";

  return (
    <Dialog
      // Keyed so a second question can never reuse the first one's state.
      key={pending.id}
      title={pending.title}
      open
      onClose={() => answer(false)}
    >
      <p className="dialog-hint">{pending.body}</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn-quiet"
          onClick={() => answer(false)}
          data-tip="Leave things as they are"
        >
          {pending.cancelLabel ?? "Cancel"}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={() => answer(true)}
          data-tip={danger ? "Go ahead — this cannot be undone" : "Go ahead"}
        >
          {pending.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Dialog>
  );
}
