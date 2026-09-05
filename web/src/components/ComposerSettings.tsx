import { useEffect, useState } from "react";
import { Bot, Gauge, Lock, LockOpen, ShieldCheck } from "lucide-react";
import {
  EFFORT_LEVELS,
  MODEL_CHOICES,
  type EffortLevel,
  type PermissionMode,
  type WorktreeOverrides,
  type WorktreeSettings,
} from "sylva-shared";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useWords } from "../lib/theme";

/** What "don't set this here" is worth as a select value. */
const INHERIT = "";

const MODE_LABEL: Record<PermissionMode, string> = {
  supervised: "Supervised",
  acceptEdits: "Auto-accept edits",
  full: "Full access",
};

const MODE_HINT: Record<PermissionMode, string> = {
  supervised: "Asks before commands and before file changes",
  acceptEdits: "Writes files freely; asks before running anything",
  full: "Runs anything without asking",
};

/**
 * Model, effort and permissions, on the composer.
 *
 * All three already lived in a dialog behind a gear, which is the right place
 * for a setting you choose once and the wrong place for these: which model is
 * answering and how much it is allowed to do are things you change *because of
 * what you are about to type*. A cheap model for a rename, full access for a
 * long refactor you're going to walk away from — decisions made with the
 * prompt half-written, and a dialog is a round trip away from that.
 *
 * They write per-worktree overrides. The blank option in each is "inherit",
 * and it is labelled with the value being inherited — so the row always reads
 * as what is in effect rather than as where it came from, which is the
 * question you are actually asking with a prompt half-typed.
 *
 * This replaced a gear beside the Clear button that opened a dialog saying the
 * same three things. Two controls for one set of values is one too many: they
 * disagreed the moment either was changed while the other was open.
 */
export function ComposerSettings({ worktreeId }: { worktreeId: string }) {
  const words = useWords();
  const [settings, setSettings] = useState<WorktreeSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api.worktreeSettings(worktreeId).then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, [worktreeId]);

  if (!settings) return null;

  const { effective, overrides } = settings;

  const save = async (patch: WorktreeOverrides) => {
    setBusy(true);
    try {
      setSettings(await api.setWorktreeOverrides(worktreeId, { ...overrides, ...patch }));
    } catch {
      // The dialog behind the gear reports failures properly; a select that
      // silently snaps back is the honest thing for a control this small.
      setSettings(await api.worktreeSettings(worktreeId));
    } finally {
      setBusy(false);
    }
  };

  /** Absent rather than null: an absent key is how "inherit" is spelled. */
  const drop = async (key: keyof WorktreeOverrides) => {
    const next = { ...overrides };
    delete next[key];
    setBusy(true);
    try {
      setSettings(await api.setWorktreeOverrides(worktreeId, next));
    } finally {
      setBusy(false);
    }
  };

  const onMode = async (value: string) => {
    if (value === INHERIT) {
      await drop("permissionMode");
      return;
    }
    const mode = value as PermissionMode;
    if (mode === "full" && effective.permissionMode !== "full") {
      const ok = await confirm({
        title: "Give it full access?",
        body: `The ${words.agent} stops asking before it acts in this worktree. It will run any command it decides on, including deleting files and pushing to your remote — and the shell it runs in can reach your whole machine.`,
        confirmLabel: "Allow everything",
        tone: "danger",
      });
      if (!ok) return;
    }
    await save({ permissionMode: mode });
  };

  const ModeIcon =
    effective.permissionMode === "full"
      ? LockOpen
      : effective.permissionMode === "supervised"
        ? Lock
        : ShieldCheck;

  return (
    <div className="composer-settings">
      <label
        className="composer-pick"
        data-tip="Model this worktree's agent answers with. Blank follows the global default."
      >
        <Bot size={12} />
        <select
          value={overrides.model ?? INHERIT}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            void (value === INHERIT ? drop("model") : save({ model: value }));
          }}
          aria-label="Model"
        >
          <option value={INHERIT}>
            {MODEL_CHOICES.find((m) => m.id === effective.model)?.label ?? "Default model"}
          </option>
          {MODEL_CHOICES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="composer-pick"
        data-tip="How hard it thinks before answering. Blank follows the global default."
      >
        <Gauge size={12} />
        <select
          value={overrides.effort ?? INHERIT}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            void (value === INHERIT ? drop("effort") : save({ effort: value as EffortLevel }));
          }}
          aria-label="Effort"
        >
          <option value={INHERIT}>{effective.effort ?? "Default effort"}</option>
          {EFFORT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>

      <label
        className={`composer-pick ${
          effective.permissionMode === "full" ? "composer-pick-danger" : ""
        }`}
        data-tip={MODE_HINT[effective.permissionMode]}
      >
        <ModeIcon size={12} />
        <select
          value={overrides.permissionMode ?? INHERIT}
          disabled={busy}
          onChange={(e) => void onMode(e.target.value)}
          aria-label="Permissions"
        >
          <option value={INHERIT}>{MODE_LABEL[effective.permissionMode]}</option>
          {(Object.keys(MODE_LABEL) as PermissionMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
