import { useEffect, useState } from "react";
import { EFFORT_LEVELS, MODEL_CHOICES, type WorktreePrefs } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { Dialog } from "../Dialog";

const EFFORT_NOTES: Record<string, string> = {
  low: "Fast and cheap; fine for scoped edits",
  medium: "Balanced",
  high: "Deep reasoning (Claude Code's default)",
  xhigh: "Best for hard coding and agentic work",
  max: "Maximum effort; slowest and priciest",
};

/**
 * Per-worktree agent settings. Every field here is fixed when the SDK session
 * starts, so saving a change restarts the session — the dialog says so, and the
 * conversation is preserved by resuming on the SDK session id.
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
  const [prefs, setPrefs] = useState<WorktreePrefs | null>(null);
  const [saved, setSaved] = useState<WorktreePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingBypass, setConfirmingBypass] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void api.prefs(worktreeId).then((p) => {
      setPrefs(p);
      setSaved(p);
    });
  }, [open, worktreeId]);

  if (!prefs || !saved) {
    return (
      <Dialog title="Agent settings" open={open} onClose={onClose}>
        <p className="dialog-hint">Loading…</p>
      </Dialog>
    );
  }

  // Every field here is baked into the SDK query at start, so any change
  // restarts the session — there is no subset that applies in place.
  const dirty =
    prefs.model !== saved.model ||
    prefs.effort !== saved.effort ||
    prefs.bypassPermissions !== saved.bypassPermissions;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.setPrefs(worktreeId, prefs);
      setPrefs(next);
      setSaved(next);
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Agent settings" open={open} onClose={onClose}>
      <p className="dialog-hint">
        Applies to the dryad in this worktree only. Other trees keep their own settings.
      </p>

      <label className="field">
        Model
        <select
          value={prefs.model ?? ""}
          onChange={(e) => setPrefs({ ...prefs, model: e.target.value || null })}
        >
          <option value="">Claude Code default</option>
          {MODEL_CHOICES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.note}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Effort
        <select
          value={prefs.effort ?? ""}
          onChange={(e) =>
            setPrefs({ ...prefs, effort: (e.target.value || null) as WorktreePrefs["effort"] })
          }
        >
          <option value="">Claude Code default</option>
          {EFFORT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level} — {EFFORT_NOTES[level]}
            </option>
          ))}
        </select>
        <span className="field-hint">
          How much thinking the dryad does before acting. Higher costs more and takes longer.
        </span>
      </label>

      <div className="field">
        Permissions
        <button
          type="button"
          className={`permtoggle ${prefs.bypassPermissions ? "permtoggle-on" : ""}`}
          role="switch"
          aria-checked={prefs.bypassPermissions}
          onClick={() => {
            if (prefs.bypassPermissions) setPrefs({ ...prefs, bypassPermissions: false });
            else setConfirmingBypass(true);
          }}
        >
          <span className="permtoggle-track">
            <span className="permtoggle-thumb" />
          </span>
          {prefs.bypassPermissions ? "skipping permissions" : "asks permission"}
        </button>
        {prefs.bypassPermissions && (
          <span className="field-hint field-hint-danger">
            The dryad runs any command — deletes, history rewrites, pushes — without asking.
          </span>
        )}
      </div>

      {confirmingBypass && (
        <div className="force-warning">
          <span className="pixel-label">skip all permission checks?</span>
          <p>
            The dryad stops asking before it acts in this worktree. It will run any command it
            decides on, including deleting files and pushing to your remote. Nothing outside this
            worktree is protected either — the shell can reach your whole machine. Only worth it in
            a worktree you'd be comfortable throwing away.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn-quiet" onClick={() => setConfirmingBypass(false)}>
              Keep asking
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                setPrefs({ ...prefs, bypassPermissions: true });
                setConfirmingBypass(false);
              }}
            >
              Skip permissions
            </button>
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {dirty && (
        <p className="dialog-hint">
          Saving restarts this worktree's session so the new settings take effect. The conversation
          carries over.
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
