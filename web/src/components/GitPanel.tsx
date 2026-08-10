import { useState } from "react";
import { ArrowDown, ArrowUp, FileCode2, Sparkles, X } from "lucide-react";
import { api, ApiFailure } from "../lib/api";
import { playCue } from "../lib/audio";
import { useDiff, useInvalidate } from "../lib/queries";
import { useSylva, type DiffSelection } from "../state/store";
import { CommitGraph } from "./CommitGraph";
import { DiffView } from "./DiffView";
import { GitSection } from "./GitSection";
import { OpenPullsButton } from "./OpenPullsButton";

/**
 * Git for everything the dryad tends.
 *
 * One section per worktree, because a branch, a commit and a diff each belong
 * to exactly one repository and pretending otherwise would be a lie. What is
 * genuinely shared sits outside the sections: pulling and pushing everything,
 * and one message across several worktrees — a coordinated change is one change
 * that happens to land in two places, and typing the message twice is how the
 * two commits drift apart.
 */
export function GitPanel({
  members,
  selection,
  onSelect,
}: {
  members: string[];
  selection: DiffSelection | null;
  onSelect: (selection: DiffSelection | null) => void;
}) {
  const [view, setView] = useState<"changes" | "history">("changes");
  const [feedback, setFeedback] = useState<string | null>(null);
  const shared = members.length > 1;

  const diff = useDiff(
    selection ? selection.worktreeId : null,
    selection?.path ?? null,
    selection?.staged ?? false,
    selection?.commit,
  );
  const selectedPlace = useSylva((s) =>
    selection ? s.worktreeIndex[selection.worktreeId] : undefined,
  );

  return (
    <div className="git-panel">
      <div className="git-side">
        {shared && <SharedToolbar members={members} onFeedback={setFeedback} />}

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
            data-tip="Each branch against its base — ahead, behind, and where they met"
          >
            History
          </button>
        </div>

        <div className="git-scroll">
          {view === "history" &&
            members.map((id) => (
              <div key={id} className="git-history-lane">
                {shared && <WorktreeLabel worktreeId={id} />}
                <CommitGraph worktreeId={id} selection={selection} onSelect={onSelect} />
              </div>
            ))}

          {view === "changes" &&
            members.map((id) => (
              <GitSection
                key={id}
                worktreeId={id}
                selection={selection}
                onSelect={onSelect}
                shared={shared}
                onFeedback={setFeedback}
              />
            ))}
        </div>

        {view === "changes" && shared && <SharedCommit members={members} onFeedback={setFeedback} />}

        {feedback && (
          <div className="git-feedback" data-tip="Result of the last git command">
            {feedback}
          </div>
        )}
      </div>

      <div className="git-diff">
        {selection ? (
          <>
            <div className="diff-title">
              {selectedPlace && shared && (
                <span className="diff-worktree" data-tip="Worktree this file is in">
                  {selectedPlace.repoName}
                </span>
              )}
              <code data-tip="File you're looking at">{selection.path}</code>
              <span
                className="pixel-label"
                data-tip={
                  selection.commit
                    ? "Showing this file as that commit left it"
                    : selection.staged
                      ? "Showing the copy already staged for commit"
                      : "Showing edits that aren't staged yet"
                }
              >
                {selection.commit
                  ? `commit ${selection.commit.slice(0, 7)}`
                  : selection.staged
                    ? "staged"
                    : "unstaged"}
              </span>
              {/* A patch read in isolation is often not enough; this is the
                  way from "what changed here" to the file it changed. */}
              <button
                className="ghost diff-open"
                onClick={() =>
                  useSylva.getState().openFileHere({
                    worktreeId: selection.worktreeId,
                    path: selection.path,
                  })
                }
                aria-label="Open this file in the Files tab"
                data-tip="Open this file in the Files tab"
              >
                <FileCode2 size={13} />
              </button>
              <button
                className="ghost diff-close"
                onClick={() => onSelect(null)}
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

function WorktreeLabel({ worktreeId }: { worktreeId: string }) {
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);
  const status = useSylva((s) => s.statuses[worktreeId]);
  return (
    <div className="git-lane-label">
      <span className="git-section-repo">{place?.repoName ?? "worktree"}</span>
      <code className="git-section-branch">{status?.branch ?? place?.branch ?? ""}</code>
    </div>
  );
}

/** What genuinely spans every worktree the dryad tends. */
function SharedToolbar({
  members,
  onFeedback,
}: {
  members: string[];
  onFeedback: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();

  /**
   * Runs across every worktree and reports per worktree. One failure doesn't
   * abandon the rest — the ones that worked are real work, and stopping at the
   * first problem would leave the set in a state nobody chose.
   */
  const all = async (label: string, fn: (id: string) => Promise<unknown>) => {
    setBusy(true);
    onFeedback(null);
    const failures: string[] = [];
    for (const id of members) {
      try {
        await fn(id);
      } catch (e) {
        failures.push(e instanceof ApiFailure ? (e.detail ?? e.message) : String(e));
      }
    }
    invalidate.diffs();
    setBusy(false);
    onFeedback(
      failures.length === 0
        ? `${label} everywhere.`
        : `${label} in ${members.length - failures.length} of ${members.length}. ${failures.join("; ")}`,
    );
  };

  return (
    <div className="git-toolbar">
      <div className="git-toolbar-branch">
        <span className="git-toolbar-title">{members.length} worktrees</span>
      </div>
      <div className="git-toolbar-actions">
        <button
          className="btn-quiet"
          disabled={busy}
          onClick={() => void all("Pulled", (id) => api.pull(id))}
          data-tip="Pull in every worktree this dryad tends"
        >
          <ArrowDown size={13} /> Pull all
        </button>
        <button
          className="btn-quiet"
          disabled={busy}
          onClick={() => void all("Pushed", (id) => api.push(id, false))}
          data-tip="Push every worktree this dryad tends"
        >
          <ArrowUp size={13} /> Push all
        </button>
        {members[0] && <OpenPullsButton worktreeId={members[0]} />}
      </div>
    </div>
  );
}

/**
 * One message, several commits.
 *
 * Offered only when more than one worktree has something staged: with one, the
 * section's own commit box is the right place, and a second box beside it would
 * be two buttons doing the same job.
 */
function SharedCommit({
  members,
  onFeedback,
}: {
  members: string[];
  onFeedback: (message: string | null) => void;
}) {
  const statuses = useSylva((s) => s.statuses);
  const index = useSylva((s) => s.worktreeIndex);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();

  const staged = members.filter((id) => (statuses[id]?.staged.length ?? 0) > 0);
  if (staged.length < 2) return null;

  const names = staged.map((id) => statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7));

  const commit = async () => {
    setBusy(true);
    onFeedback(null);
    try {
      const { results } = await api.commitMany(staged, message);
      const landed = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        setMessage("");
        playCue("commit");
        onFeedback(`Committed in ${landed.length} worktrees.`);
      } else {
        // Name both halves. A partial result whose shape you can't see is worse
        // than an outright failure.
        const failedNames = failed
          .map((r) => `${index[r.worktreeId]?.repoName ?? r.worktreeId}: ${r.error ?? "failed"}`)
          .join("; ");
        onFeedback(
          `Committed in ${landed.length} of ${results.length}. Not committed — ${failedNames}`,
        );
      }
      invalidate.diffs();
    } catch (e) {
      onFeedback(e instanceof ApiFailure ? (e.detail ?? e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="commit-form commit-form-shared"
      onSubmit={(e) => {
        e.preventDefault();
        void commit();
      }}
    >
      <div className="commit-shared-head">
        <Sparkles size={12} />
        one message, {staged.length} worktrees
        <span className="commit-shared-where">{names.join(" · ")}</span>
      </div>
      <textarea
        rows={3}
        placeholder="Commit message for all of them"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        data-tip="The same message is committed in each worktree that has staged files"
      />
      <div className="commit-actions">
        <button
          className="btn-primary"
          type="submit"
          disabled={busy || !message.trim()}
          data-tip="Commit the staged files in each of these worktrees"
        >
          Commit in {staged.length} worktrees
        </button>
      </div>
    </form>
  );
}
