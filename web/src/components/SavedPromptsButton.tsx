import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../lib/queries";

/**
 * Reusable prompt snippets. Picking one *appends* to whatever is already in the
 * box rather than replacing it, so snippets can be stacked — "review my
 * changes" then "and run the tests" — and nothing you've typed is ever lost to
 * a stray click.
 */
export function SavedPromptsButton({ onInsert }: { onInsert: (text: string) => void }) {
  const prefs = usePreferences();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const prompts = prefs.data?.savedPrompts ?? [];
  if (prompts.length === 0) return null;

  return (
    <div className="saved-wrap" ref={wrap}>
      <button
        type="button"
        className="attach-btn"
        aria-label="Insert a saved prompt"
        aria-expanded={open}
        data-tip="Saved prompts — added to what you've already typed"
        onClick={() => setOpen((o) => !o)}
      >
        ❏
      </button>
      {open && (
        <ul className="saved-menu">
          <li className="saved-menu-head">Saved prompts</li>
          {prompts.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="saved-item"
                onClick={() => {
                  onInsert(p.text);
                  setOpen(false);
                }}
                data-tip={p.text}
              >
                <span className="saved-label">{p.label}</span>
                <span className="saved-preview">{p.text}</span>
              </button>
            </li>
          ))}
          <li className="saved-menu-foot">Manage these in Settings</li>
        </ul>
      )}
    </div>
  );
}
