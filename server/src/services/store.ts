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

interface RegistryFile {
  repos: Omit<Repo, "available">[];
  sessions: PersistedSession[];
  /** Per-worktree overrides, keyed by worktree id. */
  prefs: Record<string, WorktreeOverrides>;
  /** Defaults every worktree inherits unless it overrides them. */
  globalSettings: AgentSettings;
  /** App-level preferences: the Open target, saved prompts. */
  preferences: AppPreferences;
}

/**
 * A fresh empty registry. Must build new arrays and objects every call: the
 * defaults are module-level constants, and handing out the same array means one
 * Store pushing a repo silently edits the default every other Store falls back
 * to.
 */
function blank(): RegistryFile {
  return {
    repos: [],
    sessions: [],
    prefs: {},
    globalSettings: { ...GLOBAL_DEFAULTS },
    preferences: { ...PREFERENCE_DEFAULTS, savedPrompts: [...PREFERENCE_DEFAULTS.savedPrompts] },
  };
}

/**
 * Persistence for Sylva's state under ~/.sylva/ (override with SYLVA_HOME):
 *   registry.json          repos + session metadata
 *   sessions/<id>.jsonl    agent transcripts
 */
export class Store {
  readonly baseDir: string;
  readonly sessionsDir: string;
  private registryPath: string;
  private data: RegistryFile = blank();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.env.SYLVA_HOME ?? join(homedir(), ".sylva");
    this.sessionsDir = join(this.baseDir, "sessions");
    this.registryPath = join(this.baseDir, "registry.json");
  }

  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    try {
      const raw = await readFile(this.registryPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      this.data = {
        repos: Array.isArray(parsed.repos) ? parsed.repos : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        prefs: parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : {},
        globalSettings: { ...GLOBAL_DEFAULTS, ...(parsed.globalSettings ?? {}) },
        preferences: {
          ...blank().preferences,
          ...(parsed.preferences ?? {}),
        },
      };
    } catch {
      this.data = blank();
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

  get globalSettings(): AgentSettings {
    return this.data.globalSettings;
  }

  async setGlobalSettings(settings: AgentSettings): Promise<void> {
    this.data.globalSettings = settings;
    await this.flush();
  }

  get preferences(): AppPreferences {
    return this.data.preferences;
  }

  async setPreferences(preferences: AppPreferences): Promise<void> {
    this.data.preferences = preferences;
    await this.flush();
  }

  overridesFor(worktreeId: string): WorktreeOverrides {
    return this.data.prefs[worktreeId] ?? {};
  }

  /** Global merged with this worktree's overrides. Present keys win. */
  effectiveFor(worktreeId: string): AgentSettings {
    return { ...this.data.globalSettings, ...this.overridesFor(worktreeId) };
  }

  async setOverrides(worktreeId: string, overrides: WorktreeOverrides): Promise<void> {
    if (Object.keys(overrides).length === 0) delete this.data.prefs[worktreeId];
    else this.data.prefs[worktreeId] = overrides;
    await this.flush();
  }

  transcriptPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  attachmentsDir(worktreeId: string): string {
    return join(this.baseDir, "attachments", worktreeId);
  }

  /** Atomic, serialized write of registry.json. */
  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.registryPath}.tmp`;
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, this.registryPath);
    });
    return this.writeChain;
  }
}
