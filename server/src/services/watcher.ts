import { watch as chokidarWatch, type FSWatcher as ChokidarWatcher } from "chokidar";
import { watch as fsWatch, type FSWatcher as NodeWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
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

export function isIgnored(relPath: string): boolean {
  if (!relPath || relPath.startsWith("..")) return true;
  return relPath.split(sep).some((seg) => IGNORED_SEGMENTS.has(seg));
}

interface Watched {
  close: () => void;
  reasons: Set<"focus" | "session">;
  pending: Map<string, FileEvent>;
  dropped: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Watches the focused worktree plus any worktree with an active agent session.
 * Events are debounced/batched; each flush also refreshes git status.
 *
 * Uses Node's recursive fs.watch, which is backed by FSEvents on macOS and
 * costs one descriptor per worktree. Watching per-file (chokidar's default on
 * platforms without native recursion) exhausts the process descriptor table on
 * large repos and makes child_process.spawn fail with EBADF, which breaks every
 * git call in the app. Chokidar remains the fallback where recursion is
 * unsupported; there we accept its cost rather than lose watching entirely.
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

    const state: Watched = {
      close: () => {},
      reasons: new Set([reason]),
      pending: new Map(),
      dropped: 0,
      timer: null,
    };
    this.watched.set(worktreeId, state);

    const record = (relPath: string, change: FileEvent["change"]) => {
      if (isIgnored(relPath)) return;
      if (state.pending.size >= MAX_EVENTS_PER_BATCH && !state.pending.has(relPath)) {
        state.dropped++;
      } else {
        state.pending.set(relPath, { worktreeId, path: relPath, change, at: now() });
      }
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void this.flush(worktreeId), DEBOUNCE_MS);
    };

    state.close = this.startWatching(worktreePath, record);
  }

  /** Native recursive watch, falling back to chokidar where unsupported. */
  private startWatching(
    root: string,
    record: (relPath: string, change: FileEvent["change"]) => void,
  ): () => void {
    try {
      const watcher: NodeWatcher = fsWatch(root, { recursive: true, persistent: true });
      watcher.on("change", (_event, filename) => {
        if (!filename) return;
        const relPath = filename.toString();
        if (isIgnored(relPath)) return;
        // fs.watch reports 'rename' for both creation and deletion; ask the
        // filesystem which one actually happened.
        void stat(join(root, relPath)).then(
          (st) => {
            if (st.isDirectory()) return; // directory churn is noise in the feed
            // fs.watch can't tell create from modify, so treat a file born
            // within the last couple of seconds as newly added.
            const justBorn = Date.now() - st.birthtimeMs < 2000;
            record(relPath, justBorn ? "added" : "changed");
          },
          () => record(relPath, "deleted"),
        );
      });
      watcher.on("error", () => {});
      return () => watcher.close();
    } catch {
      const watcher: ChokidarWatcher = chokidarWatch(root, {
        ignoreInitial: true,
        ignored: (path: string) => isIgnored(relative(root, path)),
      });
      const rel = (abs: string) => relative(root, abs);
      watcher.on("add", (p) => record(rel(p), "added"));
      watcher.on("change", (p) => record(rel(p), "changed"));
      watcher.on("unlink", (p) => record(rel(p), "deleted"));
      watcher.on("error", () => {});
      return () => void watcher.close();
    }
  }

  private dropReason(worktreeId: string, reason: "focus" | "session"): void {
    const state = this.watched.get(worktreeId);
    if (!state) return;
    state.reasons.delete(reason);
    if (state.reasons.size === 0) {
      if (state.timer) clearTimeout(state.timer);
      state.close();
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
      state.close();
      this.watched.delete(id);
    }
  }
}
