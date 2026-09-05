import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FileCode2, Sparkles } from "lucide-react";
import type { StatusEntry, WorktreeStatus } from "sylva-shared";
import { FileGlyph, splitPath } from "./FileGlyph";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { confirm } from "../lib/confirm";
import { useInvalidate, useStatusQuery } from "../lib/queries";
import { useWords } from "../lib/theme";
import { useSylva, type DiffSelection } from "../state/store";
import { CreatePrButton } from "./CreatePrButton";
import { PullRequestCard } from "./PullRequestCard";

function FileList({
  title,
  tip,
  entries,
  worktreeId,
  action,
  actionLabel,
  actionTip,
  onSelect,
  selection,
  staged,
  onActAll,
  actAllLabel,
}: {
  title: string;
  tip: string;
  entries: StatusEntry[];
  worktreeId: string;
  action: (path: string) => void;
  actionLabel: string;
  actionTip: string;
  onSelect: (selection: DiffSelection) => void;
  selection: DiffSelection | null;
  staged: boolean;
  onActAll?: () => void;
  actAllLabel?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="git-group">
      <header className="git-group-head">
        <span className="pixel-label" data-tip={tip}>
          {title}
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
      {entries.map((entry) => {
        // A path alone can't identify a row once two worktrees are on screen.
        const on =
          selection?.worktreeId === worktreeId &&
          selection.path === entry.path &&
          selection.staged === staged;
        // The directories are what the row can afford to lose; the name is not.
        const { lead, tail } = splitPath(entry.path);
        return (
          <div key={`${title}-${entry.path}`} className={`git-file ${on ? "git-file-on" : ""}`}>
            <button
              className="git-file-name"
              onClick={() => onSelect({ worktreeId, path: entry.path, staged })}
              // The path itself, because the row may have had to cut it.
              data-tip={`${entry.path} — show this file's diff`}
            >
              <span
                className={`chg chg-${entry.kind} git-file-glyph`}
                data-tip={`This file was ${entry.kind}`}
              >
                <FileGlyph path={entry.path} />
              </span>
              <span className="git-file-path">
                <span className="path-lead">
                  {entry.renamedFrom ? `${entry.renamedFrom} → ${lead}` : lead}
                </span>
                <span className="path-tail">{tail}</span>
              </span>
            </button>
            {/* The diff answers "what changed"; often the next question is
                "and what does the rest of the file look like now". */}
            <button
              className="ghost git-file-open"
              onClick={() => useSylva.getState().openFile({ worktreeId, path: entry.path })}
              aria-label={`Open ${entry.path} in the Files tab`}
              data-tip="Open this file in the Files tab"
            >
              <FileCode2 size={12} />
            </button>
            <button
              className="ghost git-file-action"
              onClick={() => action(entry.path)}
              data-tip={actionTip}
            >
              {actionLabel}
            </button>
          </div>
        );
      })}
    </section>
  );
}

/**
 * One worktree's git, whole: its branch, what has changed in it, and its own
 * commit. Rendered once for an ordinary worktree and once per member for a
 * shared dryad — the same component either way, so the common case stays the
 * exercised one.
 */
