import { create } from "zustand";
import type {
  AgentAvailability,
  AgentEvent,
  Attachment,
  FileEvent,
  PermissionRequest,
  ServerEvent,
  SessionInfo,
  TerminalInfo,
  Worktree,
  WorktreeStatus,
} from "sylva-shared";
import { circleId, circleMembers, GROVE_ID } from "sylva-shared";
import { api } from "../lib/api";

const FEED_CAP = 200;

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

export type Tab = "agent" | "files" | "git" | "terminal";

/**
 * The tabs a pane can show, in the order the strip lays them out. Cycling with
 * the keyboard walks this list, so the order here *is* the order you step
 * through — the tab strip reads from it rather than repeating it.
 */
export const TABS: readonly Tab[] = ["agent", "files", "git", "terminal"];

/**
 * One side of the workspace. Migrating an old system to a new one means two
 * repositories open at once, so what used to be "the focused worktree" is now
 * a small list of them — each with its own tab and its own selected diff,
 * because a pane you switch to Git shouldn't drag the other pane along.
 */
/**
 * A file being looked at. Carries its worktree because a path alone is
 * ambiguous the moment two of them are in view — both may have a
 * `src/index.ts`, and the wrong one would render with nothing to say so.
 */
export interface DiffSelection {
  worktreeId: string;
  path: string;
  staged: boolean;
  /**
   * A commit, when the file is being read as that commit left it rather than as
   * it is now. Absent for the working tree, which is the ordinary case.
   */
  commit?: string;
}

export interface Pane {
  id: string;
  /** A worktree, the grove, or a circle of worktrees sharing one dryad. */
  worktreeId: string | null;
  tab: Tab;
  diff: DiffSelection | null;
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
const SIDEBAR_KEY = "sylva.sidebarCollapsed";
const CIRCLES_KEY = "sylva.circles";
const TABS_KEY = "sylva.tabsByWorktree";

function loadList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveList(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota; the list just won't survive a reload.
  }
}

/** Small booleans that should outlive a reload. Failing to read one is fine. */
function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Private mode or a full quota; the preference just won't stick.
  }
}

function isTab(value: unknown): value is Tab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

/**
 * Which tab each worktree was last left on. A pane is a window onto a worktree,
 * not a mode you put the app into: leaving one tree at its Terminal and opening
 * another shouldn't drag you into that tree's terminal too, which is exactly
 * what a pane-level tab did.
 */
function loadTabs(): Record<string, Tab> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, Tab] =>
        isTab(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function saveTabs(tabs: Record<string, Tab>): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // Private mode or a full quota; the memory just won't survive a reload.
  }
}

