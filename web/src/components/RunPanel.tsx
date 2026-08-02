import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Eraser, ExternalLink, Play, RotateCcw, Square } from "lucide-react";
import type { RunnerLine } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { ANSI_INITIAL, parseAnsiLine, type AnsiState } from "../lib/ansi";
import { NO_EVENTS, useSylva } from "../state/store";

/**
 * The projects, running.
 *
 * Not a terminal — nothing is typed at it — but it reads like one, because the
 * output *is* terminal output and stripping its colour throws away the part
 * that tells errors from progress at a glance.
 *
 * With several worktrees the logs are merged rather than stacked in separate
 * panes: the moment worth seeing is an old system and a new one booting
 * together and one of them failing, and two scrolling panes leave you to
 * correlate that yourself.
 */
export function RunPanel({ members }: { members: string[] }) {
  const runners = useSylva((s) => s.runners);
  const output = useSylva((s) => s.runnerOutput);
  const index = useSylva((s) => s.worktreeIndex);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = members.length > 1;

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // A runner outlives this tab, so arriving means catching up on whatever it
  // has been saying while we were elsewhere.
  const memberKey = members.join(",");
  useEffect(() => {
    for (const id of memberKey ? memberKey.split(",") : []) {
      void api
        .runner(id)
        .then(({ state, lines }) => useSylva.getState().seedRunner(id, state, lines))
        .catch(() => {});
    }
  }, [memberKey]);

  /**
   * One log in the order things actually happened. Each worktree's SGR state is
   * carried separately — colour opened by one process must not bleed into
   * another's line just because they interleaved.
   */
  const rendered = useMemo(() => {
    const ids = memberKey ? memberKey.split(",") : [];
    const all: { worktreeId: string; line: RunnerLine }[] = ids.flatMap((id) =>
      (output[id] ?? NO_EVENTS).map((line) => ({ worktreeId: id, line })),
    );
    all.sort((a, b) => a.line.at.localeCompare(b.line.at) || a.line.seq - b.line.seq);

    const carry = new Map<string, AnsiState>();
    return all.map(({ worktreeId, line }) => {
      const parsed = parseAnsiLine(line.text, carry.get(worktreeId) ?? ANSI_INITIAL);
      carry.set(worktreeId, parsed.next);
      return { worktreeId, line, parsed };
    });
  }, [memberKey, output]);

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

  /** Best effort across every member; one refusal shouldn't stop the others. */
  const actAll = async (fn: (id: string) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    for (const id of members) {
      await fn(id).catch(() => {});
    }
    setBusy(false);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [rendered.length]);

  const anyRunning = members.some((id) => runners[id]?.status === "running");
  const anyLines = rendered.length > 0;

  return (
    <div className="run-panel">
      {shared && (
        <div className="run-all-bar">
          <button
            className="btn-primary run-toggle"
            disabled={busy}
            onClick={() => void actAll((id) => api.startRunner(id))}
            data-tip="Start every project this dryad tends"
          >
            <Play size={13} fill="currentColor" /> Run all
          </button>
          <button
            className="btn-quiet run-toggle"
            disabled={busy || !anyRunning}
            onClick={() => void actAll((id) => api.stopRunner(id))}
            data-tip="Stop everything that's running"
          >
            <Square size={13} fill="currentColor" /> Stop all
          </button>
          <span className="run-all-gap" />
          {anyLines && (
            <button
              className="ghost"
              onClick={() => {
                for (const id of members) useSylva.getState().clearRunnerOutput(id);
              }}
              aria-label="Clear the output"
              data-tip="Clear what's on screen — the commands keep running"
            >
              <Eraser size={14} />
            </button>
          )}
        </div>
      )}

      {members.map((id) => (
        <RunnerRow
          key={id}
          worktreeId={id}
          shared={shared}
          busy={busy}
          onAct={act}
          canClear={!shared && anyLines}
        />
      ))}

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
            {anyRunning
              ? "Started — waiting for something to be said."
              : "Nothing has run here yet. Run starts the command above in this worktree."}
          </div>
        ) : (
          rendered.map(({ worktreeId, line, parsed }) => (
            <div
              key={`${worktreeId}:${line.seq}`}
              className={`run-line ${line.stream === "stderr" ? "run-line-err" : ""}`}
            >
              {/* Which project said it, only when more than one can. */}
              {shared && (
                <span
                  className="run-line-where"
                  data-tip={index[worktreeId]?.repoName ?? worktreeId}
                >
                  {(index[worktreeId]?.repoName ?? worktreeId).slice(0, 10)}
                </span>
              )}
              <span className="run-line-text">
                {parsed.segments.length === 0
                  ? " "
                  : parsed.segments.map((segment, i) => (
                      <span
                        key={i}
                        className={segment.className}
                        style={{
                          ...(parsed.styles[i]?.fg ? { color: parsed.styles[i]?.fg } : {}),
                          ...(parsed.styles[i]?.bg ? { background: parsed.styles[i]?.bg } : {}),
                        }}
                      >
                        {segment.text}
                      </span>
                    ))}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** One worktree's command: what it is, whether it's up, and where it's served. */
function RunnerRow({
  worktreeId,
  shared,
  busy,
  onAct,
  canClear,
}: {
  worktreeId: string;
  shared: boolean;
  busy: boolean;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
  canClear: boolean;
}) {
  const state = useSylva((s) => s.runners[worktreeId]);
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);
  const running = state?.status === "running";

  return (
    <div className="run-bar">
      {shared && (
        <span className="run-bar-where" data-tip={place?.repoName ?? worktreeId}>
          {place?.repoName ?? worktreeId.slice(0, 7)}
        </span>
      )}
      <button
        className={running ? "btn-danger run-toggle" : "btn-primary run-toggle"}
        disabled={busy || !state}
        onClick={() =>
          void onAct(() => (running ? api.stopRunner(worktreeId) : api.startRunner(worktreeId)))
        }
        data-tip={running ? "Stop this command and everything it started" : "Run this project here"}
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

      {canClear && (
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