export function GitSection({
  worktreeId,
  selection,
  onSelect,
  /** Labels and collapsing only earn their space when there's more than one. */
  shared,
  onFeedback,
}: {
  worktreeId: string;
  selection: DiffSelection | null;
  onSelect: (selection: DiffSelection) => void;
  shared: boolean;
  onFeedback: (message: string | null) => void;
}) {
  const words = useWords();
  const wsStatus = useSylva((s) => s.statuses[worktreeId]);
  const statusQuery = useStatusQuery(wsStatus ? null : worktreeId);
  const status: WorktreeStatus | undefined = wsStatus ?? statusQuery.data;
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);
  const invalidate = useInvalidate();

  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    onFeedback(null);
    try {
      await fn();
      if (done) onFeedback(done);
      invalidate.diffs();
      // Staging, committing, pulling and pushing all move the status, and the
      // counts that read it are all over the app — the sidebar row, the Files
      // and Git tab badges, the workspace card. Ask for it rather than waiting
      // to be told.
      invalidate.statusNow(worktreeId);
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
        onFeedback("Not pushed — the branch still has no upstream.");
      } else {
        onFeedback(e instanceof ApiFailure ? (e.detail ?? e.message) : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const draftMessage = async () => {
    setDrafting(true);
    onFeedback(null);
    try {
      const { message: drafted } = await api.commitMessage(worktreeId);
      setMessage(drafted);
    } catch (e) {
      onFeedback(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't draft a message");
    } finally {
      setDrafting(false);
    }
  };

  if (!status) {
    return <div className="git-loading">Reading the tree rings…</div>;
  }

  const changed = status.staged.length + status.unstaged.length + status.untracked.length;
  // A worktree with nothing happening in it shouldn't push the one that is
  // moving off the bottom of the screen.
  const open = openOverride ?? (!shared || changed > 0);

  return (
    <section className={`git-section ${shared ? "git-section-shared" : ""}`}>
      {shared && (
        <header className="git-section-head">
          <button
            className="git-section-toggle"
            onClick={() => setOpenOverride(!open)}
            aria-expanded={open}
            data-tip={open ? "Collapse this worktree" : "Expand this worktree"}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="git-section-repo">{place?.repoName ?? "worktree"}</span>
            <code className="git-section-branch">{status.branch ?? "detached"}</code>
          </button>

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
          <span className="git-section-count" data-tip="Files changed in this worktree">
            {changed === 0 ? "clean" : changed}
          </span>
        </header>
      )}

      {open && (
        <>
          <div className="git-section-actions">
            <button
              className="btn-quiet"
              disabled={busy}
              onClick={() => void run(() => api.pull(worktreeId), "Pulled.")}
              data-tip="Fetch and merge commits from the remote"
            >
              <ArrowDown size={13} /> Pull
            </button>
            <button
              className="btn-quiet"
              disabled={busy}
              onClick={() => void run(() => api.push(worktreeId, false), "Pushed.")}
              data-tip="Send your commits to the remote"
            >
              <ArrowUp size={13} /> Push
            </button>
            <CreatePrButton worktreeId={worktreeId} branch={status.branch} />
          </div>

          {/* Above the change list, because "is my PR green" is a question you
              ask before you start adding to it. */}
          <PullRequestCard worktreeId={worktreeId} />

          {changed === 0 ? (
            <div className="git-clean" data-tip="Nothing has changed since the last commit">
              Clean canopy — nothing to commit.
            </div>
          ) : (
            <>
              <FileList
                title="staged"
                tip="Changes that will go into the next commit"
                entries={status.staged}
                worktreeId={worktreeId}
                staged
                actionLabel="unstage"
                actionTip="Take this file back out of the next commit"
                action={(p) => void run(() => api.unstage(worktreeId, [p]))}
                onSelect={onSelect}
                selection={selection}
                onActAll={() => void run(() => api.unstage(worktreeId, "all"))}
                actAllLabel="unstage all"
              />
              <FileList
                title="changes"
                tip="Tracked files you've edited but not staged yet"
                entries={status.unstaged}
                worktreeId={worktreeId}
                staged={false}
                actionLabel="stage"
                actionTip="Add this file to the next commit"
                action={(p) => void run(() => api.stage(worktreeId, [p]))}
                onSelect={onSelect}
                selection={selection}
                onActAll={() => void run(() => api.stage(worktreeId, "all"))}
                actAllLabel="stage all"
              />
              <FileList
                title="untracked"
                tip="New files git isn't following yet"
                entries={status.untracked}
                worktreeId={worktreeId}
                staged={false}
                actionLabel="stage"
                actionTip="Start tracking this file and add it to the next commit"
                action={(p) => void run(() => api.stage(worktreeId, [p]))}
                onSelect={onSelect}
                selection={selection}
              />
            </>
          )}

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
                placeholder={
                  shared
                    ? `Commit message for ${status.branch ?? "this worktree"}`
                    : "Commit message"
                }
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
                  data-tip={`Have ${words.agent === "dryad" ? "a dryad" : "an agent"} read the staged diff and write the message`}
                >
                  {drafting ? (
                    "Reading the diff…"
                  ) : (
                    <>
                      <Sparkles size={13} /> Draft message
                    </>
                  )}
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
    </section>
  );
}
