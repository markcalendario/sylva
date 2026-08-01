import { watch, type FSWatcher } from "chokidar";
import { relative, sep } from "node:path";
import type { FileEvent } from "sylva-shared";
import { now } from "../lib/id.js";
import type { GitOps } from "./gitOps.js";
import type { WsHub } from "../ws/hub.js";

const DEBOUNCE_MS = 100;
const MAX_EVENTS_PER_BATCH = 500;

const IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "dist",
  "build",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

interface Watched {
  watcher: FSWatcher;
  reasons: Set<"focus" | "session">;
  pending: Map<string, FileEvent>;
  dropped: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Watches the focused worktree plus any worktree with an active agent session.
 * Events are debounced/batched; each flush also refreshes git status.
 */
export class WatcherManager {
  private watched = new Map<string, Watched>(); // worktreeId -> state
  private focusedId: string | null = null;

  constructor(
    private hub: WsHub,
    private gitOps: GitOps,
  ) {}

  setFocused(worktreeId: string | null, worktreePath: string | null): void {
    const prev = this.focusedId;
    this.focusedId = worktreeId;
    if (prev && prev !== worktreeId) this.dropReason(prev, "focus");
    if (worktreeId && worktreePath) this.ensure(worktreeId, worktreePath, "focus");
  }

  addSessionWatch(worktreeId: string, worktreePath: string): void {
    this.ensure(worktreeId, worktreePath, "session");
  }

  removeSessionWatch(worktreeId: string): void {
    this.dropReason(worktreeId, "session");
  }

  private ensure(worktreeId: string, worktreePath: string, reason: "focus" | "session"): void {
    const existing = this.watched.get(worktreeId);
    if (existing) {
      existing.reasons.add(reason);
      return;
    }
    const watcher = watch(worktreePath, {
      ignoreInitial: true,
      ignored: (path: string) => {
        const rel = relative(worktreePath, path);
        if (rel.startsWith("..")) return false;
        return rel.split(sep).some((seg) => IGNORED_SEGMENTS.has(seg));
      },
    });
    const state: Watched = {
      watcher,
      reasons: new Set([reason]),
      pending: new Map(),
      dropped: 0,
      timer: null,
    };
    this.watched.set(worktreeId, state);

    const record = (change: FileEvent["change"]) => (absPath: string) => {
      const rel = relative(worktreePath, absPath);
      if (!rel || rel.startsWith("..")) return;
      if (state.pending.size >= MAX_EVENTS_PER_BATCH && !state.pending.has(rel)) {
        state.dropped++;
      } else {
        state.pending.set(rel, { worktreeId, path: rel, change, at: now() });
      }
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void this.flush(worktreeId), DEBOUNCE_MS);
    };

    watcher.on("add", record("added"));
    watcher.on("change", record("changed"));
    watcher.on("unlink", record("deleted"));
    watcher.on("error", () => {});
  }

  private dropReason(worktreeId: string, reason: "focus" | "session"): void {
    const state = this.watched.get(worktreeId);
    if (!state) return;
    state.reasons.delete(reason);
    if (state.reasons.size === 0) {
      if (state.timer) clearTimeout(state.timer);
      void state.watcher.close();
      this.watched.delete(worktreeId);
    }
  }

  private async flush(worktreeId: string): Promise<void> {
    const state = this.watched.get(worktreeId);
    if (!state || state.pending.size === 0) return;
    const events = [...state.pending.values()];
    const truncated = state.dropped > 0;
    state.pending.clear();
    state.dropped = 0;
    state.timer = null;

    this.hub.broadcast({ type: "file.batch", worktreeId, events, truncated });
    try {
      const status = await this.gitOps.status(worktreeId);
      this.hub.broadcast({ type: "git.status", status });
    } catch {
      // Worktree may have been removed mid-flight; the watcher will be dropped.
    }
  }

  async closeAll(): Promise<void> {
    for (const [id, state] of this.watched) {
      if (state.timer) clearTimeout(state.timer);
      await state.watcher.close();
      this.watched.delete(id);
    }
  }
}
