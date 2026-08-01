import { useEffect, useState } from "react";
import type { EffortLevel, WorktreeOverrides, WorktreeSettings } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { Dialog } from "../Dialog";
import {
  BypassWarning,
  EffortField,
  INHERIT,
  ModelField,
  PermissionField,
  modelLabel,
} from "./settingsFields";

/**
 * Per-worktree overrides. Each field defaults to inheriting the global value;
 * choosing anything else pins it for this worktree alone.
 */
export function AgentSettingsDialog({
  worktreeId,
  open,
  onClose,
}: {
  worktreeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<WorktreeSettings | null>(null);
  const [draft, setDraft] = useState<WorktreeOverrides>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void api.worktreeSettings(worktreeId).then((s) => {
      setSettings(s);
      setDraft(s.overrides);
    });
  }, [open, worktreeId]);

  if (!settings) {
    return (
      <Dialog title="Worktree settings" open={open} onClose={onClose}>
        <p className="dialog-hint">Loading…</p>
      </Dialog>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.overrides);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.setWorktreeOverrides(worktreeId, draft);
      setSettings(next);
      setDraft(next.overrides);
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  const setKey = <K extends keyof WorktreeOverrides>(
    key: K,
    value: WorktreeOverrides[K] | typeof INHERIT,
  ) => {
    const next = { ...draft };
    if (value === INHERIT) delete next[key];
    else next[key] = value;
    setDraft(next);
  };

  return (
    <Dialog title="Worktree settings" open={open} onClose={onClose}>
      <p className="dialog-hint">
        Applies to this worktree only. Anything left on “inherit” follows the global settings.
      </p>

      <ModelField
        value={"model" in draft ? (draft.model ?? null) : INHERIT}
        onChange={(v) => setKey("model", v as string | null | typeof INHERIT)}
        inheritLabel={`Inherit global — ${modelLabel(settings.global.model)}`}
      />
      <EffortField
        value={"effort" in draft ? (draft.effort ?? null) : INHERIT}
        onChange={(v) => setKey("effort", v as EffortLevel | null | typeof INHERIT)}
        inheritLabel={`Inherit global — ${settings.global.effort ?? "Claude Code default"}`}
      />
      <PermissionField
        value={"bypassPermissions" in draft ? Boolean(draft.bypassPermissions) : INHERIT}
        onChange={(v) => setKey("bypassPermissions", v as boolean | typeof INHERIT)}
        onRequestBypass={() => setConfirming(true)}
        inheritLabel={`Inherit global — ${
          settings.global.bypassPermissions ? "skipping permissions" : "asks permission"
        }`}
      />

      {confirming && (
        <BypassWarning
          scope="in this worktree"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setKey("bypassPermissions", true);
            setConfirming(false);
          }}
        />
      )}

      {error && <div className="form-error">{error}</div>}

      {dirty && (
        <p className="dialog-hint">
          Saving restarts this worktree's session so the new settings take effect. The conversation
          carries over.
        </p>
      )}

      <div className="dialog-actions">
        <button
          type="button"
          className="btn-quiet"
          onClick={onClose}
          disabled={busy}
          data-tip="Close without saving these overrides"
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
          data-tip={
            dirty
              ? "Save these overrides and restart this worktree's session"
              : "Nothing has changed yet"
          }
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </Dialog>
  );
}
