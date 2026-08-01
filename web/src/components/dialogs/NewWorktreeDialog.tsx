import { useState } from "react";
import type { Repo } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { useBranches, useInvalidate, useRepos } from "../../lib/queries";
import { Dialog } from "../Dialog";

/**
 * The single way to grow a worktree. Creating one focuses it, so you land in
 * the new tree ready to prompt — but nothing is sent to an agent for you.
 */
export function NewWorktreeDialog({
  repo,
  open,
  onClose,
}: {
  /** Pre-selected repo when opened from a repo row; otherwise the user picks. */
  repo?: Repo;
  open: boolean;
  onClose: () => void;
}) {
  const repos = useRepos();
  const invalidate = useInvalidate();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [repoId, setRepoId] = useState("");
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = repos.data?.filter((r) => r.available) ?? [];
  const effectiveRepoId = repo?.id ?? repoId ?? "";
  const targetRepoId = effectiveRepoId || available[0]?.id || "";
  const branches = useBranches(open ? targetRepoId || null : null);
  const freeBranches = branches.data?.filter((b) => !b.worktreeId) ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createWorktree(targetRepoId, {
        branch: branch.trim(),
        ...(mode === "new" ? { baseRef: baseRef.trim() || "HEAD" } : {}),
      });
      invalidate.worktrees(targetRepoId);
      invalidate.branches();
      await api.setFocus(created.id);
      setBranch("");
      setBaseRef("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Worktree creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New worktree" open={open} onClose={onClose}>
      <p className="dialog-hint">
        Grows a new tree in the forest and takes you to it. Prompt the dryad once you're there.
      </p>

      <div className="seg">
        <button
          type="button"
          className={mode === "new" ? "seg-on" : ""}
          onClick={() => setMode("new")}
          data-tip="Create a branch and check it out in the new worktree"
        >
          New branch
        </button>
        <button
          type="button"
          className={mode === "existing" ? "seg-on" : ""}
          onClick={() => setMode("existing")}
          data-tip="Check out a branch that has no worktree yet"
        >
          Existing branch
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!repo && (
          <label className="field">
            Repository
            <select
              value={targetRepoId}
              onChange={(e) => setRepoId(e.target.value)}
              data-tip="Repository the worktree is created in"
            >
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "new" ? (
          <>
            <label className="field">
              Branch name
              <input
                autoFocus
                className="mono-input"
                placeholder="feature/night-mode"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                data-tip="Name for the branch this worktree will create"
              />
            </label>
            <label className="field">
              Base ref <span className="field-hint">(default: HEAD)</span>
              <input
                className="mono-input"
                placeholder="main"
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                data-tip="Branch or commit the new branch starts from"
              />
            </label>
          </>
        ) : (
          <label className="field">
            Branch
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              data-tip="Existing branch to check out here"
            >
              <option value="">Choose a branch…</option>
              {freeBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
            {freeBranches.length === 0 && !branches.isLoading && (
              <span className="field-hint">Every branch is already checked out in a worktree.</span>
            )}
          </label>
        )}

        {error && (
          <div className="form-error" data-tip="Git wouldn't create the worktree">
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="btn-quiet"
            onClick={onClose}
            data-tip="Close without creating a worktree"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !branch.trim() || !targetRepoId}
            data-tip={
              branch.trim() ? "Create the worktree and open it" : "Name a branch first"
            }
          >
            {busy ? "Growing…" : "Create worktree"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
