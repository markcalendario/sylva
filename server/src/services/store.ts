import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  GLOBAL_DEFAULTS,
  PREFERENCE_DEFAULTS,
  type AgentSettings,
  type AppPreferences,
  type Repo,
  type WorktreeOverrides,
} from "sylva-shared";

export interface PersistedSession {
  id: string;
  worktreeId: string;
  worktreePath: string;
  repoId: string;
  sdkSessionId: string | null;
  totalCostUsd: number;
  totalTokens: number;
  createdAt: string;
}

/** Machine state: what exists on this computer. */
interface RegistryFile {
  repos: Omit<Repo, "available">[];
  sessions: PersistedSession[];
}

/**
 * Everything a person would call a setting, kept in its own file so it can be
 * read, edited and backed up by hand without picking through session metadata.
 */
interface SettingsFile {
  /** Defaults every worktree inherits unless it overrides them. */
  globalSettings: AgentSettings;
  /** App-level preferences: the Open target, saved prompts. */
  preferences: AppPreferences;
  /** Per-worktree overrides, keyed by worktree id. */
  prefs: Record<string, WorktreeOverrides>;
}

/**
 * Fresh blanks. These must build new arrays and objects every call: the
 * defaults are module-level constants, and handing out the same array means one
 * Store pushing a repo silently edits the default every other Store falls back
 * to.
 */
function blankRegistry(): RegistryFile {
  return { repos: [], sessions: [] };
}

function blankSettings(): SettingsFile {
  return {
    globalSettings: { ...GLOBAL_DEFAULTS },
    preferences: { ...PREFERENCE_DEFAULTS, savedPrompts: [...PREFERENCE_DEFAULTS.savedPrompts] },
    prefs: {},
  };
}

/**
 * Persistence for Sylva's state under ~/.sylva/ (override with SYLVA_HOME):
 *   settings.json          agent defaults, app preferences, worktree overrides
 *   registry.json          repos + session metadata
 *   sessions/<id>.jsonl    agent transcripts
 *
 * None of it lives in your repository, so none of it can be committed.
 */
