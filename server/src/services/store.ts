import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Repo, WorktreePrefs } from "sylva-shared";

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
  /** Per-worktree settings, keyed by worktree id. */
  prefs: Record<string, WorktreePrefs>;
}

const EMPTY: RegistryFile = { repos: [], sessions: [], prefs: {} };

export const DEFAULT_PREFS: WorktreePrefs = { bypassPermissions: false };

/**
 * Persistence for Sylva's state under ~/.sylva/ (override with SYLVA_HOME):
 *   registry.json          repos + session metadata
 *   sessions/<id>.jsonl    agent transcripts
 */
export class Store {
  readonly baseDir: string;
  readonly sessionsDir: string;
  private registryPath: string;
  private data: RegistryFile = EMPTY;
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
      };
    } catch {
      this.data = { repos: [], sessions: [], prefs: {} };
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

  prefsFor(worktreeId: string): WorktreePrefs {
    return { ...DEFAULT_PREFS, ...this.data.prefs[worktreeId] };
  }

  async setPrefs(worktreeId: string, prefs: WorktreePrefs): Promise<void> {
    this.data.prefs[worktreeId] = prefs;
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
