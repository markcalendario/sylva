import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../lib/api";
import { NO_EVENTS, useSylva } from "../state/store";

/**
 * The project, running. Not a terminal — nothing is typed at it — just the one
 * command you'd otherwise open a terminal to run, and everything it says.
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
          className={running ? "btn-danger" : "btn-primary"}
          disabled={busy || !state}
          onClick={() =>
            void act(() => (running ? api.stopRunner(worktreeId) : api.startRunner(worktreeId)))
          }
          data-tip={
            running ? "Stop this command and everything it started" : "Run this project here"
          }
        >
          {running ? "■ Stop" : "▶ Run"}
        </button>

        <code className="run-command" data-tip="Set this per repository in Settings → Runner">
          {state?.command ?? "…"}
        </code>

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
            {state.url}
          </a>
        )}

        {lines.length > 0 && (
          <button
            className="ghost"
            onClick={() => useSylva.getState().clearRunnerOutput(worktreeId)}
            data-tip="Clear what's on screen — the command keeps running"
          >
            Clear
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
        {lines.length === 0 ? (
          <div className="run-empty">
            {running
              ? "Started — waiting for it to say something."
              : "Nothing has run here yet. ▶ Run starts the command above in this worktree."}
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.seq}
              className={`run-line ${line.stream === "stderr" ? "run-line-err" : ""}`}
            >
              {line.text || " "}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
