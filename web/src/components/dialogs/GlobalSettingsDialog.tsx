import { useEffect, useState } from "react";
import type { AgentSettings } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { Dialog } from "../Dialog";
import { BypassWarning, EffortField, ModelField, PermissionField } from "./settingsFields";

/** Defaults every worktree inherits unless it overrides them. */
export function GlobalSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void api.globalSettings().then((s) => {
      setSettings(s);
      setSaved(s);
    });
  }, [open]);

  if (!settings || !saved) {
    return (
      <Dialog title="Global settings" open={open} onClose={onClose}>
        <p className="dialog-hint">Loading…</p>
      </Dialog>
    );
  }

  const dirty =
    settings.model !== saved.model ||
    settings.effort !== saved.effort ||
    settings.bypassPermissions !== saved.bypassPermissions;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.setGlobalSettings(settings);
      setSettings(next);
      setSaved(next);
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Global settings" open={open} onClose={onClose}>
      <p className="dialog-hint">
        Defaults for every worktree. A worktree that sets its own value keeps it — these only fill
        in the rest.
      </p>

      <ModelField
        value={settings.model}
        onChange={(model) => setSettings({ ...settings, model: model as string | null })}
      />
      <EffortField
        value={settings.effort}
        onChange={(effort) =>
          setSettings({ ...settings, effort: effort as AgentSettings["effort"] })
        }
      />
      <PermissionField
        value={settings.bypassPermissions}
        onChange={(v) => setSettings({ ...settings, bypassPermissions: v === true })}
        onRequestBypass={() => setConfirming(true)}
      />

      {confirming && (
        <BypassWarning
          scope="in every worktree that hasn't set its own permission mode"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setSettings({ ...settings, bypassPermissions: true });
            setConfirming(false);
          }}
        />
      )}

      {error && <div className="form-error">{error}</div>}

      {dirty && (
        <p className="dialog-hint">
          Saving restarts any running session that inherits a changed value. Conversations carry
          over.
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </Dialog>
  );
}
