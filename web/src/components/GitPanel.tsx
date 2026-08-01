import { useState } from "react";
import type { StatusEntry } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { useDiff, useInvalidate, useStatusQuery } from "../lib/queries";
import { useSylva } from "../state/store";
import { DiffView } from "./DiffView";

function FileList({
  title,
  entries,
  action,
  actionLabel,
  onSelect,
  selectedPath,
}: {
  title: string;
  entries: StatusEntry[];
  action: (path: string) => void;
  actionLabel: string;
  onSelect: (path: string, staged: boolean) => void;
  selectedPath: string | null;
}) {
  if (entries.length === 0) return null;
  const staged = title === "Staged";
  return (
    <section className="git-group">
      <header className="git-group-head">
        <span className="pixel-label">{title.toLowerCase()}</span>
        <span className="git-count">{entries.length}</span>
      </header>
      {entries.map((entry) => (
        <div
          key={`${title}-${entry.path}`}
          className={`git-file ${selectedPath === entry.path ? "git-file-on" : ""}`}
        >
          <button className="git-file-name" onClick={() => onSelect(entry.path, staged)}>
            <span className={`chg chg-${entry.kind}`}>
              {entry.kind === "added" || entry.kind === "untracked"
                ? "+"
                : entry.kind === "deleted"
                  ? "−"
                  : entry.kind === "renamed"
                    ? "→"
                    : "~"}
            </span>
            {entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path}
          </button>
          <button className="ghost git-file-action" onClick={() => action(entry.path)}>
            {actionLabel}
          </button>
        </div>
      ))}
    </section>
  );
}

export function GitPanel({
  worktreeId,
  initialDiffPath,
}: {
  worktreeId: string;
  initialDiffPath?: string | null;
}) {
  const wsStatus = useSylva((s) => s.statuses[worktreeId]);
  const statusQuery = useStatusQuery(wsStatus ? null : worktreeId);
  const status = wsStatus ?? statusQuery.data;
  const invalidate = useInvalidate();

  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(
    initialDiffPath ? { path: initialDiffPath, staged: false } : null,
  );
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const diff = useDiff(selected ? worktreeId : null, selected?.path ?? null, selected?.staged ?? false);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      if (done) setFeedback(done);
      invalidate.diffs();
    } catch (e) {
      if (e instanceof ApiFailure && e.message === "no-upstream") {
        if (confirm(`${e.detail}. Push with --set-upstream origin?`)) {
          await run(() => api.push(worktreeId, true), "Pushed with upstream set.");
          return;
        }
      } else {
        setFeedback(e instanceof ApiFailure ? (e.detail ?? e.message) : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="git-loading">Reading the tree rings…</div>;

  const clean =
    status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0;

  return (
    <div className="git-panel">
      <div className="git-side">
        <div className="git-actions">
          <button
            className="btn-quiet"
            disabled={busy}
            onClick={() => void run(() => api.pull(worktreeId), "Pulled.")}
          >
            ↓ Pull
          </button>
          <button
            className="btn-quiet"
            disabled={busy}
            onClick={() => void run(() => api.push(worktreeId, false), "Pushed.")}
          >
            ↑ Push
          </button>
          {status.unstaged.length + status.untracked.length > 0 && (
            <button
              className="btn-quiet"
              disabled={busy}
              onClick={() => void run(() => api.stage(worktreeId, "all"))}
            >
              Stage all
            </button>
          )}
        </div>

        {clean && <div className="git-clean">Clean canopy — nothing to commit.</div>}

        <FileList
          title="Staged"
          entries={status.staged}
          actionLabel="unstage"
          action={(p) => void run(() => api.unstage(worktreeId, [p]))}
          onSelect={(path, staged) => setSelected({ path, staged })}
          selectedPath={selected?.staged ? selected.path : null}
        />
        <FileList
          title="Changes"
          entries={status.unstaged}
          actionLabel="stage"
          action={(p) => void run(() => api.stage(worktreeId, [p]))}
          onSelect={(path, staged) => setSelected({ path, staged })}
          selectedPath={selected && !selected.staged ? selected.path : null}
        />
        <FileList
          title="Untracked"
          entries={status.untracked}
          actionLabel="stage"
          action={(p) => void run(() => api.stage(worktreeId, [p]))}
          onSelect={(path) => setSelected({ path, staged: false })}
          selectedPath={selected && !selected.staged ? selected.path : null}
        />

        {status.staged.length > 0 && (
          <form
            className="commit-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.commit(worktreeId, message);
                setMessage("");
                playCue("commit");
              }, "Committed.");
            }}
          >
            <textarea
              rows={3}
              placeholder="Commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={busy || !message.trim()}>
              Commit {status.staged.length} file{status.staged.length === 1 ? "" : "s"}
            </button>
          </form>
        )}

        {feedback && <div className="git-feedback">{feedback}</div>}
      </div>

      <div className="git-diff">
        {selected ? (
          diff.data ? (
            <>
              <div className="diff-title">
                <code>{selected.path}</code>
                <span className="pixel-label">{selected.staged ? "staged" : "unstaged"}</span>
              </div>
              <DiffView diff={diff.data} />
            </>
          ) : (
            <div className="git-loading">{diff.isError ? "Couldn't load diff." : "Loading diff…"}</div>
          )
        ) : (
          <div className="diff-placeholder">Select a file to see its diff.</div>
        )}
      </div>
    </div>
  );
}
