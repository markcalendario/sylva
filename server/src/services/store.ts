import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  clampScrollback,
  GLOBAL_DEFAULTS,
  PREFERENCE_DEFAULTS,
  toPermissionMode,
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
    preferences: { ...PREFERENCE_DEFAULTS },
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
/**
 * Bring a settings file written before permission modes up to date.
 *
 * Every installation that existed before this has `bypassPermissions: true |
 * false` on disk instead of a mode. Reading it as a mode is one line
 * (toPermissionMode), but the old key has to be dropped as well — left in
 * place it would be written back out on the next save, and a file carrying
 * both would be ambiguous to anything reading it later.
 */
function migrateSettings(base: AgentSettings, stored: unknown): AgentSettings {
  if (!stored || typeof stored !== "object") return { ...base };
  const source = stored as Partial<AgentSettings> & { bypassPermissions?: unknown };
  return {
    permissionMode:
      source.permissionMode !== undefined || source.bypassPermissions !== undefined
        ? toPermissionMode(source.permissionMode ?? source.bypassPermissions)
        : base.permissionMode,
    model: source.model !== undefined ? source.model : base.model,
    effort: source.effort !== undefined ? source.effort : base.effort,
  };
}

/** The same, per worktree — where every key is optional and absence means
 *  "inherit", so a key that was never set must stay unset. */
function migrateOverrides(stored: unknown): Record<string, WorktreeOverrides> {
  if (!stored || typeof stored !== "object") return {};
  const out: Record<string, WorktreeOverrides> = {};
  for (const [worktreeId, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const source = value as WorktreeOverrides & { bypassPermissions?: unknown };
    const overrides: WorktreeOverrides = {};
    if (source.permissionMode !== undefined) {
      overrides.permissionMode = toPermissionMode(source.permissionMode);
    } else if (source.bypassPermissions !== undefined) {
      overrides.permissionMode = toPermissionMode(source.bypassPermissions);
    }
    if (source.model !== undefined) overrides.model = source.model;
    if (source.effort !== undefined) overrides.effort = source.effort;
    if (Object.keys(overrides).length > 0) out[worktreeId] = overrides;
  }
  return out;
}

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
      globalSettings: migrateSettings(base.globalSettings, source.globalSettings),
      preferences: {
        editorTarget: saved.editorTarget ?? base.preferences.editorTarget,
        editorCommand: saved.editorCommand ?? base.preferences.editorCommand,
        terminalShell:
          typeof saved.terminalShell === "string"
            ? saved.terminalShell
            : base.preferences.terminalShell,
        terminalApp: saved.terminalApp ?? base.preferences.terminalApp,
        terminalAppCommand: saved.terminalAppCommand ?? base.preferences.terminalAppCommand,
        terminalScrollback:
          typeof saved.terminalScrollback === "number"
            ? clampScrollback(saved.terminalScrollback)
            : base.preferences.terminalScrollback,
        copyEnvFiles:
          typeof saved.copyEnvFiles === "boolean"
            ? saved.copyEnvFiles
            : base.preferences.copyEnvFiles,
        pullBeforeWorktree:
          typeof saved.pullBeforeWorktree === "boolean"
            ? saved.pullBeforeWorktree
            : base.preferences.pullBeforeWorktree,
      },
      prefs: migrateOverrides(source.prefs),
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
