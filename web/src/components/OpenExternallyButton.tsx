import { useState } from "react";
import { api, ApiFailure } from "../lib/api";
import { usePreferences } from "../lib/queries";

/**
 * Hands the worktree directory to whatever the user configured — an editor, a
 * terminal, the file manager. Sylva can tell you a file changed; without this
 * it can't help you go and look at it.
 */
export function OpenExternallyButton({ worktreeId }: { worktreeId: string }) {
  const prefs = usePreferences();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = prefs.data?.openTarget ?? "vscode";
  if (target === "none") return null;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.openExternally(worktreeId);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open this worktree");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn-quiet wt-open"
        onClick={() => void open()}
        disabled={busy}
        data-tip={`Open this worktree — change the target in Settings`}
      >
        ↗ Open
      </button>
      {error && (
        <div className="wt-open-error" role="alert" data-tip="Check the Open target in Settings">
          {error}
        </div>
      )}
    </>
  );
}
