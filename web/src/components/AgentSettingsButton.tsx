import { useEffect, useState } from "react";
import type { WorktreeSettings } from "sylva-shared";
import { api } from "../lib/api";
import { AgentSettingsDialog } from "./dialogs/AgentSettingsDialog";
import { summarize } from "./dialogs/settingsFields";

/**
 * Compact summary of this worktree's agent settings, and the way in to change
 * them. Shows what's actually in effect rather than a generic gear.
 */
export function AgentSettingsButton({ worktreeId }: { worktreeId: string }) {
  const [settings, setSettings] = useState<WorktreeSettings | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => {
    void api.worktreeSettings(worktreeId).then(setSettings);
  };

  useEffect(load, [worktreeId]);

  const effective = settings?.effective;
  const overridden = Object.keys(settings?.overrides ?? {}).length > 0;

  return (
    <>
      <button
        className={`agent-settings ${effective?.bypassPermissions ? "agent-settings-danger" : ""}`}
        onClick={() => setOpen(true)}
        title={
          overridden
            ? "Agent settings — this worktree overrides the global defaults"
            : "Agent settings — inheriting the global defaults"
        }
      >
        <span className="agent-settings-icon">⚙</span>
        <span className="agent-settings-summary">
          {effective ? summarize(effective) : "…"}
          {overridden && <span className="agent-settings-override"> ·</span>}
          {effective?.bypassPermissions && (
            <span className="agent-settings-warn"> · unrestricted</span>
          )}
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
