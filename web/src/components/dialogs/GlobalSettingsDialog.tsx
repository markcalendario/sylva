import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AgentSettings, AppPreferences } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { AudioControls } from "../AudioControls";
import { Dialog } from "../Dialog";
import { TextSize } from "../TextSize";
import { BypassWarning, EffortField, ModelField, PermissionField } from "./settingsFields";
import { OpenTargetField, SavedPromptsField } from "./PreferenceFields";

/** Defaults every worktree inherits unless it overrides them. */
export function GlobalSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [savedPrefs, setSavedPrefs] = useState<AppPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setError(null);
    void api.globalSettings().then((s) => {
      setSettings(s);
      setSaved(s);
    });
    void api.preferences().then((p) => {
      setPrefs(p);
      setSavedPrefs(p);
    });
  }, [open]);

  if (!settings || !saved || !prefs || !savedPrefs) {
    return (
      <Dialog title="Settings" open={open} onClose={onClose}>
        <p className="dialog-hint">Loading…</p>
      </Dialog>
    );
  }

  const dirty =
    settings.model !== saved.model ||
    settings.effort !== saved.effort ||
    settings.bypassPermissions !== saved.bypassPermissions ||
    JSON.stringify(prefs) !== JSON.stringify(savedPrefs);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const [next, nextPrefs] = await Promise.all([
        api.setGlobalSettings(settings),
        api.setPreferences(prefs),
      ]);
      setSettings(next);
      setSaved(next);
      setPrefs(nextPrefs);
      setSavedPrefs(nextPrefs);
      // The Open button and the saved-prompts menu read this query.
      void qc.invalidateQueries({ queryKey: ["preferences"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Settings" open={open} onClose={onClose}>
      <section className="settings-section">
        <h3 className="settings-heading" data-tip="How Sylva looks on this machine">
          Appearance
        </h3>
        <div className="field">
          <span data-tip="Scales every piece of text in Sylva">Text size</span>
          <div className="settings-control">
            <TextSize />
          </div>
          <span className="field-hint">
            Scales every piece of text in Sylva. Saved to this browser; applies as you change it.
          </span>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading" data-tip="Cues Sylva plays as agents work">
          Sound
        </h3>
        <div className="field">
          <span data-tip="How loud cues play, and the background forest bed">
            Volume and ambience
          </span>
          <div className="settings-control">
            <AudioControls />
          </div>
          <span className="field-hint">
            Chimes when an agent finishes, a firmer cue when one needs your approval, and blips for
            commits and prompts. ♪ plays a forest ambience — wind, a low pad, the occasional
            cricket.
          </span>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading" data-tip="How Sylva connects to the rest of your tools">
          Workflow
        </h3>
        <OpenTargetField value={prefs} onChange={setPrefs} />
        <SavedPromptsField value={prefs} onChange={setPrefs} />
      </section>

      <section className="settings-section">
        <h3
          className="settings-heading"
          data-tip="Fallback settings for every worktree that doesn't set its own"
        >
          Agent defaults
        </h3>
        <p className="dialog-hint">
          Defaults for every worktree. A worktree that sets its own value keeps it — these only
          fill in the rest.
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
      </section>

      <div className="dialog-actions">
        <button
          type="button"
          className="btn-quiet"
          onClick={onClose}
          disabled={busy}
          data-tip={dirty ? "Discard your unsaved agent defaults" : "Close settings"}
        >
          {dirty ? "Cancel" : "Close"}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
          data-tip={
            dirty
              ? "Save these defaults for every worktree"
              : "Nothing to save — appearance and sound apply instantly"
          }
        >
          {busy ? "Saving…" : "Save agent defaults"}
        </button>
      </div>
    </Dialog>
  );
}
