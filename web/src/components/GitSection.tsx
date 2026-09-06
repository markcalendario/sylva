import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Minus,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { StatusEntry, WorktreeStatus } from "sylva-shared";
import { FileGlyph, splitPath } from "./FileGlyph";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { confirm } from "../lib/confirm";
import { useInvalidate, useStatusQuery } from "../lib/queries";
import { useHasForest, useWords } from "../lib/theme";
import { useSylva, type DiffSelection } from "../state/store";
import { BranchName } from "./BranchName";
import { CreatePrButton } from "./CreatePrButton";
import { OpenFileButton } from "./OpenFileButton";
import { PullRequestCard } from "./PullRequestCard";

/** Which side of the index a group is about. Carried on the group's edge. */
type Tone = "staged" | "changed" | "new";

function FileList({
  title,
  tone,
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
  onDiscard,
  onDiscardAll,
  onError,
}: {
  title: string;
  tone: Tone;
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
  /** Throw one file's changes away. Confirmed by the caller. */
  onDiscard: (entry: StatusEntry) => void;
  /** Throw this whole group away. */
  onDiscardAll?: () => void;
  /** Somewhere for a row's failure to be said out loud. */
  onError: (message: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section className={`git-group git-group-${tone}`}>
      <header className="git-group-head">
        <span className="git-group-dot" aria-hidden />
        <span className="git-group-title" data-tip={tip}>
          {title}
        </span>
        <span className="git-count" data-tip="Files in this group">
          {entries.length}
        </span>
        <span className="git-group-gap" />
        {onActAll && (
          <button
            className="git-group-all"
            onClick={onActAll}
            data-tip={`${actAllLabel} every file in this group`}
          >
            {actAllLabel}
          </button>
        )}
        {onDiscardAll && (
          <button
            className="git-icon git-group-discard"
            onClick={onDiscardAll}
            aria-label={`Discard every change in ${title}`}
            data-tip="Throw away every change in this group — this cannot be undone"
          >
            <Trash2 size={12} />
          </button>
        )}
      </header>

      <div className="git-group-files">
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

              {/* One gutter, always the same width, so the row never changes
                  shape as it is hovered and every control is in the same place
                  from row to row. */}
              <div className="git-file-acts">
                {/* The diff answers "what changed"; often the next question is
                    "and what does the rest of the file look like now". */}
                <button
                  className="git-icon git-file-open"
                  onClick={() => useSylva.getState().openFile({ worktreeId, path: entry.path })}
                  aria-label={`Open ${entry.path} in the Files tab`}
                  data-tip="Open this file in the Files tab"
                >
                  <FileCode2 size={12} />
                </button>
                {/* And the third destination, for the files neither of the
                    other two can say anything useful about — an image, a PDF,
                    a spreadsheet the agent just rewrote. */}
                <OpenFileButton
                  className="git-icon git-file-external"
                  worktreeId={worktreeId}
                  path={entry.path}
                  onError={onError}
                />
                {/* Staging is + and unstaging is −, at the same size and in the
                    same slot, so a column of rows stays a column rather than
                    the ragged edge two words of different length made. */}
                <button
                  className="git-icon git-file-action"
                  onClick={() => action(entry.path)}
                  aria-label={`${actionLabel} ${entry.path}`}
                  data-tip={actionTip}
                >
                  {staged ? <Minus size={12} /> : <Plus size={12} />}
                </button>
                {/* Last, and the only control in the row that destroys
                    something. Hidden until the row is hovered or focused, so a
                    list you are reading doesn't offer to delete on every line. */}
                <button
                  className="git-icon git-file-discard"
                  onClick={() => onDiscard(entry)}
                  aria-label={`Discard changes to ${entry.path}`}
                  data-tip={
                    entry.kind === "untracked"
                      ? "Delete this file — it was never committed, so there is nothing to restore it from"
                      : "Throw away the changes to this file and put it back as it was"
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
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
  const hasForest = useHasForest();
  const wsStatus = useSylva((s) => s.statuses[worktreeId]);
  const statusQuery = useStatusQuery(wsStatus ? null : worktreeId);
  const status: WorktreeStatus | undefined = wsStatus ?? statusQuery.data;
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);
  const invalidate = useInvalidate();

  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  /**
   * Discarding, with the question asked first.
   *
   * The wording is deliberate about which of the two kinds of loss this is:
   * a tracked file goes back to its last committed state, and an untracked
   * one is deleted outright. Those are different amounts of gone, and a single
   * "are you sure?" would be telling only half of it.
   */
  const discardFiles = async (paths: string[], kind: "tracked" | "untracked" | "mixed") => {
    const many = paths.length > 1;
    const what = many ? `${paths.length} files` : (paths[0] ?? "this file");
    const ok = await confirm({
      title: many ? `Discard ${paths.length} files?` : "Discard this change?",
      body:
        kind === "untracked"
          ? `${many ? "They were" : `${what} was`} never committed, so ${
              many ? "they are" : "it is"
            } deleted outright — there is nothing in git to restore ${many ? "them" : "it"} from.`
          : kind === "mixed"
            ? "Tracked files go back to their last committed state; files git was never following are deleted outright. Neither can be undone."
            : `${what} goes back to its last committed state. Anything changed since is gone, and no part of git remembers it.`,
      confirmLabel: many ? "Discard them" : "Discard it",
      tone: "danger",
    });
    if (!ok) return;
    await run(() => api.discard(worktreeId, paths), many ? "Discarded." : "Discarded.");
  };

  const discardEverything = async () => {
    const ok = await confirm({
      title: "Discard everything in this worktree?",
      body: `All ${changed} changed file${
        changed === 1 ? "" : "s"
      } go back to the last commit, and files git was never following are deleted. Ignored files — node_modules, your .env — are left alone. None of this can be undone.`,
      confirmLabel: "Discard everything",
      tone: "danger",
    });
    if (!ok) return;
    await run(() => api.discard(worktreeId, "all"), "Discarded everything.");
  };

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
    return (
      <div className="git-loading">
        {hasForest ? "Reading the tree rings…" : "Reading git status…"}
      </div>
    );
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
            {status.branch ? (
              <BranchName branch={status.branch} className="git-section-branch" />
            ) : (
              <code className="git-section-branch">detached</code>
            )}
          </button>

          <span
            className={`git-section-count ${changed ? "git-section-count-on" : ""}`}
            data-tip="Files changed in this worktree"
          >
            {changed === 0 ? "clean" : changed}
          </span>
        </header>
      )}

      {open && (
        <>
          {/* ── The remote ──────────────────────────────────────────────────
              Where this branch is pushed, how far it has drifted from its
              base, and the three things you do about it. The counts sit on
              the buttons themselves: "Push 3" answers "is there anything to
              push" without a second glance somewhere else on the panel. */}
          <div className="git-remote">
            <div className="git-remote-line">
              <span
                className={`git-upstream ${status.upstream ? "" : "git-upstream-none"}`}
                data-tip={
                  status.upstream
                    ? `This branch tracks ${status.upstream}`
                    : "This branch tracks nothing yet — pushing will offer to set an upstream"
                }
              >
                {status.upstream ?? "no upstream"}
              </span>
              {status.base && (
                <span
                  className="git-divergence"
                  data-tip={`Commits ahead ↑ and behind ↓ ${status.base.branch}`}
                >
                  <span className="div-base">{status.base.branch}</span>
                  <span className={status.base.ahead ? "div-ahead" : "div-zero"}>
                    ↑{status.base.ahead}
                  </span>
                  <span className={status.base.behind ? "div-behind" : "div-zero"}>
                    ↓{status.base.behind}
                  </span>
                </span>
              )}
            </div>

            <div className="git-ops">
              <button
                className="git-op"
                disabled={busy}
                onClick={() => void run(() => api.pull(worktreeId), "Pulled.")}
                data-tip={
                  status.behind
                    ? `Fetch and merge ${status.behind} commit${status.behind === 1 ? "" : "s"} from the remote`
                    : "Fetch and merge commits from the remote"
                }
              >
                <ArrowDown size={13} />
                Pull
                {status.behind > 0 && <span className="git-op-num">{status.behind}</span>}
              </button>
              <button
                className="git-op"
                disabled={busy}
                onClick={() => void run(() => api.push(worktreeId, false), "Pushed.")}
                data-tip={
                  status.ahead
                    ? `Send ${status.ahead} commit${status.ahead === 1 ? "" : "s"} to the remote`
                    : "Send your commits to the remote"
                }
              >
                <ArrowUp size={13} />
                Push
                {status.ahead > 0 && <span className="git-op-num">{status.ahead}</span>}
              </button>
              <CreatePrButton className="git-op" worktreeId={worktreeId} branch={status.branch} />
            </div>
          </div>

          {/* Above the change list, because "is my PR green" is a question you
              ask before you start adding to it. */}
          <PullRequestCard worktreeId={worktreeId} />

          {changed === 0 ? (
            <p className="git-clean" data-tip="Nothing has changed since the last commit">
              {hasForest ? "Clean canopy — nothing to commit." : "Nothing to commit."}
            </p>
          ) : (
            <>
              {/* Everything in the worktree at once, kept apart from the
                  per-group actions below so "all" always means the same
                  thing in the same place. */}
              <div className="git-work">
                <span className="git-work-tally">
                  {changed} file{changed === 1 ? "" : "s"} changed
                </span>
                <button
                  className="git-work-all"
                  disabled={busy || status.unstaged.length + status.untracked.length === 0}
                  onClick={() => void run(() => api.stage(worktreeId, "all"), "Staged everything.")}
                  data-tip="Add every change in this worktree to the next commit, new files included"
                >
                  Stage all
                </button>
                <button
                  className="git-icon git-discard-all"
                  disabled={busy}
                  onClick={() => void discardEverything()}
                  aria-label="Discard every change in this worktree"
                  data-tip="Throw away every change in this worktree — this cannot be undone"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <FileList
                title="staged"
                tone="staged"
                tip="Changes that will go into the next commit"
                entries={status.staged}
                worktreeId={worktreeId}
                staged
                actionLabel="unstage"
                actionTip="Take this file back out of the next commit"
                action={(p) => void run(() => api.unstage(worktreeId, [p]))}
                onSelect={onSelect}
                selection={selection}
                onError={onFeedback}
                onActAll={() => void run(() => api.unstage(worktreeId, "all"))}
                actAllLabel="unstage all"
                onDiscard={(e) => void discardFiles([e.path], "tracked")}
                onDiscardAll={() =>
                  void discardFiles(
                    status.staged.map((e) => e.path),
                    "tracked",
                  )
                }
              />
              <FileList
                title="changes"
                tone="changed"
                tip="Tracked files you've edited but not staged yet"
                entries={status.unstaged}
                worktreeId={worktreeId}
                staged={false}
                actionLabel="stage"
                actionTip="Add this file to the next commit"
                action={(p) => void run(() => api.stage(worktreeId, [p]))}
                onSelect={onSelect}
                selection={selection}
                onError={onFeedback}
                onActAll={() => void run(() => api.stage(worktreeId, "all"))}
                actAllLabel="stage all"
                onDiscard={(e) => void discardFiles([e.path], "tracked")}
                onDiscardAll={() =>
                  void discardFiles(
                    status.unstaged.map((e) => e.path),
                    "tracked",
                  )
                }
              />
              <FileList
                title="untracked"
                tone="new"
                tip="New files git isn't following yet"
                entries={status.untracked}
                worktreeId={worktreeId}
                staged={false}
                actionLabel="stage"
                actionTip="Start tracking this file and add it to the next commit"
                action={(p) => void run(() => api.stage(worktreeId, [p]))}
                onSelect={onSelect}
                selection={selection}
                onError={onFeedback}
                /* Untracked files could be staged one at a time but not all at
                   once, which is the wrong way round: a new feature's worth of
                   files is exactly what you want to add in one go. */
                onActAll={() =>
                  void run(() =>
                    api.stage(
                      worktreeId,
                      status.untracked.map((e) => e.path),
                    ),
                  )
                }
                actAllLabel="stage all"
                onDiscard={(e) => void discardFiles([e.path], "untracked")}
                onDiscardAll={() =>
                  void discardFiles(
                    status.untracked.map((e) => e.path),
                    "untracked",
                  )
                }
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
              <div className="commit-head">
                <span className="git-group-dot commit-head-dot" aria-hidden />
                <span className="git-group-title">commit</span>
                <span className="commit-head-where">
                  {status.staged.length} staged file{status.staged.length === 1 ? "" : "s"}
                  {shared && status.branch ? ` · ${status.branch}` : ""}
                </span>
              </div>
              <textarea
                rows={3}
                placeholder={
                  shared
                    ? `Commit message for ${status.branch ?? "this worktree"}`
                    : "Summarise what this commit changes"
                }
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                data-tip="Describe what this commit changes"
              />
              <div className="commit-actions">
                <button
                  className="commit-draft"
                  type="button"
                  disabled={busy || drafting}
                  onClick={() => void draftMessage()}
                  data-tip={`Have ${words.agent === "dryad" ? "a dryad" : "an agent"} read the staged diff and write the message`}
                >
                  <Sparkles size={13} />
                  {drafting ? "Reading the diff…" : "Draft"}
                </button>
                <button
                  className="btn-primary commit-go"
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
