import { ArrowDown, ArrowUp, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { StatusEntry, WorktreeStatus } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { confirm } from "../lib/confirm";
import { useDiff, useInvalidate, useStatusQuery } from "../lib/queries";
import { useSylva } from "../state/store";
import { CommitGraph } from "./CommitGraph";
import { CreatePrButton } from "./CreatePrButton";
import { OpenPullsButton } from "./OpenPullsButton";
import { DiffView } from "./DiffView";

const KIND_GLYPH: Record<StatusEntry["kind"], string> = {
  added: "+",
  untracked: "+",
  deleted: "−",
  renamed: "→",
  modified: "~",
};

function FileList({
  title,
  tip,
  entries,
  action,
  actionLabel,
  actionTip,
  onSelect,
  selectedPath,
  onActAll,
  actAllLabel,
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
  onActAll?: () => void;
  actAllLabel?: string;
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
        {onActAll && (
          <button
            className="ghost git-group-all"
            onClick={onActAll}
            data-tip={`${actAllLabel} every file in this group`}
          >
            {actAllLabel}
          </button>
        )}
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
              {KIND_GLYPH[entry.kind]}
            </span>
            <span className="git-file-path">
              {entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path}
            </span>
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

/** Branch, divergence and the remote actions — where the branch sits, and what to do about it. */
function GitToolbar({
  status,
  busy,
  onPull,
  onPush,
}: {
  status: WorktreeStatus;
  busy: boolean;
  onPull: () => void;
  onPush: () => void;
}) {
  return (
    <div className="git-toolbar">
      <div className="git-toolbar-branch">
        <code className="git-branch-name" data-tip="Branch checked out in this worktree">
          {status.branch ?? "detached"}
        </code>
        {status.upstream ? (
          <span className="git-upstream" data-tip="Remote branch this one tracks">
            {status.upstream}
          </span>
        ) : (
          <span className="git-upstream git-upstream-none" data-tip="Nothing to push to yet">
            no upstream
          </span>
        )}
        {status.base && (
          <span
            className="git-divergence"
            data-tip={`Commits ahead ↑ and behind ↓ ${status.base.branch}`}
          >
            <span className={status.base.ahead ? "div-ahead" : "div-zero"}>
              ↑{status.base.ahead}
            </span>
            <span className={status.base.behind ? "div-behind" : "div-zero"}>
              ↓{status.base.behind}
            </span>
          </span>
        )}
      </div>

      <div className="git-toolbar-actions">
        <button
          className="btn-quiet"
          disabled={busy}
          onClick={onPull}
          data-tip="Fetch and merge commits from the remote"
        >
          <ArrowDown size={13} /> Pull
        </button>
        <button
          className="btn-quiet"
          disabled={busy}
          onClick={onPush}
          data-tip="Send your commits to the remote"
        >
          <ArrowUp size={13} /> Push
        </button>
        <CreatePrButton worktreeId={status.worktreeId} branch={status.branch} />
        <OpenPullsButton worktreeId={status.worktreeId} />
      </div>
    </div>
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
        <GitToolbar
          status={status}
          busy={busy}
          onPull={() => void run(() => api.pull(worktreeId), "Pulled.")}
          onPush={() => void run(() => api.push(worktreeId, false), "Pushed.")}
        />

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

        {/* The lists scroll; the toolbar above and the commit box below stay put,
            because a worktree with sixty changed files shouldn't push the thing
            you came to press off the bottom of the screen. */}
        <div className="git-scroll">
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
                onActAll={() => void run(() => api.unstage(worktreeId, "all"))}
                actAllLabel="unstage all"
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
                onActAll={() => void run(() => api.stage(worktreeId, "all"))}
                actAllLabel="stage all"
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
            </>
          )}
        </div>

        {view === "changes" && status.staged.length > 0 && (
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
                {drafting ? "Reading the diff…" : <><Sparkles size={13} /> Draft message</>}
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

        {feedback && (
          <div className="git-feedback" data-tip="Result of the last git command">
            {feedback}
          </div>
        )}
      </div>

      <div className="git-diff">
        {selected ? (
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
              <button
                className="ghost diff-close"
                onClick={() => setSelected(null)}
                aria-label="Close this diff"
                data-tip="Close this diff"
              >
                <X size={14} />
              </button>
            </div>
            {diff.data ? (
              <DiffView diff={diff.data} />
            ) : (
              <div className="git-loading">
                {diff.isError ? "Couldn't load diff." : "Loading diff…"}
              </div>
            )}
          </>
        ) : (
          <div className="diff-placeholder">Select a file to see its diff.</div>
        )}
      </div>
    </div>
  );
}
