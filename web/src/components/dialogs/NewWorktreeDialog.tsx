import { useState } from "react";
import type { Repo } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { useBranches } from "../../lib/queries";
import { Dialog } from "../Dialog";

export function NewWorktreeDialog({
  repo,
  open,
  onClose,
}: {
  repo: Repo;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const branches = useBranches(open ? repo.id : null);

  const freeBranches = branches.data?.filter((b) => !b.worktreeId) ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createWorktree(repo.id, {
        branch: branch.trim(),
        ...(mode === "new" ? { baseRef: baseRef.trim() || "HEAD" } : {}),
      });
      setBranch("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Worktree creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`New worktree in ${repo.name}`} open={open} onClose={onClose}>
      <div className="seg">
        <button
          className={mode === "new" ? "seg-on" : ""}
          onClick={() => setMode("new")}
          type="button"
        >
          New branch
        </button>
        <button
          className={mode === "existing" ? "seg-on" : ""}
          onClick={() => setMode("existing")}
          type="button"
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
              />
            </label>
            <label className="field">
              Base ref <span className="field-hint">(default: HEAD)</span>
              <input
                className="mono-input"
                placeholder="main"
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="field">
            Branch
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Choose a branch…</option>
              {freeBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !branch.trim()}>
            {busy ? "Growing…" : "Create worktree"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
