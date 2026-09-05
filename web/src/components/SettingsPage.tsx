import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  FolderGit2,
  Info,
  SquareTerminal,
  Trees,
  Type,
  Volume2,
} from "lucide-react";
import type { AgentSettings, AppPreferences, Repo } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { confirm } from "../lib/confirm";
import { applyMotion, CHAT_MOTIONS, MOTION_LABEL, MOTION_TIP, useChatMotion } from "../lib/motion";
import { useInvalidate, useRepos } from "../lib/queries";
import { useTheme, useWords } from "../lib/theme";
import { useSylva } from "../state/store";
import { AudioControls } from "./AudioControls";
import { TextSize } from "./TextSize";
import { ThemePicker } from "./ThemePicker";
import {
  BypassWarning,
  EffortField,
  INHERIT,
  ModelField,
  PermissionField,
} from "./dialogs/settingsFields";
import {
  CopyEnvFilesField,
  TerminalAppField,
  TerminalScrollbackField,
  TerminalShellField,
} from "./dialogs/PreferenceFields";

/**
 * The page's own table of contents.
 *
 * Each section carries the one line that says what it is for, because a heading
 * alone makes you open a section to find out whether it holds what you came
 * for — and the icon is what makes the rail scannable rather than read.
 */
const SECTIONS = [
  {
    id: "appearance",
    label: "Appearance",
    icon: Type,
    note: "How Sylva looks on this screen.",
  },
  {
    id: "sound",
    label: "Sound",
    icon: Volume2,
    note: "What Sylva says out loud when something happens.",
  },
  {
    id: "worktrees",
    label: "Worktrees",
    icon: Trees,
    note: "What a newly grown worktree gets beyond the files git checks out.",
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    note: "The shells the Terminal tab opens, how much they remember, and where a worktree goes when you want a window of its own.",
  },
  {
    id: "agent",
    label: "Agent defaults",
    icon: Bot,
    note: "Where every session starts. One that sets its own value keeps it — these fill in the rest.",
  },
  {
    id: "repos",
    label: "Repositories",
    icon: FolderGit2,
    note: "The repositories Sylva knows about.",
  },
  {
    id: "about",
    label: "About",
    icon: Info,
    note: "What this is, and where it keeps things.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** One section: its heading, the line under it, and whatever it holds. */
function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) return null;
  const Icon = section.icon;
  return (
    <section className="settings-card" id={`settings-${id}`}>
      <header className="settings-card-head">
        <span className="settings-card-icon" aria-hidden>
          <Icon size={15} />
        </span>
        <div className="settings-card-title">
          <h3>{section.label}</h3>
          <p>{section.note}</p>
        </div>
      </header>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

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
  const words = useWords();
  const theme = useTheme();
  const motion = useChatMotion();
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

  const ready = !!settings && !!prefs;

  /**
   * Light the rail entry for whatever you are actually looking at.
   *
   * The rail used to be lit only by clicking it, so scrolling past four
   * sections left it insisting you were still in the first one — which is
   * exactly when a table of contents stops being useful. The top third of the
   * viewport is the band that counts as "here": a heading that has just
   * scrolled up into it is the one you have arrived at.
   */
  useEffect(() => {
    if (!ready) return;
    const nodes = SECTIONS.map((s) => document.getElementById(`settings-${s.id}`)).filter(
      (n): n is HTMLElement => n !== null,
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = hit?.target.id.replace("settings-", "");
        if (id) setCurrent(id as SectionId);
      },
      { rootMargin: "0px 0px -66% 0px", threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  const dirty =
    !!settings &&
    !!saved &&
    !!prefs &&
    !!savedPrefs &&
    (settings.model !== saved.model ||
      settings.effort !== saved.effort ||
      settings.permissionMode !== saved.permissionMode ||
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
      // The Code button reads this query.
      void qc.invalidateQueries({ queryKey: ["preferences"] });
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  };

  const jumpTo = (id: SectionId) => {
    setCurrent(id);
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!settings || !prefs) {
    return <div className="settings-page-loading">Opening the settings…</div>;
  }

  return (
    <div className="settings-page">
      <aside className="settings-rail">
        <button
          className="settings-back"
          onClick={() => void leave()}
          data-tip="Back to your worktrees"
        >
          <ArrowLeft size={13} />
          Done
        </button>
        <nav aria-label="Settings sections">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                className={`settings-rail-item ${current === section.id ? "settings-rail-on" : ""}`}
                aria-current={current === section.id ? "true" : undefined}
                onClick={() => jumpTo(section.id)}
                data-tip={section.note}
              >
                <Icon size={13} />
                {section.label}
              </button>
            );
          })}
        </nav>
        <p className="settings-rail-foot">
          Saved on this machine, under <code>~/.sylva</code>.
        </p>
      </aside>

      <div className="settings-body" ref={scrollRef}>
        <header className="settings-title">
          <h2>Settings</h2>
          <p>Sylva itself, and where every {words.agent} starts. None of it leaves this machine.</p>
        </header>

        <Section id="appearance">
          <div className="field">
            <span data-tip="How Sylva looks — and sounds, and what it calls things">Theme</span>
            <div className="settings-control">
              <ThemePicker />
            </div>
            <span className="field-hint">
              {theme === "forest"
                ? "The night wood: amber light, pixel dryads, the clearing map, and a music box under it."
                : "Black and white, Inter, no forest — for a screen other people can see. Its own music and chimes, too, both quieter."}
            </span>
          </div>

          <div className="field">
            <span data-tip="How a new message, tool call or result arrives in the conversation">
              Chat motion
            </span>
            <div className="settings-control">
              <div className="seg" role="group" aria-label="Chat motion">
                {CHAT_MOTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={motion === m ? "seg-on" : ""}
                    onClick={() => applyMotion(m)}
                    aria-pressed={motion === m}
                    data-tip={MOTION_TIP[m]}
                  >
                    {MOTION_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <span className="field-hint">{MOTION_TIP[motion]}</span>
          </div>

          <div className="field">
            <span data-tip="Scales every piece of text in Sylva">Text size</span>
            <div className="settings-control">
              <TextSize />
            </div>
            <span className="field-hint">
              Saved to this browser and applied as you change it, so it takes effect without saving
              the page.
            </span>
          </div>
        </Section>

        <Section id="sound">
          <div className="field">
            <span data-tip={`How loud cues play, and the background ${words.ambience} bed`}>
              Volume and ambience
            </span>
            <div className="settings-control">
              <AudioControls />
            </div>
            <span className="field-hint">
              Chimes when an agent finishes, a firmer cue when one needs your approval, and blips
              for commits and prompts. ♪ plays an {words.ambience} — wind, a low pad, the occasional
              cricket.
            </span>
          </div>
        </Section>

        <Section id="worktrees">
          <CopyEnvFilesField value={prefs} onChange={setPrefs} />
        </Section>

        <Section id="terminal">
          <TerminalShellField value={prefs} onChange={setPrefs} />
          <TerminalScrollbackField value={prefs} onChange={setPrefs} />
          <TerminalAppField value={prefs} onChange={setPrefs} />
        </Section>

        <Section id="agent">
          <ModelField
            value={settings.model}
            onChange={(model) => setSettings({ ...settings, model: model as string | null })}
          />
          <EffortField
            value={settings.effort}
            onChange={(effort) =>
              setSettings({
                ...settings,
                effort: effort as AgentSettings["effort"],
              })
            }
          />
          <PermissionField
            value={settings.permissionMode}
            onChange={(v) =>
              setSettings({ ...settings, permissionMode: v === INHERIT ? "supervised" : v })
            }
            onRequestFull={() => setConfirming(true)}
          />
          {confirming && (
            <BypassWarning
              scope="in every worktree that hasn't set its own permission mode"
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setSettings({ ...settings, permissionMode: "full" });
                setConfirming(false);
              }}
            />
          )}
          {dirty && (
            <span className="field-hint">
              Saving restarts any running session that inherits a changed value. Conversations carry
              over.
            </span>
          )}
        </Section>

        <Section id="repos">
          <ReposSection onRegister={onRegister} />
        </Section>

        <Section id="about">
          <span className="field-hint">
            Sylva runs entirely on this machine. It talks to git through the real CLI and to Claude
            through the Agent SDK, using the credentials Claude Code already stores.
          </span>
          <div className="settings-control">
            <button
              className="btn-quiet"
              onClick={onAbout}
              data-tip="What Sylva is, and who built it"
            >
              About Sylva
            </button>
          </div>
        </Section>
      </div>

      {/* Saving is a page-level action, so it lives at the page level rather
          than repeated inside whichever section happens to be dirty. It only
          arrives once there is something to save: a bar permanently across the
          bottom is a permanent claim on the space, for a button pressed twice
          a month. */}
      <div className={`settings-save ${dirty ? "settings-save-on" : ""}`} aria-hidden={!dirty}>
        {error && <div className="form-error">{error}</div>}
        <span className="settings-save-note">You have unsaved changes.</span>
        <button
          className="btn-quiet"
          onClick={() => {
            setSettings(saved);
            setPrefs(savedPrefs);
          }}
          disabled={busy || !dirty}
          data-tip="Put everything back the way it was saved"
        >
          Discard
        </button>
        <button
          className="btn-primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
          data-tip="Save these settings"
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
