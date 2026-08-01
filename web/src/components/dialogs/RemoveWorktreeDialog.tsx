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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();

  const remove = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.removeWorktree(worktree.id, force);
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
        Removes the worktree directory from disk. The branch{" "}
        <code>{worktree.branch ?? "(detached)"}</code> and its commits stay in the repository.
      </p>
      <pre className="permission-summary">{worktree.path}</pre>

      {error && <div className="form-error">{error}</div>}

      {needsForce && (
        <div className="force-warning">
          <span className="pixel-label">uncommitted work</span>
          <p>
            This worktree has changes that aren't committed. Forcing the removal deletes them, and
            they can't be recovered.
          </p>
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {needsForce ? (
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove(true)}>
            {busy ? "Removing…" : "Force remove and lose changes"}
          </button>
        ) : (
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove(false)}>
            {busy ? "Removing…" : "Remove worktree"}
          </button>
        )}
      </div>
    </Dialog>
  );
}
