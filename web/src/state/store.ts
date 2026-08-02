import { create } from "zustand";
import type {
  AgentAvailability,
  AgentEvent,
  Attachment,
  FileEvent,
  PermissionRequest,
  RunnerLine,
  RunnerState,
  ServerEvent,
  SessionInfo,
  Worktree,
  WorktreeStatus,
} from "sylva-shared";
import { api } from "../lib/api";

const FEED_CAP = 200;
/** Matches what the server retains, so both agree on what "the log" is. */
const RUNNER_LINE_CAP = 2000;

/** Stable empty arrays so selectors don't mint new references every render. */
export const NO_EVENTS: never[] = [];

/** What you've typed but not sent, per worktree. */
export interface Draft {
  text: string;
  attachments: Attachment[];
}

/**
 * Shared empty draft. Must be a stable reference: the selector returns it for
 * every untouched worktree, and a fresh object each call would re-render the
 * prompt bar on every store update.
 */
export const EMPTY_DRAFT: Draft = { text: "", attachments: [] };

export type Connection = "connecting" | "connected" | "disconnected";

export type Tab = "agent" | "files" | "git" | "run";

/**
 * One side of the workspace. Migrating an old system to a new one means two
 * repositories open at once, so what used to be "the focused worktree" is now
 * a small list of them — each with its own tab and its own selected diff,
 * because a pane you switch to Git shouldn't drag the other pane along.
 */
export interface Pane {
  id: string;
  worktreeId: string | null;
  tab: Tab;
  diffPath: string | null;
}

/** What the main area is showing. Panes persist behind the other two. */
export type View = "workspace" | "settings" | "grove";

/** Where a worktree lives, for anything holding only its id. */
export interface WorktreePlace {
  repoId: string;
  repoName: string;
  branch: string;
}

const PANES_KEY = "sylva.panes";

function freshPane(worktreeId: string | null = null): Pane {
  return { id: Math.random().toString(36).slice(2, 9), worktreeId, tab: "agent", diffPath: null };
}

