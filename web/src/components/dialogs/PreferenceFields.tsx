import { useState } from "react";
import {
  EDITOR_TARGETS,
  type AppPreferences,
  type OpenChoice,
  type SavedPrompt,
} from "sylva-shared";

/** One "open with" chooser, plus its command box when set to custom. */
function TargetField({
  title,
  choices,
  target,
  command,
  onTarget,
  onCommand,
}: {
  title: string;
  choices: OpenChoice[];
  target: AppPreferences["editorTarget"];
  command: string;
  onTarget: (next: AppPreferences["editorTarget"]) => void;
  onCommand: (next: string) => void;
}) {
  return (
    <>
      <div className="field">
        <span data-tip={`Which application the ${title.toLowerCase()} button opens`}>{title}</span>
        <div className="settings-control">
          <select
            value={target}
            onChange={(e) => onTarget(e.target.value as AppPreferences["editorTarget"])}
            data-tip={`Pick what the ${title.toLowerCase()} button launches`}
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <span className="field-hint">{choices.find((c) => c.id === target)?.note}</span>
      </div>

      {target === "custom" && (
        <label className="field">
          Command
          <input
            className="mono-input"
            value={command}
            placeholder="code {path}"
            onChange={(e) => onCommand(e.target.value)}
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
      <TargetField
        title="Open in editor"
        choices={EDITOR_TARGETS}
        target={value.editorTarget}
        command={value.editorCommand}
        onTarget={(editorTarget) => onChange({ ...value, editorTarget })}
        onCommand={(editorCommand) => onChange({ ...value, editorCommand })}
      />
    </>
  );
}

/**
 * Which shell the Terminal tab opens. Empty means whatever you log in with,
 * which is what almost everyone wants and nobody should have to state.
 */
export function TerminalShellField({
  value,
  onChange,
}: {
  value: AppPreferences;
  onChange: (next: AppPreferences) => void;
}) {
  return (
    <label className="field">
      <span data-tip="The program each new terminal runs">Shell</span>
      <input
        className="mono-input"
        value={value.terminalShell}
        placeholder={"$SHELL"}
        spellCheck={false}
        onChange={(e) => onChange({ ...value, terminalShell: e.target.value })}
        data-tip="Leave empty to use your login shell"
      />
      <span className="field-hint">
        Leave this empty and Sylva uses your login shell. Give an absolute path —{" "}
        <code>/opt/homebrew/bin/fish</code> — to use something else. Terminals already open keep
        the shell they started with.
      </span>
    </label>
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
