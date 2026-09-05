import { watch as chokidarWatch, type FSWatcher as ChokidarWatcher } from "chokidar";
import { watch as fsWatch, type FSWatcher as NodeWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileEvent } from "sylva-shared";
import { now } from "../lib/id.js";
import type { GitOps } from "./gitOps.js";
import type { WsHub } from "../ws/hub.js";

const DEBOUNCE_MS = 100;
/**
 * The longest a change may sit unreported while more keep arriving.
 *
 * The debounce waits for quiet, and a build, an install or an agent rewriting
 * a hundred files never goes quiet — so without a ceiling the Files tab sits
 * blank through the whole of exactly the work you opened it to watch, and then
 * delivers it in one slab at the end.
 */
const MAX_WAIT_MS = 1000;
/** A checkout touches HEAD several times; wait for it to settle. */
const HEAD_DEBOUNCE_MS = 150;

/**
 * Files inside the git directory that mean the status has moved.
 *
 * Only HEAD used to be watched, which caught a checkout and nothing else — and
 * a commit does not touch HEAD. It rewrites the index and appends to the
 * reflog; the branch ref it moves lives in the repository's common directory,
 * not this worktree's. So committing left every dirty count in the app saying
 * what was true a minute ago, until something else happened to the working
 * tree or you reloaded the page.
 *
 * `index` is the one that matters: `git add`, `reset`, `stash` and `commit`
 * all rewrite it, and all of them change what `git status` would say. The rest
 * are the states a half-finished merge or rebase leaves behind.
 */
const GIT_STATUS_FILES = new Set([
  "index",
  "ORIG_HEAD",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
]);

/**
 * Git writes through a lock file and renames it into place, so every write
 * shows up twice — once as `index.lock` appearing and once as `index` being
 * replaced. The lock half is not an event, it is the mechanism.
 */
function isGitLock(name: string): boolean {
  return name.endsWith(".lock");
}
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
  /** Closes the HEAD watch, which is separate because .git is ignored. */
  closeHead: () => void;
  reasons: Set<"focus" | "session">;
  pending: Map<string, FileEvent>;
  dropped: number;
  timer: NodeJS.Timeout | null;
  /** When the oldest unflushed change arrived, for the ceiling above. */
  pendingSince: number | null;
  headTimer: NodeJS.Timeout | null;
  /** Debounce for the git-dir writes that move the status but not the branch. */
  statusTimer: NodeJS.Timeout | null;
  /** True while a `git status` for this worktree is being read. */
  statusBusy: boolean;
  /** Set when changes landed during that read, so one more follows it. */
  statusAgain: boolean;
  /** The last status broadcast, to avoid saying the same thing twice. */
  lastStatus: string | null;
}