export class Store {
  readonly baseDir: string;
  readonly sessionsDir: string;
  private registryPath: string;
  private settingsPath: string;
  private data: RegistryFile = blankRegistry();
  private settings: SettingsFile = blankSettings();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.env.SYLVA_HOME ?? join(homedir(), ".sylva");
    this.sessionsDir = join(this.baseDir, "sessions");
    this.registryPath = join(this.baseDir, "registry.json");
    this.settingsPath = join(this.baseDir, "settings.json");
  }

  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });

    let legacy: Partial<SettingsFile> & { preferences?: Partial<AppPreferences> } = {};
    try {
      const raw = await readFile(this.registryPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile> & Partial<SettingsFile>;
      this.data = {
        repos: Array.isArray(parsed.repos) ? parsed.repos : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
      // Settings used to live here; keep them if settings.json isn't written yet.
      legacy = parsed;
    } catch {
      this.data = blankRegistry();
    }

    let stored: (Partial<SettingsFile> & { preferences?: Partial<AppPreferences> }) | null = null;
    try {
      stored = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<SettingsFile> & {
        preferences?: Partial<AppPreferences>;
      };
    } catch {
      stored = null;
    }

    const source = stored ?? legacy;
    const base = blankSettings();
    const saved: Partial<AppPreferences> = source.preferences ?? {};
    // Fields are picked one by one rather than spread, so a key that has been
    // renamed or dropped since the file was written doesn't linger in it
    // forever, quietly accumulating.
    this.settings = {
      globalSettings: { ...base.globalSettings, ...(source.globalSettings ?? {}) },
      preferences: {
        editorTarget: saved.editorTarget ?? base.preferences.editorTarget,
        editorCommand: saved.editorCommand ?? base.preferences.editorCommand,
        terminalTarget: saved.terminalTarget ?? base.preferences.terminalTarget,
        terminalCommand: saved.terminalCommand ?? base.preferences.terminalCommand,
        savedPrompts: Array.isArray(saved.savedPrompts)
          ? saved.savedPrompts
          : base.preferences.savedPrompts,
        runner: {
          defaultCommand:
            typeof saved.runner?.defaultCommand === "string" && saved.runner.defaultCommand.trim()
              ? saved.runner.defaultCommand
              : base.preferences.runner.defaultCommand,
          byRepo:
            saved.runner?.byRepo && typeof saved.runner.byRepo === "object"
              ? saved.runner.byRepo
              : {},
        },
      },
      prefs: source.prefs && typeof source.prefs === "object" ? source.prefs : {},
    };

    // First run after the split: write settings.json so it exists to be edited,
    // and rewrite registry.json without its now-stale copy of the settings, so
    // there is exactly one place each value lives.
    if (!stored) {
      await this.flushSettings();
      await this.flush();
    }
  }

  get repos(): Omit<Repo, "available">[] {
    return this.data.repos;
  }

  get sessions(): PersistedSession[] {
    return this.data.sessions;
  }

  async addRepo(repo: Omit<Repo, "available">): Promise<void> {
    this.data.repos.push(repo);
    await this.flush();
  }

  async removeRepo(id: string): Promise<void> {
    this.data.repos = this.data.repos.filter((r) => r.id !== id);
    this.data.sessions = this.data.sessions.filter((s) => s.repoId !== id);
    await this.flush();
  }

  async upsertSession(session: PersistedSession): Promise<void> {
    const i = this.data.sessions.findIndex((s) => s.id === session.id);
    if (i >= 0) this.data.sessions[i] = session;
    else this.data.sessions.push(session);
    await this.flush();
  }

  async removeSession(id: string): Promise<void> {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    await this.flush();
  }

  /** Where settings.json lives, so the UI can tell you. */
  get settingsFile(): string {
    return this.settingsPath;
  }

  get globalSettings(): AgentSettings {
    return this.settings.globalSettings;
  }

  async setGlobalSettings(settings: AgentSettings): Promise<void> {
    this.settings.globalSettings = settings;
    await this.flushSettings();
  }

  get preferences(): AppPreferences {
    return this.settings.preferences;
  }

  async setPreferences(preferences: AppPreferences): Promise<void> {
    this.settings.preferences = preferences;
    await this.flushSettings();
  }

  overridesFor(worktreeId: string): WorktreeOverrides {
    return this.settings.prefs[worktreeId] ?? {};
  }

  /** Global merged with this worktree's overrides. Present keys win. */
  effectiveFor(worktreeId: string): AgentSettings {
    return { ...this.settings.globalSettings, ...this.overridesFor(worktreeId) };
  }

  async setOverrides(worktreeId: string, overrides: WorktreeOverrides): Promise<void> {
    if (Object.keys(overrides).length === 0) delete this.settings.prefs[worktreeId];
    else this.settings.prefs[worktreeId] = overrides;
    await this.flushSettings();
  }

  transcriptPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  attachmentsDir(worktreeId: string): string {
    return join(this.baseDir, "attachments", worktreeId);
  }

  /**
   * Where the grove dryad works. Its own directory rather than your home: the
   * grove reads across every repository, but anything it writes with a relative
   * path lands somewhere harmless and predictable.
   */
  get groveDir(): string {
    return join(this.baseDir, "grove");
  }

  /** Atomic, serialized write of registry.json. */
  private flush(): Promise<void> {
    return this.write(this.registryPath, this.data);
  }

  /** Atomic, serialized write of settings.json. */
  private flushSettings(): Promise<void> {
    return this.write(this.settingsPath, this.settings);
  }

  /**
   * Write via a temp file and rename. Both files share one chain so a crash
   * mid-write can never leave a half-written file behind, whichever it was.
   */
  private write(path: string, value: unknown): Promise<void> {
    const snapshot = JSON.stringify(value, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, path);
    });
    return this.writeChain;
  }
}
