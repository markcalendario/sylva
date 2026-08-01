import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Switches the worktree's agent between asking for permission and skipping
 * every check. Flipping it restarts the session (the SDK fixes permission mode
 * at start), which the copy says plainly.
 */
export function PermissionToggle({ worktreeId }: { worktreeId: string }) {
  const [bypass, setBypass] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.prefs(worktreeId).then((p) => {
      if (!cancelled) setBypass(p.bypassPermissions);
    });
    return () => {
      cancelled = true;
    };
  }, [worktreeId]);

  const toggle = async () => {
    const next = !bypass;
    if (
      next &&
      !confirm(
        "Skip all permission checks?\n\nThe dryad will run any command — including deleting files " +
          "and pushing — without asking you first. Only do this in a worktree you're willing to lose.\n\n" +
          "This restarts the session; the conversation carries over.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const saved = await api.setPrefs(worktreeId, { bypassPermissions: next });
      setBypass(saved.bypassPermissions);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`permtoggle ${bypass ? "permtoggle-on" : ""}`}
      onClick={() => void toggle()}
      disabled={busy}
      role="switch"
      aria-checked={bypass}
      title={
        bypass
          ? "Permission checks are off — the dryad runs anything without asking. Click to start asking again."
          : "The dryad asks before running commands. Click to skip all permission checks."
      }
    >
      <span className="permtoggle-track">
        <span className="permtoggle-thumb" />
      </span>
      {bypass ? "skipping permissions" : "asks permission"}
    </button>
  );
}
