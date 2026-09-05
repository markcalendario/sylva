import { useState } from "react";
import type { Worktree } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { useInvalidate } from "../../lib/queries";
import { Dialog } from "../Dialog";

/** Git refuses a dirty worktree and says so; that's our cue to offer force. */
const DIRTY_HINT = /--force|modified or untracked|contains modified/i;

export function RemoveWorktreeDialog({
  worktree,
  onClose,
}: {
  worktree: Worktree;
  onClose: () => void;
}) {
  const [needsForce, setNeedsForce] = useState(false);
  /**
   * Whether the branch goes too.
   *
   * Off by default, and deliberately: removing a worktree is about the folder,
   * and the branch is where the work actually is. Saying so out loud is the
   * point of the checkbox — this used to be the one thing removal quietly left
   * behind, with nothing on screen to say it had.
   */
  const [alsoBranch, setAlsoBranch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();

  // A detached worktree has no branch to delete, so there is nothing to offer.
  const branch = worktree.branch;

  const remove = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.removeWorktree(worktree.id, force, alsoBranch && branch !== null);
      invalidate.worktrees(worktree.repoId);
      invalidate.branches();
      onClose();
    } catch (e) {
      const detail = e instanceof ApiFailure ? (e.detail ?? e.message) : String(e);
      setError(detail);
      if (DIRTY_HINT.test(detail)) setNeedsForce(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Remove worktree" open onClose={onClose}>
      <p className="dialog-hint">
        Removes the worktree directory from disk, and the registration git keeps for it. The branch{" "}
        <code>{branch ?? "(detached)"}</code> and its commits stay in the repository unless you say
        otherwise below.
      </p>
      <pre className="permission-summary" data-tip="Folder that will be deleted from disk">
        {worktree.path}
      </pre>

      {branch && (
        <label className="dialog-check" data-tip="Delete the branch as well, not just the folder">
          <input
            type="checkbox"
            checked={alsoBranch}
            onChange={(e) => setAlsoBranch(e.target.checked)}
            disabled={busy}
          />
          <span>
            Also delete the branch <code>{branch}</code> from git
          </span>
        </label>
      )}

      {alsoBranch && branch && (
        <p className="field-hint">
          {needsForce
            ? "Forcing the removal deletes the branch outright, merged or not."
            : "Git refuses this if the branch has commits that aren't merged anywhere, and says so — nothing is lost by trying."}
        </p>
      )}

      {error && <div className="form-error">{error}</div>}

      {needsForce && (
        <div className="force-warning">
          <span className="pixel-label" data-tip="Git refused because this worktree has changes">
            uncommitted work
          </span>
          <p>
            This worktree has changes that aren't committed. Forcing the removal deletes them, and
            they can't be recovered.
          </p>
        </div>
      )}

      <div className="dialog-actions">
        <button
          type="button"
          className="btn-quiet"
          onClick={onClose}
          disabled={busy}
          data-tip="Keep this worktree and close"
        >
          Cancel
        </button>
        {needsForce ? (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={() => void remove(true)}
            data-tip="Delete the folder and its uncommitted changes for good"
          >
            {busy ? "Removing…" : "Force remove and lose changes"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={() => void remove(false)}
            data-tip={
              alsoBranch
                ? "Delete the folder and the branch"
                : "Delete the folder; the branch and its commits stay"
            }
          >
            {busy ? "Removing…" : alsoBranch ? "Remove worktree and branch" : "Remove worktree"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
