import { create } from "zustand";
import type {
  AgentAvailability,
  AgentEvent,
  Attachment,
  FileEvent,
  PermissionRequest,
  ServerEvent,
  SessionInfo,
  WorktreeStatus,
} from "sylva-shared";

const FEED_CAP = 200;
const CELEBRATE_MS = 4000;

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

interface SylvaState {
  connection: Connection;
  focusedWorktreeId: string | null;
  sessions: Record<string, SessionInfo>; // by worktreeId
  availability: AgentAvailability;
  transcripts: Record<string, AgentEvent[]>; // by worktreeId
  pendingPermissions: Record<string, PermissionRequest[]>; // by worktreeId
  fileFeed: Record<string, FileEvent[]>; // by worktreeId, newest first
  statuses: Record<string, WorktreeStatus>; // by worktreeId
  celebratingUntil: Record<string, number>; // by worktreeId
  /** Worktrees with activity the user hasn't looked at (unfocused). */
  unseenActivity: Record<string, boolean>;
  /**
   * Unsent prompt text and attachments, by worktreeId. Lives here rather than
   * in AgentPanel because switching tabs unmounts that panel — local state
   * would throw away whatever you'd typed. Keying by worktree also means a
   * half-written prompt survives wandering off to another tree and back.
   */
  drafts: Record<string, Draft>;

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

export const useSylva = create<SylvaState>((set, get) => ({
  connection: "connecting",
  focusedWorktreeId: null,
  sessions: {},
  availability: { available: true },
  transcripts: {},
  pendingPermissions: {},
  fileFeed: {},
  statuses: {},
  celebratingUntil: {},
  unseenActivity: {},
  drafts: {},

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
    set((s) => ({
      focusedWorktreeId,
      unseenActivity: focusedWorktreeId
        ? { ...s.unseenActivity, [focusedWorktreeId]: false }
        : s.unseenActivity,
    })),

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

  celebrate: (worktreeId) => {
    set((s) => ({
      celebratingUntil: { ...s.celebratingUntil, [worktreeId]: Date.now() + CELEBRATE_MS },
    }));
    setTimeout(() => {
      // Nudge a re-render after the celebration window closes.
      set((s) => ({ celebratingUntil: { ...s.celebratingUntil } }));
    }, CELEBRATE_MS + 50);
  },

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
    }
  },
}));

/** Derive the sprite state for a worktree from live state. */
export function spriteStateFor(
  s: Pick<SylvaState, "sessions" | "pendingPermissions" | "celebratingUntil">,
  worktreeId: string,
): "idle" | "working" | "success" | "error" {
  const session = s.sessions[worktreeId];
  if (session?.status === "errored") return "error";
  if ((s.pendingPermissions[worktreeId]?.length ?? 0) > 0) return "error";
  if ((s.celebratingUntil[worktreeId] ?? 0) > Date.now()) return "success";
  if (session?.status === "running") return "working";
  return "idle";
}