/**
 * Watches every worktree a pane holds, plus any worktree with an active agent
 * session. Events are debounced/batched; each flush also refreshes git status.
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
  private openIds = new Set<string>();

  constructor(
    private hub: WsHub,
    private gitOps: GitOps,
  ) {}

  /**
   * Every worktree a pane currently holds. Panes made this a set rather than a
   * single id: a worktree in the second pane has to stream just as live as the
   * one in the first, or half the split is a still photograph.
   *
   * Diffed against the previous set so an unchanged worktree keeps its existing
   * watcher — tearing one down and rebuilding it drops whatever changed in
   * between.
   */
  setWatched(entries: { worktreeId: string; path: string }[]): void {
    const next = new Set(entries.map((e) => e.worktreeId));
    for (const id of this.openIds) {
      if (!next.has(id)) this.dropReason(id, "focus");
    }
    for (const entry of entries) this.ensure(entry.worktreeId, entry.path, "focus");
    this.openIds = next;
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
      closeHead: () => {},
      reasons: new Set([reason]),
      pending: new Map(),
      dropped: 0,
      timer: null,
      pendingSince: null,
      headTimer: null,
      statusTimer: null,
      statusBusy: false,
      statusAgain: false,
      lastStatus: null,
    };
    this.watched.set(worktreeId, state);
    void this.watchHead(worktreeId, state);

    const record = (relPath: string, change: FileEvent["change"]) => {
      if (isIgnored(relPath)) return;
      if (state.pending.size >= MAX_EVENTS_PER_BATCH && !state.pending.has(relPath)) {
        state.dropped++;
      } else {
        state.pending.set(relPath, { worktreeId, path: relPath, change, at: now() });
      }
      if (state.pendingSince === null) state.pendingSince = Date.now();
      // Wait for quiet, but never longer than the ceiling: a stream of changes
      // that never pauses would otherwise keep pushing the flush ahead of
      // itself and report nothing at all until the work finished.
      const waited = Date.now() - state.pendingSince;
      const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void this.flush(worktreeId), delay);
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

  /**
   * Watch HEAD, so a branch switch shows up without a reload.
   *
   * The file watcher deliberately ignores `.git` — watching it would flood the
   * feed with object churn on every commit — but that also made a checkout
   * invisible, which is the one thing inside `.git` worth hearing about. So
   * HEAD gets its own watch.
   *
   * Watches the *directory* rather than the file: git replaces HEAD by writing
   * a temp file and renaming over it, which breaks a watch held on the old
   * inode.
   */
  private async watchHead(worktreeId: string, state: Watched): Promise<void> {
    let gitDir: string;
    try {
      gitDir = await this.gitOps.gitDir(worktreeId);
    } catch {
      return; // worktree vanished between being opened and being watched
    }
    // Dropped while we were asking.
    if (this.watched.get(worktreeId) !== state) return;

    try {
      const watcher = fsWatch(gitDir, { persistent: true });
      watcher.on("change", (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (isGitLock(name)) return;

        // HEAD moving is a checkout: the branch name changed too, and that is
        // fetched rather than streamed.
        if (name === "HEAD") {
          if (state.headTimer) clearTimeout(state.headTimer);
          // git writes HEAD more than once during a checkout; answer the last.
          state.headTimer = setTimeout(() => void this.headMoved(worktreeId), HEAD_DEBOUNCE_MS);
          return;
        }

        // Everything else here means the status moved but the branch didn't —
        // a commit, a stage, a reset. Re-read the status and say nothing about
        // the worktree list, which hasn't changed.
        if (!GIT_STATUS_FILES.has(name)) return;
        if (state.statusTimer) clearTimeout(state.statusTimer);
        state.statusTimer = setTimeout(() => void this.statusMoved(worktreeId), HEAD_DEBOUNCE_MS);
      });
      watcher.on("error", () => {});
      state.closeHead = () => watcher.close();
    } catch {
      // No watch available here; the panel still refreshes on file changes.
    }
  }

  /**
   * The index moved: re-read the status, and nothing else.
   *
   * Deliberately quieter than headMoved — no worktrees.changed — because
   * invalidating the worktree list on every `git add` would refetch every
   * repository's worktrees for a fact that hasn't changed. refreshStatus
   * already drops a status identical to the last one, so a `git status` that
   * only touched the index's stat cache broadcasts nothing and the watch
   * settles instead of chasing itself.
   */
  private async statusMoved(worktreeId: string): Promise<void> {
    const state = this.watched.get(worktreeId);
    if (!state) return;
    try {
      await this.refreshStatus(worktreeId, state);
    } catch {
      // Mid-rebase, or the worktree is gone; the next event will catch up.
    }
  }

  private async headMoved(worktreeId: string): Promise<void> {
    const state = this.watched.get(worktreeId);
    try {
      // Through the same single-flight read as the file flushes: a checkout is
      // exactly when a hundred file events are already in the air.
      if (state) await this.refreshStatus(worktreeId, state);
      else this.hub.broadcast({ type: "git.status", status: await this.gitOps.status(worktreeId) });
      // The branch *name* lives in the worktree list, which is fetched rather
      // than streamed — so say the list is stale, or the sidebar keeps showing
      // the branch that was checked out when the page loaded.
      this.hub.broadcast({ type: "worktrees.changed", repoId: null });
    } catch {
      // Mid-rebase, or the worktree is gone; the next event will catch up.
    }
  }

  private dropReason(worktreeId: string, reason: "focus" | "session"): void {
    const state = this.watched.get(worktreeId);
    if (!state) return;
    state.reasons.delete(reason);
    if (state.reasons.size === 0) {
      if (state.timer) clearTimeout(state.timer);
      if (state.headTimer) clearTimeout(state.headTimer);
      if (state.statusTimer) clearTimeout(state.statusTimer);
      state.close();
      state.closeHead();
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
    state.pendingSince = null;

    this.hub.broadcast({ type: "file.batch", worktreeId, events, truncated });
    await this.refreshStatus(worktreeId, state);
  }

  /**
   * Read git status and say what it says — one read at a time.
   *
   * `git status` is a process, and on a large repository a slow one. Flushes
   * arrive faster than it finishes while a build is running, and starting one
   * per flush piles up spawns that all answer the same question, competing with
   * the very work they are describing. So a second request while one is in
   * flight is remembered rather than started, and answered by a single re-read
   * once the first is done.
   */
  private async refreshStatus(worktreeId: string, state: Watched): Promise<void> {
    if (state.statusBusy) {
      state.statusAgain = true;
      return;
    }
    state.statusBusy = true;
    try {
      do {
        state.statusAgain = false;
        const status = await this.gitOps.status(worktreeId);
        // Most changes don't move the status: a file already listed as modified
        // being saved again says exactly what it said last time. Repeating it
        // re-renders every panel and sidebar row that watches this worktree,
        // for news that isn't.
        const said = JSON.stringify(status);
        if (said === state.lastStatus) continue;
        state.lastStatus = said;
        this.hub.broadcast({ type: "git.status", status });
      } while (state.statusAgain && this.watched.get(worktreeId) === state);
    } catch {
      // Worktree may have been removed mid-flight; the watcher will be dropped.
    } finally {
      state.statusBusy = false;
    }
  }

  async closeAll(): Promise<void> {
    for (const [id, state] of this.watched) {
      if (state.timer) clearTimeout(state.timer);
      if (state.headTimer) clearTimeout(state.headTimer);
      if (state.statusTimer) clearTimeout(state.statusTimer);
      state.close();
      state.closeHead();
      this.watched.delete(id);
    }
  }
}
