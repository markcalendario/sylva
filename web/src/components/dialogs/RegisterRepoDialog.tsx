import { useState } from "react";
import { api, ApiFailure } from "../../lib/api";
import { Dialog } from "../Dialog";

export function RegisterRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.registerRepo(path.trim());
      setPath("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Register a repository" open={open} onClose={onClose}>
      <p className="dialog-hint">Absolute path to a git repository on this machine.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          autoFocus
          className="mono-input"
          placeholder="/Users/you/code/my-project"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !path.trim()}>
            {busy ? "Checking…" : "Register"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
