import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AgentSettings, AppPreferences, Repo } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useInvalidate, useRepos } from "../lib/queries";
import { useSylva } from "../state/store";
import { AudioControls } from "./AudioControls";
import { TextSize } from "./TextSize";
import { BypassWarning, EffortField, ModelField, PermissionField } from "./dialogs/settingsFields";
import { OpenTargetField, SavedPromptsField, TerminalShellField } from "./dialogs/PreferenceFields";

const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "sound", label: "Sound" },
  { id: "workflow", label: "Workflow" },
  { id: "terminal", label: "Terminal" },
  { id: "agent", label: "Agent defaults" },
  { id: "repos", label: "Repositories" },
  { id: "about", label: "About" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Settings as a page rather than a modal. It had grown four sections deep, and
 * a modal is for a decision — not for configuration you scroll through with a
 * rail down the side.
 */
export function SettingsPage({
  onAbout,
  onRegister,
}: {
  onAbout: () => void;
  onRegister: () => void;
}) {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [savedPrefs, setSavedPrefs] = useState<AppPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [current, setCurrent] = useState<SectionId>("appearance");
  const scrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    void api.globalSettings().then((s) => {
      setSettings(s);
      setSaved(s);
    });
    void api.preferences().then((p) => {
      setPrefs(p);
      setSavedPrefs(p);
    });
  }, []);

  const dirty =
    !!settings &&
    !!saved &&
    !!prefs &&
    !!savedPrefs &&
    (settings.model !== saved.model ||
      settings.effort !== saved.effort ||
      settings.bypassPermissions !== saved.bypassPermissions ||
      JSON.stringify(prefs) !== JSON.stringify(savedPrefs));

  // Leaving with unsaved edits is almost always a mis-click, so it asks.
  const leave = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard your unsaved settings?",
        body: "You've changed settings that haven't been saved yet. Leaving now throws those changes away.",
        confirmLabel: "Discard them",
        cancelLabel: "Stay here",
        tone: "danger",
      });
      if (!ok) return;
    }
    useSylva.getState().setView("workspace");
  };

  const save = async () => {
    if (!settings || !prefs) return;
    setBusy(true);
    setError(null);
    try {
      const [nextSettings, nextPrefs] = await Promise.all([
        api.setGlobalSettings(settings),
        api.setPreferences(prefs),
      ]);
      setSettings(nextSettings);
      setSaved(nextSettings);
      setPrefs(nextPrefs);
      setSavedPrefs(nextPrefs);
      // The Open buttons and the saved-prompts menu read this query.
      void qc.invalidateQueries({ queryKey: ["preferences"] });
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  const jumpTo = (id: SectionId) => {
    setCurrent(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!settings || !prefs) {
    return <div className="settings-page-loading">Opening the settings…</div>;
  }

  return (
    <div className="settings-page">
      <aside className="settings-rail">
        <div className="pixel-label" data-tip="Everything Sylva lets you change">
          settings
        </div>
        <nav>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              className={`settings-rail-item ${current === section.id ? "settings-rail-on" : ""}`}
              onClick={() => jumpTo(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <button className="btn-quiet" onClick={() => void leave()} data-tip="Back to your worktrees">
          ← Done
        </button>
      </aside>

      <div className="settings-body" ref={scrollRef}>
        <section className="settings-section" id="settings-appearance">
          <h3 className="settings-heading">Appearance</h3>
          <div className="field">
            <span data-tip="Scales every piece of text in Sylva">Text size</span>
            <div className="settings-control">
              <TextSize />
            </div>
            <span className="field-hint">
              Saved to this browser, and applied as you change it.
            </span>
          </div>
        </section>

        <section className="settings-section" id="settings-sound">
          <h3 className="settings-heading">Sound</h3>
          <div className="field">
            <span data-tip="How loud cues play, and the background forest bed">
              Volume and ambience
            </span>
            <div className="settings-control">
              <AudioControls />
            </div>
            <span className="field-hint">
              Chimes when an agent finishes, a firmer cue when one needs your approval, and blips
              for commits and prompts. ♪ plays a forest ambience — wind, a low pad, the occasional
              cricket.
            </span>
          </div>
        </section>

        <section className="settings-section" id="settings-workflow">
          <h3 className="settings-heading">Workflow</h3>
          <OpenTargetField value={prefs} onChange={setPrefs} />
          <SavedPromptsField value={prefs} onChange={setPrefs} />
        </section>

        <section className="settings-section" id="settings-terminal">
          <h3 className="settings-heading">Terminal</h3>
          <TerminalShellField value={prefs} onChange={setPrefs} />
        </section>

        <section className="settings-section" id="settings-agent">
          <h3 className="settings-heading">Agent defaults</h3>
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
          {dirty && (
            <p className="dialog-hint">
              Saving restarts any running session that inherits a changed value. Conversations
              carry over.
            </p>
          )}
        </section>

        <section className="settings-section" id="settings-repos">
          <h3 className="settings-heading">Repositories</h3>
          <ReposSection onRegister={onRegister} />
        </section>

        <section className="settings-section" id="settings-about">
          <h3 className="settings-heading">About</h3>
          <p className="dialog-hint">
            Sylva runs entirely on this machine. It talks to git through the real CLI and to Claude
            through the Agent SDK, using the credentials Claude Code already stores.
          </p>
          <div className="settings-control">
            <button className="btn-quiet" onClick={onAbout} data-tip="What Sylva is, and who built it">
              About Sylva
            </button>
          </div>
        </section>
      </div>

      {/* Saving is a page-level action, so it lives at the page level rather
          than repeated inside whichever section happens to be dirty. */}
      <div className={`settings-save ${dirty ? "settings-save-on" : ""}`}>
        {error && <div className="form-error">{error}</div>}
        <span className="settings-save-note">
          {dirty ? "You have unsaved changes." : "Everything is saved."}
        </span>
        <button
          className="btn-primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
          data-tip={dirty ? "Save these settings" : "Nothing to save"}
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

/** Registered repositories, with room to add and remove them. */
function ReposSection({ onRegister }: { onRegister: () => void }) {
  const repos = useRepos();
  const invalidate = useInvalidate();

  const forget = async (repo: Repo) => {
    const ok = await confirm({
      title: `Forget ${repo.name}?`,
      body: "Sylva stops tracking this repository. The folder on disk, its branches and its worktrees are all left exactly as they are.",
      confirmLabel: "Forget it",
      tone: "danger",
    });
    if (ok) await api.removeRepo(repo.id).then(() => invalidate.repos());
  };

  return (
    <div className="field">
      <ul className="settings-repo-list">
        {(repos.data ?? []).length === 0 && (
          <li className="field-hint">No repositories registered yet.</li>
        )}
        {(repos.data ?? []).map((repo) => (
          <li key={repo.id} className="settings-repo-row">
            <span className="settings-repo-name">
              {repo.name}
              {!repo.available && (
                <span className="repo-missing" data-tip="Sylva can't find this repository on disk">
                  missing
                </span>
              )}
            </span>
            <code className="settings-repo-path">{repo.path}</code>
            <button
              className="ghost"
              onClick={() => void forget(repo)}
              aria-label={`Forget ${repo.name}`}
              data-tip="Stop tracking this repository; the folder is untouched"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="settings-control">
        <button
          className="btn-quiet"
          onClick={onRegister}
          data-tip="Register an existing repository, or start a new one"
        >
          + Add a repository
        </button>
      </div>
    </div>
  );
}
