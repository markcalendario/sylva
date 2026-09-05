import { useEffect, useState } from "react";
import {
  clampScrollback,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN,
  TERMINAL_TARGETS,
  type AppPreferences,
  type TerminalTarget,
} from "sylva-shared";

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
        <code>/opt/homebrew/bin/fish</code> — to use something else. Terminals already open keep the
        shell they started with.
      </span>
    </label>
  );
}

/**
 * Which terminal application the worktree opens in.
 *
 * Not the same setting as the shell above, and worth keeping apart: that one
 * is the program a Terminal tab runs inside Sylva, this one is the terminal
 * Sylva hands the worktree to when a tab isn't enough — a full-screen TUI, a
 * build you want to keep watching after this window is closed, tmux.
 *
 * iTerm2 is hidden off a Mac because it doesn't exist there, and offering a
 * choice that can only fail is worse than not offering it.
 */
export function TerminalAppField({
  value,
  onChange,
}: {
  value: AppPreferences;
  onChange: (next: AppPreferences) => void;
}) {
  const mac = typeof navigator !== "undefined" && /Mac OS X|Macintosh/.test(navigator.userAgent);
  const choices = TERMINAL_TARGETS.filter((choice) => mac || !choice.macOnly);
  return (
    <>
      <div className="field">
        <span data-tip="The terminal application Sylva opens a worktree in">Terminal app</span>
        <div className="settings-control">
          <select
            value={value.terminalApp}
            onChange={(e) => onChange({ ...value, terminalApp: e.target.value as TerminalTarget })}
            data-tip="Used by Open in terminal, not by the Terminal tab"
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <span className="field-hint">
          Where <em>Open in terminal</em> sends a worktree — a separate thing from the shell above:
          that one runs inside Sylva's own Terminal tab, this one is your real terminal, in a window
          of its own. <em>Off</em> hides the action.
        </span>
      </div>

      {value.terminalApp === "custom" && (
        <label className="field">
          Command
          <input
            className="mono-input"
            value={value.terminalAppCommand}
            placeholder="alacritty --working-directory {path}"
            spellCheck={false}
            onChange={(e) => onChange({ ...value, terminalAppCommand: e.target.value })}
            data-tip="{path} is replaced with the worktree directory"
          />
          <span className="field-hint">
            Run directly, never through a shell — so it can launch one program with arguments, and
            nothing else. <code>{"{path}"}</code> becomes the worktree directory; leave it out and
            the command is simply started in the worktree instead.
          </span>
        </label>
      )}
    </>
  );
}

/**
 * Whether a new worktree gets the env files the old one had.
 *
 * `git worktree add` brings tracked files and nothing else, which leaves every
 * new tree without the one thing it needs to actually run. Copying them is the
 * default because the alternative default is a worktree that doesn't work.
 */
export function CopyEnvFilesField({
  value,
  onChange,
}: {
  value: AppPreferences;
  onChange: (next: AppPreferences) => void;
}) {
  const on = value.copyEnvFiles;
  return (
    <div className="field">
      <span data-tip="Copy .env files from the main worktree into each new one">
        Carry env files across
      </span>
      <div className="seg">
        <button
          type="button"
          className={on ? "seg-on" : ""}
          onClick={() => onChange({ ...value, copyEnvFiles: true })}
          data-tip="New worktrees get the env files the main one has"
        >
          Copy them
        </button>
        <button
          type="button"
          className={on ? "" : "seg-on"}
          onClick={() => onChange({ ...value, copyEnvFiles: false })}
          data-tip="Leave new worktrees without env files"
        >
          Leave them
        </button>
      </div>
      <span className="field-hint">
        Env files are gitignored, so <code>git worktree add</code> leaves them behind and the new
        tree can't start. This copies every <code>.env</code>, <code>.env.local</code> and the like
        from the main worktree — in its root <em>and</em> in subdirectories, so a monorepo gets the
        one per package too. Files already in the new tree are never overwritten.
      </span>
    </div>
  );
}

/**
 * How far a terminal can be scrolled back.
 *
 * Scrollback lives in the browser, so this is a memory setting wearing a
 * convenience setting's clothes: every line is held as cells, and several
 * terminals with a build's worth of output each is enough to make the whole
 * window stutter.
 */
export function TerminalScrollbackField({
  value,
  onChange,
}: {
  value: AppPreferences;
  onChange: (next: AppPreferences) => void;
}) {
  /**
   * What is in the box, which is not always a number yet.
   *
   * Clamping every keystroke would make "2000" impossible to type: the "2"
   * would be pulled up to the minimum before the second digit arrived. So the
   * field holds text, commits whenever the text is a value in range, and only
   * clamps once you have finished — which is what blur means.
   */
  const [text, setText] = useState(String(value.terminalScrollback));
  useEffect(() => setText(String(value.terminalScrollback)), [value.terminalScrollback]);

  const commit = () => {
    const next = clampScrollback(Number(text));
    setText(String(next));
    if (next !== value.terminalScrollback) onChange({ ...value, terminalScrollback: next });
  };

  return (
    <label className="field">
      <span data-tip="How many lines of output each terminal keeps">Scrollback</span>
      <input
        className="mono-input"
        type="number"
        min={TERMINAL_SCROLLBACK_MIN}
        max={TERMINAL_SCROLLBACK_MAX}
        step={100}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const typed = Number(e.target.value);
          if (
            e.target.value.trim() !== "" &&
            Number.isFinite(typed) &&
            typed >= TERMINAL_SCROLLBACK_MIN &&
            typed <= TERMINAL_SCROLLBACK_MAX
          ) {
            onChange({ ...value, terminalScrollback: Math.round(typed) });
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        data-tip={`Between ${TERMINAL_SCROLLBACK_MIN} and ${TERMINAL_SCROLLBACK_MAX.toLocaleString()} lines`}
      />
      <span className="field-hint">
        Lines kept above the top of each terminal, between {TERMINAL_SCROLLBACK_MIN} and{" "}
        {TERMINAL_SCROLLBACK_MAX.toLocaleString()}. They are held in this browser tab, so a large
        number across several busy terminals is paid for in memory — and eventually in how smoothly
        everything else moves. Applies to terminals already open as well as new ones; lines already
        past the new limit are dropped.
      </span>
    </label>
  );
}
