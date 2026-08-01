// Sylva shared types — the contract between server and web.

// ---------- Repos & worktrees ----------

export interface Repo {
  id: string;
  name: string;
  path: string;
  available: boolean;
}

export interface Worktree {
  /** Stable ID derived from the worktree path. */
  id: string;
  repoId: string;
  path: string;
  /** Branch name, or null when HEAD is detached. */
  branch: string | null;
  head: string;
  isMain: boolean;
  isDetached: boolean;
}

// ---------- Git ----------

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface StatusEntry {
  path: string;
  kind: FileChangeKind;
  renamedFrom?: string;
}

export interface WorktreeStatus {
  worktreeId: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  untracked: StatusEntry[];
}

export interface DiffLine {
  type: "context" | "add" | "del";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  renamedFrom?: string;
  binary: boolean;
  hunks: DiffHunk[];
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  /** Worktree path where this branch is checked out, if any. */
  checkedOutAt: string | null;
  worktreeId: string | null;
}

// ---------- Agent sessions ----------

export type SessionStatus = "idle" | "running" | "interrupted" | "errored";

export interface SessionInfo {
  id: string;
  worktreeId: string;
  status: SessionStatus;
  /** SDK session id, present after the first init message. */
  sdkSessionId: string | null;
  totalCostUsd: number;
  totalTokens: number;
  queuedPrompts: QueuedPrompt[];
  createdAt: string;
}

export interface QueuedPrompt {
  id: string;
  text: string;
  queuedAt: string;
}

/** One entry in a session transcript (persisted as JSONL and streamed live). */
export type AgentEvent =
  | { kind: "user-prompt"; text: string; at: string }
  | { kind: "assistant-text"; text: string; at: string }
  | {
      kind: "tool-use";
      toolUseId: string;
      tool: string;
      /** One-line, worktree-relative label for the chat row. */
      summary: string;
      /** Full text behind a truncated summary, when there's more to see. */
      detail?: string;
      input?: unknown;
      at: string;
    }
  | { kind: "tool-result"; toolUseId: string; isError: boolean; summary: string; at: string }
  | {
      kind: "result";
      outcome: "success" | "error" | "interrupted";
      costUsd?: number;
      tokens?: number;
      durationMs?: number;
      at: string;
    }
  | { kind: "error"; message: string; at: string };

export interface PermissionRequest {
  id: string;
  sessionId: string;
  worktreeId: string;
  tool: string;
  /** Human-readable summary, e.g. the bash command or file path. */
  summary: string;
  input: unknown;
  requestedAt: string;
}

export type PermissionAnswer = "allow" | "allow-always" | "deny";

export type AgentAvailability =
  | { available: true }
  | { available: false; reason: string };

// ---------- File activity ----------

export interface FileEvent {
  worktreeId: string;
  path: string;
  change: "added" | "changed" | "deleted";
  at: string;
}

// ---------- WebSocket protocol (server -> client) ----------

export type ServerEvent =
  | { type: "agent.event"; sessionId: string; worktreeId: string; event: AgentEvent }
  | { type: "agent.session"; session: SessionInfo }
  | { type: "agent.availability"; availability: AgentAvailability }
  | { type: "permission.request"; request: PermissionRequest }
  | { type: "permission.resolved"; requestId: string; answer: PermissionAnswer | "timeout" }
  | { type: "file.batch"; worktreeId: string; events: FileEvent[]; truncated: boolean }
  | { type: "git.status"; status: WorktreeStatus }
  | { type: "focus.changed"; worktreeId: string | null };

// ---------- REST payloads ----------

export interface RegisterRepoRequest {
  path: string;
}

export interface CreateWorktreeRequest {
  branch: string;
  /** Create a new branch from this ref; omit to check out an existing branch. */
  baseRef?: string;
  /** Override the default sibling path. */
  path?: string;
}

export interface RemoveWorktreeRequest {
  force?: boolean;
}

export interface CommitRequest {
  message: string;
}

export interface PushRequest {
  setUpstream?: boolean;
}

export interface PromptRequest {
  text: string;
}

export interface PermissionAnswerRequest {
  requestId: string;
  answer: PermissionAnswer;
}

export interface QuickStartRequest {
  repoId: string;
  taskName: string;
  prompt: string;
  baseRef?: string;
}

export interface QuickStartResult {
  worktree: Worktree | null;
  session: SessionInfo | null;
  errors: string[];
}

export interface ApiError {
  error: string;
  detail?: string;
}