function freshPane(worktreeId: string | null = null): Pane {
  return {
    id: Math.random().toString(36).slice(2, 9),
    worktreeId,
    tab: "agent",
    diff: null,
  };
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
      // "run" is what the terminal tab used to be called; a layout saved before
      // the rename still means the same place.
      tab:
        p.tab === "files" || p.tab === "git" || p.tab === "terminal"
          ? p.tab
          : (p.tab as string) === "run"
            ? "terminal"
            : "agent",
      // A layout saved before selections carried their worktree has nothing
      // worth migrating — the path alone can't say which worktree it meant.
      diff: null,
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

  /**
   * Bumped whenever the server says the worktree list is stale — a checkout, a
   * branch rename. Anything holding a fetched list watches this and refetches.
   */
  worktreesRevision: number;

  /** Layout of the main area. */
  panes: Pane[];
  activePaneId: string;
  /**
   * The tab each worktree was last read on, so opening one puts you back where
   * you left it rather than wherever the pane happened to be.
   */
  tabByWorktree: Record<string, Tab>;
  view: View;
  /**
   * Every terminal the server holds, by terminal id. Only what a tab strip
   * needs — which worktree it belongs to, what it's called, whether its shell
   * is still alive. The bytes on screen never come through here: they go
   * straight from the socket to the emulator that draws them.
   */
  terminals: Record<string, TerminalInfo>;
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
  /**
   * Step the active pane one tab along the strip, wrapping at both ends — from
   * Terminal forward lands back on Agent. What Option+Tab is wired to.
   */
  cycleActiveTab: (direction: 1 | -1) => void;
  setPaneDiff: (paneId: string, diff: DiffSelection | null, tab?: Tab) => void;
  splitPane: () => void;
  closePane: (paneId: string) => void;
  /** Open a worktree in whichever pane is active — what the sidebar calls. */
  openWorktree: (worktreeId: string) => void;
  /** Put several worktrees under one dryad and open that. */
  openCircle: (worktreeIds: string[]) => void;

  /**
   * Worktrees picked for a shared dryad, or null when not picking. Selection is
   * modal because the ordinary click already means "open this" — shift-clicking
   * is how you say you meant something else.
   */
  selection: string[] | null;
  /**
   * Circles you've made, newest first. Kept because a circle is only an id —
   * there is nothing on the server to list — so without this a shared dryad
   * would vanish from the sidebar the moment you opened something else, even
   * though its conversation is still there waiting.
   */
  knownCircles: string[];
  rememberCircle: (id: string) => void;
  forgetCircle: (id: string) => void;
  beginSelection: (worktreeId: string) => void;
  toggleSelection: (worktreeId: string) => void;
  clearSelection: () => void;

  /** Hidden sidebar, for when the work deserves the whole window. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setTerminal: (info: TerminalInfo) => void;
  removeTerminal: (terminalId: string) => void;
  seedTerminals: (infos: TerminalInfo[]) => void;

  setConnection: (c: Connection) => void;
  setDraft: (worktreeId: string, patch: Partial<Draft>) => void;
  clearDraft: (worktreeId: string) => void;
  setFocus: (worktreeId: string | null) => void;
  setTranscript: (worktreeId: string, events: AgentEvent[]) => void;
  setSession: (worktreeId: string, session: SessionInfo | null) => void;
  setPermissions: (worktreeId: string, reqs: PermissionRequest[]) => void;
  /** Drop everything we hold about one dryad's conversation. */
  forgetSession: (worktreeId: string) => void;
  setStatus: (status: WorktreeStatus) => void;
  seedFileFeed: (worktreeId: string, events: FileEvent[]) => void;
  setAvailability: (a: AgentAvailability) => void;
  celebrate: (worktreeId: string) => void;
  /** Clear the "look at me" state of everything currently on screen. */
  acknowledgeVisible: () => void;
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

  worktreesRevision: 0,

  panes: initialPanes,
  activePaneId: initialPanes[0]?.id ?? "",
  tabByWorktree: loadTabs(),
  view: "workspace",
  terminals: {},
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
      // The tab comes from the worktree being opened, not from the pane: you
      // were on Terminal in *that* tree for a reason, and it isn't a reason to
      // put every other tree into its terminal too. A tree never opened before
      // starts where every conversation starts.
      const tab = (worktreeId && s.tabByWorktree[worktreeId]) || "agent";
      const panes = s.panes.map((p) =>
        // The diff is dropped either way — it belonged to the old worktree.
        p.id === paneId ? { ...p, worktreeId, tab, diff: null } : p,
      );
      savePanes(panes);
      return { panes };
    }),

  setPaneTab: (paneId, tab) =>
    set((s) => {
      const panes = s.panes.map((p) => (p.id === paneId ? { ...p, tab } : p));
      savePanes(panes);
      const worktreeId = s.panes.find((p) => p.id === paneId)?.worktreeId;
      if (!worktreeId) return { panes };
      const tabByWorktree = { ...s.tabByWorktree, [worktreeId]: tab };
      saveTabs(tabByWorktree);
      return { panes, tabByWorktree };
    }),

  cycleActiveTab: (direction) =>
    set((s) => {
      // Only the workspace has a tab strip; Settings and the grove cover it, and
      // a shortcut that silently moved a hidden pane would be a surprise later.
      if (s.view !== "workspace") return {};
      const pane = s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0];
      // An empty pane renders no tabs, so there is nothing to step through.
      if (!pane?.worktreeId) return {};
      const at = TABS.indexOf(pane.tab);
      const tab = TABS[(at + direction + TABS.length) % TABS.length];
      if (!tab || tab === pane.tab) return {};
      const panes = s.panes.map((p) => (p.id === pane.id ? { ...p, tab } : p));
      savePanes(panes);
      // Stepping with the keyboard is still choosing a tab for this worktree.
      const tabByWorktree = { ...s.tabByWorktree, [pane.worktreeId]: tab };
      saveTabs(tabByWorktree);
      return { panes, tabByWorktree };
    }),

  setPaneDiff: (paneId, diff, tab) =>
    set((s) => {
      const panes = s.panes.map((p) =>
        p.id === paneId ? { ...p, diff, ...(tab ? { tab } : {}) } : p,
      );
      const worktreeId = s.panes.find((p) => p.id === paneId)?.worktreeId;
      if (!tab || !worktreeId) return { panes };
      const tabByWorktree = { ...s.tabByWorktree, [worktreeId]: tab };
      saveTabs(tabByWorktree);
      return { panes, tabByWorktree };
    }),

  /**
   * Split by copying the active pane rather than opening an empty one: you
   * split because you want to see two things, and one of them is already here.
   */
  splitPane: () =>
    set((s) => {
      if (s.panes.length >= 2) return {};
      const active = s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0];
      const worktreeId = active?.worktreeId ?? null;
      const created = {
        ...freshPane(worktreeId),
        // Same worktree, same place in it — a split that landed on Agent while
        // you were reading a diff would be a second thing to undo.
        tab: active?.tab ?? "agent",
      };
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

  openCircle: (worktreeIds) => {
    const s = get();
    const id = circleId(worktreeIds);
    const paneId = s.panes.find((p) => p.id === s.activePaneId)?.id ?? s.panes[0]?.id;
    if (paneId) s.setPaneWorktree(paneId, id);
    s.rememberCircle(id);
    set({ selection: null, view: "workspace" });
    // Focus the first member so the status strip and the watcher have a
    // worktree to talk about; the circle itself is not one.
    const first = circleMembers(id)?.[0];
    if (first) void api.setFocus(first);
  },

  selection: null,

  knownCircles: loadList(CIRCLES_KEY),

  rememberCircle: (id) =>
    set((s) => {
      const knownCircles = [id, ...s.knownCircles.filter((c) => c !== id)].slice(0, 12);
      saveList(CIRCLES_KEY, knownCircles);
      return { knownCircles };
    }),

  forgetCircle: (id) =>
    set((s) => {
      const knownCircles = s.knownCircles.filter((c) => c !== id);
      saveList(CIRCLES_KEY, knownCircles);
      return { knownCircles };
    }),

  beginSelection: (worktreeId) => set({ selection: [worktreeId] }),

  toggleSelection: (worktreeId) =>
    set((s) => {
      if (!s.selection) return {};
      const next = s.selection.includes(worktreeId)
        ? s.selection.filter((id) => id !== worktreeId)
        : [...s.selection, worktreeId];
      // Unpicking the last one leaves selection mode rather than stranding you
      // in it with nothing chosen.
      return { selection: next.length === 0 ? null : next };
    }),

  clearSelection: () => set({ selection: null }),

  sidebarCollapsed: loadFlag(SIDEBAR_KEY),

  toggleSidebar: () =>
    set((s) => {
      const sidebarCollapsed = !s.sidebarCollapsed;
      saveFlag(SIDEBAR_KEY, sidebarCollapsed);
      return { sidebarCollapsed };
    }),

  setTerminal: (info) => set((s) => ({ terminals: { ...s.terminals, [info.id]: info } })),

  removeTerminal: (terminalId) =>
    set((s) => {
      if (!s.terminals[terminalId]) return {};
      const terminals = { ...s.terminals };
      delete terminals[terminalId];
      return { terminals };
    }),

  /**
   * Replace what we think exists with what the server says exists. Terminals
   * live on the server and die with it, so a reconnect is the moment to stop
   * believing anything we remember.
   */
  seedTerminals: (infos) =>
    set(() => ({ terminals: Object.fromEntries(infos.map((info) => [info.id, info])) })),

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

  /**
   * Focus is now only "which worktree the server should treat as primary". It
   * used to double as the acknowledgement, which broke twice over once panes
   * existed: focus stays put while the Forest or Settings covers the screen, so
   * a finished turn was never celebrated; and re-opening an already-focused
   * worktree changes nothing, so the server never broadcasts and a celebration
   * that had started was never cleared. Acknowledgement lives in
   * acknowledgeVisible now, which asks what is actually on screen.
   */
  setFocus: (focusedWorktreeId) => set({ focusedWorktreeId }),

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

  /**
   * Everything keyed by this worktree that described the old conversation. The
   * draft is spared on purpose — clearing is usually the prelude to asking
   * again, and throwing away what you'd already typed would be a second,
   * unasked-for deletion.
   */
  forgetSession: (worktreeId) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const transcripts = { ...s.transcripts };
      const pendingPermissions = { ...s.pendingPermissions };
      const celebrating = { ...s.celebrating };
      const unseenActivity = { ...s.unseenActivity };
      delete sessions[worktreeId];
      delete transcripts[worktreeId];
      delete pendingPermissions[worktreeId];
      delete celebrating[worktreeId];
      delete unseenActivity[worktreeId];
      return { sessions, transcripts, pendingPermissions, celebrating, unseenActivity };
    }),

  setStatus: (status) =>
    set((s) => ({ statuses: { ...s.statuses, [status.worktreeId]: status } })),

  setAvailability: (availability) => set({ availability }),

  celebrate: (worktreeId) =>
    set((s) =>
      // Already looking at it? Then you watched it finish, and sending its
      // dryad to the grove to be acknowledged would be asking twice.
      isWatching(s, worktreeId)
        ? {}
        : { celebrating: { ...s.celebrating, [worktreeId]: true } },
    ),

  /**
   * Acknowledge everything on screen. Called whenever what's on screen changes
   * — a pane loads something, the view switches, the tab comes back — because
   * that is the moment the news is actually delivered.
   */
  acknowledgeVisible: () =>
    set((s) => {
      const seen = [...s.panes.map((p) => p.worktreeId), GROVE_ID].filter(
        (id): id is string => id !== null && isWatching(s, id),
      );
      if (seen.length === 0) return {};

      const celebrating = { ...s.celebrating };
      const unseenActivity = { ...s.unseenActivity };
      let changed = false;
      for (const id of seen) {
        if (celebrating[id]) {
          delete celebrating[id];
          changed = true;
        }
        if (unseenActivity[id]) {
          unseenActivity[id] = false;
          changed = true;
        }
      }
      // Same objects back when nothing moved: this runs on every pane change.
      return changed ? { celebrating, unseenActivity } : {};
    }),

  applyServerEvent: (event) => {
    const s = get();
    switch (event.type) {
      case "agent.event": {
        const list = s.transcripts[event.worktreeId] ?? [];
        s.setTranscript(event.worktreeId, [...list, event.event]);
        if (event.event.kind === "result" && event.event.outcome === "success") {
          s.celebrate(event.worktreeId);
        }
        if (!isWatching(s, event.worktreeId)) {
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
      case "agent.cleared":
        s.forgetSession(event.worktreeId);
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
          unseenActivity: isWatching(st, event.worktreeId)
            ? st.unseenActivity
            : { ...st.unseenActivity, [event.worktreeId]: true },
        }));
        break;
      }
      case "git.status":
        s.setStatus(event.status);
        break;
      case "focus.changed":
        s.setFocus(event.worktreeId);
        break;
      case "worktrees.changed":
        set((st) => ({ worktreesRevision: st.worktreesRevision + 1 }));
        break;
      case "terminal.state":
        s.setTerminal(event.info);
        break;
      case "terminal.closed":
        s.removeTerminal(event.terminalId);
        break;
      case "terminal.output":
        // Handled where it is drawn, not here: pty output is a byte stream at
        // keystroke frequency, and putting it through the store would re-render
        // the application for every character echoed.
        break;
    }
  },
}));

/**
 * Is the user actually looking at this target right now?
 *
 * Focus used to answer this and no longer can. A pane keeps holding a worktree
 * while the Forest map or the Settings page fills the main area, and the whole
 * tab can be in the background — in all of which the worktree is focused and
 * quite invisible.
 */
export function isWatching(
  s: Pick<SylvaState, "view" | "panes">,
  targetId: string,
): boolean {
  if (typeof document !== "undefined" && document.hidden) return false;
  if (targetId === GROVE_ID) return s.view === "grove";
  if (s.view !== "workspace") return false;
  return s.panes.some((p) => p.worktreeId === targetId);
}

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
