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
  /** Divergence from the repository's base branch (main/master). */
  base: BaseDivergence | null;
}

export interface BaseDivergence {
  /** The branch compared against, e.g. "main" or "origin/main". */
  branch: string;
  /** Commits on this worktree that the base doesn't have. */
  ahead: number;
  /** Commits on the base that this worktree doesn't have. */
  behind: number;
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

/** Reasoning effort, as the Agent SDK defines it. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

export interface ModelChoice {
  id: string;
  label: string;
  note: string;
}

/** Offered in the settings dialog; null means "whatever Claude Code defaults to". */
export const MODEL_CHOICES: ModelChoice[] = [
  { id: "claude-opus-5", label: "Opus 5", note: "Best all-round coding agent" },
  { id: "claude-fable-5", label: "Fable 5", note: "Most capable, highest cost" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "Near-Opus quality, cheaper" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "Fastest, for simple tasks" },
];

export interface WorktreePrefs {
  /**
   * Run the agent with every permission check bypassed. Dangerous: the agent
   * can run any command without asking.
   */
  bypassPermissions: boolean;
  /** Model id, or null to inherit the Claude Code default. */
  model: string | null;
  /** Reasoning effort, or null to inherit the default. */
  effort: EffortLevel | null;
}

export interface Attachment {
  name: string;
  /** Absolute path on this machine, handed to the agent so it can read the file. */
  path: string;
  size: number;
}

export interface SessionInfo {
  id: string;
  worktreeId: string;
  status: SessionStatus;
  /** Permission mode this session is actually running under. */
  bypassPermissions: boolean;
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

export type SetPrefsRequest = WorktreePrefs;

export interface ApiError {
  error: string;
  detail?: string;
}
