import { useState } from "react";
import { OPEN_TARGETS, type AppPreferences, type SavedPrompt } from "sylva-shared";

/** Where the Open button sends a worktree. */
export function OpenTargetField({
  value,
  onChange,
}: {
  value: AppPreferences;
  onChange: (next: AppPreferences) => void;
}) {
  return (
    <>
      <div className="field">
        <span data-tip="Which application the Open button hands a worktree to">Open with</span>
        <div className="settings-control">
          <select
            value={value.openTarget}
            onChange={(e) =>
              onChange({ ...value, openTarget: e.target.value as AppPreferences["openTarget"] })
            }
            data-tip="Pick the editor, terminal or file manager to open worktrees in"
          >
            {OPEN_TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <span className="field-hint">
          {OPEN_TARGETS.find((t) => t.id === value.openTarget)?.note}
        </span>
      </div>

      {value.openTarget === "custom" && (
        <label className="field">
          Command
          <input
            className="mono-input"
            value={value.openCommand}
            placeholder="code {path}"
            onChange={(e) => onChange({ ...value, openCommand: e.target.value })}
            data-tip="{path} is replaced with the worktree directory"
          />
          <span className="field-hint">
            Run directly, never through a shell — so it can launch one program with arguments, and
            nothing else. <code>{"{path}"}</code> becomes the worktree directory.
          </span>
        </label>
      )}
    </>
  );
}

/** Snippets the prompt bar can append to whatever you've typed. */
export function SavedPromptsField({
  value,
  onChange,
}: {
  value: AppPreferences;
  onChange: (next: AppPreferences) => void;
}) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");

  const prompts = value.savedPrompts;
  const update = (next: SavedPrompt[]) => onChange({ ...value, savedPrompts: next });

  const add = () => {
    const trimmedLabel = label.trim();
    const trimmedText = text.trim();
    if (!trimmedLabel || !trimmedText) return;
    update([
      ...prompts,
      { id: `p${Date.now().toString(36)}`, label: trimmedLabel, text: trimmedText },
    ]);
    setLabel("");
    setText("");
  };

  return (
    <div className="field">
      <span data-tip="Reusable prompts, added to whatever is already in the box">
        Saved prompts
      </span>
      <ul className="saved-editor">
        {prompts.length === 0 && <li className="field-hint">None yet.</li>}
        {prompts.map((p) => (
          <li key={p.id} className="saved-editor-row">
            <span className="saved-editor-label">{p.label}</span>
            <span className="saved-editor-text">{p.text}</span>
            <button
              className="ghost"
              onClick={() => update(prompts.filter((x) => x.id !== p.id))}
              aria-label={`Delete ${p.label}`}
              data-tip="Delete this saved prompt"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="saved-editor-new">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name"
          data-tip="Shown in the prompt bar menu"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="The prompt text"
          data-tip="Appended to whatever you've already typed"
        />
        <button
          className="btn-quiet"
          onClick={add}
          disabled={!label.trim() || !text.trim()}
          data-tip="Add this to your saved prompts"
        >
          Add
        </button>
      </div>
      <span className="field-hint">
        Picking one adds it to what you've already typed rather than replacing it, so they stack.
      </span>
    </div>
  );
}
