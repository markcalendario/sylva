import { useState } from "react";
import { api, ApiFailure } from "../../lib/api";
import { ensureNotifyPermission } from "../../lib/notify";
import { useInvalidate, useRepos } from "../../lib/queries";
import { Dialog } from "../Dialog";

/** One step from idea to a dryad working on it: worktree + agent in one go. */
export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const repos = useRepos();
  const invalidate = useInvalidate();
  const [repoId, setRepoId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const available = repos.data?.filter((r) => r.available) ?? [];
  const effectiveRepoId = repoId || available[0]?.id || "";

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    ensureNotifyPermission();
    try {
      const result = await api.quickStart({
        repoId: effectiveRepoId,
        taskName: taskName.trim(),
        prompt: prompt.trim(),
        ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
      });
      invalidate.worktrees();
      if (result.errors.length > 0) {
        setErrors(result.errors);
        if (result.worktree) {
          setErrors((e) => [...e, `The worktree "${result.worktree?.branch}" was created and is usable.`]);
        }
      } else {
        setTaskName("");
        setPrompt("");
        onClose();
      }
    } catch (e) {
      setErrors([e instanceof ApiFailure ? (e.detail ?? e.message) : "Quick start failed"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New task" open={open} onClose={onClose}>
      <p className="dialog-hint">
        Names a branch, grows a worktree, and sets a dryad working — one step.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          Repository
          <select value={effectiveRepoId} onChange={(e) => setRepoId(e.target.value)}>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Task name
          <input
            autoFocus
            placeholder="Add night mode"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
          />
        </label>
        <label className="field">
          What should the agent do?
          <textarea
            rows={4}
            placeholder="Add a dark theme toggle to the settings page…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
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
        {errors.map((err, i) => (
          <div key={i} className="form-error">
            {err}
          </div>
        ))}
        <div className="dialog-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !effectiveRepoId || !taskName.trim() || !prompt.trim()}
          >
            {busy ? "Planting…" : "Start task"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
