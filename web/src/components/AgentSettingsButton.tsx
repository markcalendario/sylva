import { useEffect, useState } from "react";
import type { WorktreePrefs } from "sylva-shared";
import { api } from "../lib/api";
import { AgentSettingsDialog } from "./dialogs/AgentSettingsDialog";

/**
 * Compact summary of this worktree's agent settings, and the way in to change
 * them. Shows what's actually in effect rather than a generic gear.
 */
export function AgentSettingsButton({ worktreeId }: { worktreeId: string }) {
  const [prefs, setPrefs] = useState<WorktreePrefs | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => {
    void api.prefs(worktreeId).then(setPrefs);
  };

  useEffect(load, [worktreeId]);

  const model = prefs?.model?.replace(/^claude-/, "") ?? "default";
  const effort = prefs?.effort ?? "default";

  return (
    <>
      <button
        className={`agent-settings ${prefs?.bypassPermissions ? "agent-settings-danger" : ""}`}
        onClick={() => setOpen(true)}
        title="Agent settings for this worktree"
      >
        <span className="agent-settings-icon">⚙</span>
        <span className="agent-settings-summary">
          {model} · {effort}
          {prefs?.bypassPermissions && <span className="agent-settings-warn"> · unrestricted</span>}
        </span>
      </button>
      <AgentSettingsDialog
        worktreeId={worktreeId}
        open={open}
        onClose={() => {
          setOpen(false);
          load();
        }}
      />
    </>
  );
}
