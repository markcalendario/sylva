import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Eraser, ExternalLink, Play, RotateCcw, Square } from "lucide-react";
import { api, ApiFailure } from "../lib/api";
import { ANSI_INITIAL, parseAnsiLine, type AnsiState } from "../lib/ansi";
import { NO_EVENTS, useSylva } from "../state/store";

/**
 * The project, running. Not a terminal — nothing is typed at it — but it reads
 * like one, because the output *is* terminal output and stripping its colour
 * throws away the part that tells errors from progress at a glance.
 */
export function RunPanel({ worktreeId }: { worktreeId: string }) {
  const state = useSylva((s) => s.runners[worktreeId]);
  const lines = useSylva((s) => s.runnerOutput[worktreeId] ?? NO_EVENTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // The runner outlives this tab, so arriving means catching up on whatever it
  // has been saying while we were elsewhere.
  useEffect(() => {
    void api
      .runner(worktreeId)
      .then(({ state, lines }) => useSylva.getState().seedRunner(worktreeId, state, lines))
      .catch(() => {});
  }, [worktreeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  /**
   * SGR state carries from one line to the next in a real terminal, so the
   * whole buffer is parsed as one run rather than each line in isolation —
   * otherwise a colour opened on one line is lost on the next.
   */
  const rendered = useMemo(() => {
    let carry: AnsiState = ANSI_INITIAL;
    return lines.map((line) => {
      const parsed = parseAnsiLine(line.text, carry);
      carry = parsed.next;
      return { line, parsed };
    });
  }, [lines]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const running = state?.status === "running";

  return (
    <div className="run-panel">
      <div className="run-bar">
        <button
          className={running ? "btn-danger run-toggle" : "btn-primary run-toggle"}
          disabled={busy || !state}
          onClick={() =>
            void act(() => (running ? api.stopRunner(worktreeId) : api.startRunner(worktreeId)))
          }
          data-tip={
            running ? "Stop this command and everything it started" : "Run this project here"
          }
        >
          {running ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          {running ? "Stop" : "Run"}
        </button>

        {state && <CommandField state={state} />}

        <span className="run-status">
          {running && (
            <span className="run-live" data-tip="The command is running right now">
              <span className="run-dot" />
              running
            </span>
          )}
          {state?.status === "exited" && (
            <span
              className={state.exitCode === 0 ? "run-exit-ok" : "run-exit-bad"}
              data-tip={
                state.exitCode === 0
                  ? "The command finished cleanly"
                  : "The command stopped with an error"
              }
            >
              exited{state.exitCode === null ? "" : ` · ${state.exitCode}`}
            </span>
          )}
        </span>

        {state?.url && (
          <a
            className="run-url"
            href={state.url}
            target="_blank"
            rel="noreferrer"
            data-tip="Open what this command is serving, in a new tab"
          >
            <ExternalLink size={12} />
            {state.url}
          </a>
        )}

        {lines.length > 0 && (
          <button
            className="ghost run-clear"
            onClick={() => useSylva.getState().clearRunnerOutput(worktreeId)}
            aria-label="Clear the output"
            data-tip="Clear what's on screen — the command keeps running"
          >
            <Eraser size={14} />
          </button>
        )}
      </div>

      {error && <div className="run-error">{error}</div>}

      <div
        className="run-log"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          // Scrolling up is a request to stay put; coming back to the bottom
          // re-arms the follow.
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {rendered.length === 0 ? (
          <div className="run-empty">
            {running
              ? "Started — waiting for it to say something."
              : "Nothing has run here yet. Run starts the command above in this worktree."}
          </div>
        ) : (
          rendered.map(({ line, parsed }) => (
            <div
              key={line.seq}
              className={`run-line ${line.stream === "stderr" ? "run-line-err" : ""}`}
            >
              {parsed.segments.length === 0
                ? " "
                : parsed.segments.map((segment, i) => (
                    <span
                      key={i}
                      className={segment.className}
                      style={{
                        ...(parsed.styles[i]?.fg ? { color: parsed.styles[i]?.fg } : {}),
                        ...(parsed.styles[i]?.bg
                          ? { background: parsed.styles[i]?.bg }
                          : {}),
                      }}
                    >
                      {segment.text}
                    </span>
                  ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The command, editable in place and saved against the repository it belongs
 * to. Changing it here is the same edit as changing it on the settings page —
 * this is just where you are when you discover it's wrong.
 */
function CommandField({ state }: { state: { command: string; repoId: string } }) {
  const [draft, setDraft] = useState(state.command);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();

  // Follow the server's value unless the user is mid-edit.
  useEffect(() => {
    setDraft(state.command);
  }, [state.command]);

  const dirty = draft.trim() !== state.command && draft.trim().length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const prefs = await api.preferences();
      await api.setPreferences({
        ...prefs,
        runner: {
          ...prefs.runner,
          byRepo: { ...prefs.runner.byRepo, [state.repoId]: draft.trim() },
        },
      });
      void qc.invalidateQueries({ queryKey: ["preferences"] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="run-command-field">
      <input
        className="run-command mono-input"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) void save();
          if (e.key === "Escape") setDraft(state.command);
        }}
        aria-label="Run command"
        data-tip="The command Run starts here. Enter saves it for this repository."
      />
      {dirty && (
        <>
          <button
            className="ghost run-command-save"
            disabled={saving}
            onClick={() => void save()}
            aria-label="Save this command"
            data-tip="Save for every worktree of this repository"
          >
            <Check size={14} />
          </button>
          <button
            className="ghost"
            onClick={() => setDraft(state.command)}
            aria-label="Discard the change"
            data-tip="Put the saved command back"
          >
            <RotateCcw size={13} />
          </button>
        </>
      )}
      {saved && !dirty && (
        <span className="run-command-saved" data-tip="Saved for this repository">
          saved
        </span>
      )}
    </span>
  );
}
