import { useState } from "react";
import type { StatusEntry } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { confirm } from "../lib/confirm";
import { useDiff, useInvalidate, useStatusQuery } from "../lib/queries";
import { useSylva } from "../state/store";
import { CommitGraph } from "./CommitGraph";
import { CreatePrButton } from "./CreatePrButton";
import { DiffView } from "./DiffView";

function FileList({
  title,
  tip,
  entries,
  action,
  actionLabel,
  actionTip,
  onSelect,
  selectedPath,
}: {
  title: string;
  /** What this group of files means, for the header tooltip. */
  tip: string;
  entries: StatusEntry[];
  action: (path: string) => void;
  actionLabel: string;
  actionTip: string;
  onSelect: (path: string, staged: boolean) => void;
  selectedPath: string | null;
}) {
  if (entries.length === 0) return null;
  const staged = title === "Staged";
  return (
    <section className="git-group">
      <header className="git-group-head">
        <span className="pixel-label" data-tip={tip}>
          {title.toLowerCase()}
        </span>
        <span className="git-count" data-tip="Files in this group">
          {entries.length}
        </span>
      </header>
      {entries.map((entry) => (
        <div
          key={`${title}-${entry.path}`}
          className={`git-file ${selectedPath === entry.path ? "git-file-on" : ""}`}
        >
          <button
            className="git-file-name"
            onClick={() => onSelect(entry.path, staged)}
            data-tip="Show this file's diff"
          >
            <span className={`chg chg-${entry.kind}`} data-tip={`This file was ${entry.kind}`}>
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
          <button
            className="ghost git-file-action"
            onClick={() => action(entry.path)}
            data-tip={actionTip}
          >
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
  const [view, setView] = useState<"changes" | "history">("changes");
  const [drafting, setDrafting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const diff = useDiff(selected ? worktreeId : null, selected?.path ?? null, selected?.staged ?? false);

  /**
   * Runs as its own one-off query, not through this worktree's chat session,
   * so it works mid-turn and leaves nothing in the transcript.
   */
  const draftMessage = async () => {
    setDrafting(true);
    setFeedback(null);
    try {
      const { message: drafted } = await api.commitMessage(worktreeId);
      setMessage(drafted);
    } catch (e) {
      setFeedback(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't draft a message");
    } finally {
      setDrafting(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      if (done) setFeedback(done);
      invalidate.diffs();
    } catch (e) {
      if (e instanceof ApiFailure && e.message === "no-upstream") {
        const ok = await confirm({
          title: "This branch has no upstream",
          body: `${e.detail}. Push it with --set-upstream origin, so this branch tracks the remote from now on?`,
          confirmLabel: "Push and set upstream",
        });
        if (ok) {
          await run(() => api.push(worktreeId, true), "Pushed with upstream set.");
          return;
        }
        setFeedback("Not pushed — the branch still has no upstream.");
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
            data-tip="Fetch and merge commits from the remote"
          >
            ↓ Pull
          </button>
          <button
            className="btn-quiet"
            disabled={busy}
            onClick={() => void run(() => api.push(worktreeId, false), "Pushed.")}
            data-tip="Send your commits to the remote"
          >
            ↑ Push
          </button>
          {status.unstaged.length + status.untracked.length > 0 && (
            <button
              className="btn-quiet"
              disabled={busy}
              onClick={() => void run(() => api.stage(worktreeId, "all"))}
              data-tip="Stage every change in this worktree"
            >
              Stage all
            </button>
          )}
          <CreatePrButton worktreeId={worktreeId} branch={status.branch} />
        </div>

        {/* Two different questions — "what have I changed" and "where does this
            branch sit" — so they get a tab each rather than one long column.
            Changes leads because that is what you came here to do. */}
        <div className="seg git-seg" role="group" aria-label="Git view">
          <button
            className={view === "changes" ? "seg-on" : ""}
            onClick={() => setView("changes")}
            data-tip="Stage, unstage and commit what you've changed"
          >
            Changes
          </button>
          <button
            className={view === "history" ? "seg-on" : ""}
            onClick={() => setView("history")}
            data-tip="This branch against its base — ahead, behind, and where they met"
          >
            History
          </button>
        </div>

        {view === "history" && <CommitGraph worktreeId={worktreeId} />}

        {view === "changes" && clean && (
          <div className="git-clean" data-tip="Nothing has changed since the last commit">
            Clean canopy — nothing to commit.
          </div>
        )}

        {view === "changes" && (
          <>
        <FileList
          title="Staged"
          tip="Changes that will go into the next commit"
          entries={status.staged}
          actionLabel="unstage"
          actionTip="Take this file back out of the next commit"
          action={(p) => void run(() => api.unstage(worktreeId, [p]))}
          onSelect={(path, staged) => setSelected({ path, staged })}
          selectedPath={selected?.staged ? selected.path : null}
        />
        <FileList
          title="Changes"
          tip="Tracked files you've edited but not staged yet"
          entries={status.unstaged}
          actionLabel="stage"
          actionTip="Add this file to the next commit"
          action={(p) => void run(() => api.stage(worktreeId, [p]))}
          onSelect={(path, staged) => setSelected({ path, staged })}
          selectedPath={selected && !selected.staged ? selected.path : null}
        />
        <FileList
          title="Untracked"
          tip="New files git isn't following yet"
          entries={status.untracked}
          actionLabel="stage"
          actionTip="Start tracking this file and add it to the next commit"
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
              data-tip="Describe what this commit changes"
            />
            <div className="commit-actions">
              <button
                className="btn-quiet"
                type="button"
                disabled={busy || drafting}
                onClick={() => void draftMessage()}
                data-tip="Have a dryad read the staged diff and write the message"
              >
                {drafting ? "Reading the diff…" : "✦ Draft message"}
              </button>
              <button
                className="btn-primary"
                type="submit"
                disabled={busy || drafting || !message.trim()}
                data-tip="Record the staged files as a commit"
              >
                Commit {status.staged.length} file{status.staged.length === 1 ? "" : "s"}
              </button>
            </div>
          </form>
        )}

          </>
        )}

        {feedback && (
          <div className="git-feedback" data-tip="Result of the last git command">
            {feedback}
          </div>
        )}
      </div>

      <div className="git-diff">
        {selected ? (
          diff.data ? (
            <>
              <div className="diff-title">
                <code data-tip="File you're looking at">{selected.path}</code>
                <span
                  className="pixel-label"
                  data-tip={
                    selected.staged
                      ? "Showing the copy already staged for commit"
                      : "Showing edits that aren't staged yet"
                  }
                >
                  {selected.staged ? "staged" : "unstaged"}
                </span>
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