/** Pane layout outlives a reload; which view you were on does not. */
function loadPanes(): Pane[] {
  try {
    const raw = localStorage.getItem(PANES_KEY);
    if (!raw) return [freshPane()];
    const parsed = JSON.parse(raw) as Pane[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [freshPane()];
    return parsed.slice(0, 2).map((p) => ({
      ...freshPane(typeof p.worktreeId === "string" ? p.worktreeId : null),
      ...(p.id ? { id: p.id } : {}),
      tab: p.tab === "files" || p.tab === "git" || p.tab === "run" ? p.tab : "agent",
    }));
  } catch {
    return [freshPane()];
  }
}

function savePanes(panes: Pane[]): void {
  try {
    localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  } catch {
    // Private mode, or a full quota. The layout is a convenience, not state we
    // can't run without.
  }
}

interface SylvaState {
  connection: Connection;
  focusedWorktreeId: string | null;
  sessions: Record<string, SessionInfo>; // by worktreeId
  availability: AgentAvailability;
  transcripts: Record<string, AgentEvent[]>; // by worktreeId
  pendingPermissions: Record<string, PermissionRequest[]>; // by worktreeId
  fileFeed: Record<string, FileEvent[]>; // by worktreeId, newest first
  statuses: Record<string, WorktreeStatus>; // by worktreeId
  /**
   * Worktrees whose last turn finished cleanly and you haven't looked at yet.
   * Not a timer: a dryad waits in the grove until you open its worktree, so a
   * turn that lands while you're away is still there when you get back.
   */
  celebrating: Record<string, boolean>; // by worktreeId
  /** Worktrees with activity the user hasn't looked at (unfocused). */
  unseenActivity: Record<string, boolean>;
  /**
   * Unsent prompt text and attachments, by worktreeId. Lives here rather than
   * in AgentPanel because switching tabs unmounts that panel — local state
   * would throw away whatever you'd typed. Keying by worktree also means a
   * half-written prompt survives wandering off to another tree and back.
   */
  drafts: Record<string, Draft>;

  /** Layout of the main area. */
  panes: Pane[];
  activePaneId: string;
  view: View;
  /** Runner state and retained output, by worktreeId. */
  runners: Record<string, RunnerState>;
  runnerOutput: Record<string, RunnerLine[]>;
  /**
   * Which repository each worktree belongs to. Worktrees are only ever listed
   * per repository, so anything that has a bare worktree id — the nav bar
   * saying where you are, the blocked-agent jump — has no way back to its repo
   * without an index like this one. The sidebar fills it as it lists them.
   */
  worktreeIndex: Record<string, WorktreePlace>;
  indexWorktrees: (repo: { id: string; name: string }, worktrees: Worktree[]) => void;

  setView: (view: View) => void;
  setActivePane: (paneId: string) => void;
  setPaneWorktree: (paneId: string, worktreeId: string | null) => void;
  setPaneTab: (paneId: string, tab: Tab) => void;
  setPaneDiff: (paneId: string, diffPath: string | null, tab?: Tab) => void;
  splitPane: () => void;
  closePane: (paneId: string) => void;
  /** Open a worktree in whichever pane is active — what the sidebar calls. */
  openWorktree: (worktreeId: string) => void;
  setRunner: (state: RunnerState) => void;
  seedRunner: (worktreeId: string, state: RunnerState, lines: RunnerLine[]) => void;
  clearRunnerOutput: (worktreeId: string) => void;

  setConnection: (c: Connection) => void;
  setDraft: (worktreeId: string, patch: Partial<Draft>) => void;
  clearDraft: (worktreeId: string) => void;
  setFocus: (worktreeId: string | null) => void;
  setTranscript: (worktreeId: string, events: AgentEvent[]) => void;
  setSession: (worktreeId: string, session: SessionInfo | null) => void;
  setPermissions: (worktreeId: string, reqs: PermissionRequest[]) => void;
  setStatus: (status: WorktreeStatus) => void;
  seedFileFeed: (worktreeId: string, events: FileEvent[]) => void;
  setAvailability: (a: AgentAvailability) => void;
  celebrate: (worktreeId: string) => void;
  applyServerEvent: (event: ServerEvent) => void;
}

const initialPanes = loadPanes();

export const useSylva = create<SylvaState>((set, get) => ({
  connection: "connecting",
  focusedWorktreeId: null,
  sessions: {},
  availability: { available: true },
  transcripts: {},
  pendingPermissions: {},
  fileFeed: {},
  statuses: {},
  celebrating: {},
  unseenActivity: {},
  drafts: {},

  panes: initialPanes,
  activePaneId: initialPanes[0]?.id ?? "",
  view: "workspace",
  runners: {},
  runnerOutput: {},
  worktreeIndex: {},

  indexWorktrees: (repo, worktrees) =>
    set((s) => {
      const next = { ...s.worktreeIndex };
      let changed = false;
      for (const wt of worktrees) {
        const entry = next[wt.id];
        const branch = wt.branch ?? `${wt.head.slice(0, 7)} (detached)`;
        if (entry?.repoId === repo.id && entry.repoName === repo.name && entry.branch === branch) {
          continue;
        }
        next[wt.id] = { repoId: repo.id, repoName: repo.name, branch };
        changed = true;
      }
      // Bail without a new object when nothing moved: this runs on every
      // worktree list refetch, and a fresh map each time re-renders the world.
      return changed ? { worktreeIndex: next } : {};
    }),

  setView: (view) => set({ view }),

  setActivePane: (activePaneId) => set({ activePaneId }),

  setPaneWorktree: (paneId, worktreeId) =>
    set((s) => {
      const panes = s.panes.map((p) =>
        // A pane pointed at a different worktree keeps its tab — you were on
        // Git for a reason — but not its diff, which belonged to the old one.
        p.id === paneId ? { ...p, worktreeId, diffPath: null } : p,
      );
      savePanes(panes);
      return { panes };
    }),

  setPaneTab: (paneId, tab) =>
    set((s) => {
      const panes = s.panes.map((p) => (p.id === paneId ? { ...p, tab } : p));
      savePanes(panes);
      return { panes };
    }),

  setPaneDiff: (paneId, diffPath, tab) =>
    set((s) => ({
      panes: s.panes.map((p) =>
        p.id === paneId ? { ...p, diffPath, ...(tab ? { tab } : {}) } : p,
      ),
    })),

  /**
   * Split by copying the active pane rather than opening an empty one: you
   * split because you want to see two things, and one of them is already here.
   */
  splitPane: () =>
    set((s) => {
      if (s.panes.length >= 2) return {};
      const active = s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0];
      const created = freshPane(active?.worktreeId ?? null);
      const panes = [...s.panes, created];
      savePanes(panes);
      return { panes, activePaneId: created.id };
    }),

  closePane: (paneId) =>
    set((s) => {
      if (s.panes.length <= 1) return {};
      const panes = s.panes.filter((p) => p.id !== paneId);
      savePanes(panes);
      return { panes, activePaneId: panes[0]?.id ?? "" };
    }),

  openWorktree: (worktreeId) => {
    const s = get();
    const paneId = s.panes.find((p) => p.id === s.activePaneId)?.id ?? s.panes[0]?.id;
    if (paneId) s.setPaneWorktree(paneId, worktreeId);
    // Choosing a worktree is also a request to look at it.
    if (s.view !== "workspace") set({ view: "workspace" });
    void api.setFocus(worktreeId);
  },

  setRunner: (state) =>
    set((s) => ({ runners: { ...s.runners, [state.worktreeId]: state } })),

  seedRunner: (worktreeId, state, lines) =>
    set((s) => ({
      runners: { ...s.runners, [worktreeId]: state },
      runnerOutput: { ...s.runnerOutput, [worktreeId]: lines },
    })),

  clearRunnerOutput: (worktreeId) =>
    set((s) => ({ runnerOutput: { ...s.runnerOutput, [worktreeId]: [] } })),

  setConnection: (connection) => set({ connection }),

  setDraft: (worktreeId, patch) =>
    set((s) => ({
      drafts: {
        ...s.drafts,
        [worktreeId]: { ...(s.drafts[worktreeId] ?? EMPTY_DRAFT), ...patch },
      },
    })),

  clearDraft: (worktreeId) =>
    set((s) => {
      if (!s.drafts[worktreeId]) return {};
      const drafts = { ...s.drafts };
      delete drafts[worktreeId];
      return { drafts };
    }),

  /**
   * Fill the feed from git status on arrival. Anything already streamed in is
   * newer than a seeded mtime, so live entries stay on top and win on path.
   */
  seedFileFeed: (worktreeId, events) =>
    set((s) => {
      const live = s.fileFeed[worktreeId] ?? [];
      const seen = new Set(live.map((e) => e.path));
      const merged = [...live, ...events.filter((e) => !seen.has(e.path))];
      return { fileFeed: { ...s.fileFeed, [worktreeId]: merged.slice(0, FEED_CAP) } };
    }),

  setFocus: (focusedWorktreeId) =>
    set((s) => {
      if (!focusedWorktreeId) return { focusedWorktreeId };
      // Opening a worktree is the acknowledgement. Its dryad heads back to the
      // camp the next time you look at the forest.
      const celebrating = { ...s.celebrating };
      delete celebrating[focusedWorktreeId];
      return {
        focusedWorktreeId,
        unseenActivity: { ...s.unseenActivity, [focusedWorktreeId]: false },
        celebrating,
      };
    }),

  setTranscript: (worktreeId, events) =>
    set((s) => ({ transcripts: { ...s.transcripts, [worktreeId]: events } })),

  setSession: (worktreeId, session) =>
    set((s) => {
      const sessions = { ...s.sessions };
      if (session) sessions[worktreeId] = session;
      else delete sessions[worktreeId];
      return { sessions };
    }),

  setPermissions: (worktreeId, reqs) =>
    set((s) => ({ pendingPermissions: { ...s.pendingPermissions, [worktreeId]: reqs } })),

  setStatus: (status) =>
    set((s) => ({ statuses: { ...s.statuses, [status.worktreeId]: status } })),

  setAvailability: (availability) => set({ availability }),

  celebrate: (worktreeId) =>
    set((s) =>
      // Already looking at it? Then you watched it finish, and sending its
      // dryad to the grove to be acknowledged would be asking twice.
      s.focusedWorktreeId === worktreeId
        ? {}
        : { celebrating: { ...s.celebrating, [worktreeId]: true } },
    ),

  applyServerEvent: (event) => {
    const s = get();
    switch (event.type) {
      case "agent.event": {
        const list = s.transcripts[event.worktreeId] ?? [];
        s.setTranscript(event.worktreeId, [...list, event.event]);
        if (event.event.kind === "result" && event.event.outcome === "success") {
          s.celebrate(event.worktreeId);
        }
        if (event.worktreeId !== s.focusedWorktreeId) {
          set((st) => ({ unseenActivity: { ...st.unseenActivity, [event.worktreeId]: true } }));
        }
        break;
      }
      case "agent.session":
        s.setSession(event.session.worktreeId, event.session);
        break;
      case "agent.availability":
        s.setAvailability(event.availability);
        break;
      case "permission.request": {
        const list = s.pendingPermissions[event.request.worktreeId] ?? [];
        s.setPermissions(event.request.worktreeId, [...list, event.request]);
        break;
      }
      case "permission.resolved": {
        for (const [wt, reqs] of Object.entries(s.pendingPermissions)) {
          if (reqs.some((r) => r.id === event.requestId)) {
            s.setPermissions(
              wt,
              reqs.filter((r) => r.id !== event.requestId),
            );
          }
        }
        break;
      }
      case "file.batch": {
        const list = s.fileFeed[event.worktreeId] ?? [];
        const next = [...event.events].reverse().concat(list).slice(0, FEED_CAP);
        set((st) => ({
          fileFeed: { ...st.fileFeed, [event.worktreeId]: next },
          unseenActivity:
            event.worktreeId !== st.focusedWorktreeId
              ? { ...st.unseenActivity, [event.worktreeId]: true }
              : st.unseenActivity,
        }));
        break;
      }
      case "git.status":
        s.setStatus(event.status);
        break;
      case "focus.changed":
        s.setFocus(event.worktreeId);
        break;
      case "runner.state":
        s.setRunner(event.state);
        break;
      case "runner.output": {
        const list = s.runnerOutput[event.worktreeId] ?? [];
        // Same cap the server retains, so the two agree on what "the log" is.
        const next = [...list, ...event.lines].slice(-RUNNER_LINE_CAP);
        set((st) => ({ runnerOutput: { ...st.runnerOutput, [event.worktreeId]: next } }));
        break;
      }
    }
  },
}));

/** Derive the sprite state for a worktree from live state. */
export function spriteStateFor(
  s: Pick<SylvaState, "sessions" | "pendingPermissions" | "celebrating">,
  worktreeId: string,
): "idle" | "working" | "success" | "error" {
  const session = s.sessions[worktreeId];
  if (session?.status === "errored") return "error";
  if ((s.pendingPermissions[worktreeId]?.length ?? 0) > 0) return "error";
  if (s.celebrating[worktreeId]) return "success";
  if (session?.status === "running") return "working";
  return "idle";
}
