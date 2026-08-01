import { useState } from "react";
import type { OpenKind } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { usePreferences } from "../lib/queries";

const LABEL: Record<OpenKind, string> = { editor: "⌨ Code", terminal: "❯ Shell" };
const TIP: Record<OpenKind, string> = {
  editor: "Open this worktree in your editor — pick which one in Settings",
  terminal: "Open a terminal in this worktree — pick which one in Settings",
};

/**
 * Hands the worktree directory to an external application. Two buttons rather
 * than one: opening the code and opening a shell are different intentions, and
 * having to visit Settings to switch between them made both worse.
 */
export function OpenExternallyButtons({ worktreeId }: { worktreeId: string }) {
  const prefs = usePreferences();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<OpenKind | null>(null);

  const open = async (kind: OpenKind) => {
    setBusy(kind);
    setError(null);
    try {
      await api.openExternally(worktreeId, kind);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open this worktree");
    } finally {
      setBusy(null);
    }
  };

  const kinds: OpenKind[] = [];
  if ((prefs.data?.editorTarget ?? "vscode") !== "none") kinds.push("editor");
  if ((prefs.data?.terminalTarget ?? "terminal") !== "none") kinds.push("terminal");
  if (kinds.length === 0) return null;

  return (
    <div className="wt-launch-group">
      {kinds.map((kind) => (
        <button
          key={kind}
          className="btn-quiet wt-launch"
          onClick={() => void open(kind)}
          disabled={busy !== null}
          data-tip={TIP[kind]}
        >
          {LABEL[kind]}
        </button>
      ))}
      {error && (
        <span className="wt-launch-error" role="alert" data-tip="Check the Open targets in Settings">
          {error}
        </span>
      )}
    </div>
  );
}
