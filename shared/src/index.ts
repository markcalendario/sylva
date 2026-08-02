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

/** How much a commit moved, as `git log --shortstat` reports it. */
export interface CommitStats {
  files: number;
  insertions: number;
  deletions: number;
}

/**
 * One commit in the branch diagram.
 *
 * Everything past `relative` is what the hover card shows and the row itself
 * doesn't. Optional because a commit can genuinely lack a body, and because
 * anything already reading this type predates the richer fields.
 */
export interface GraphCommit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  /** Relative age, e.g. "2 hours ago" — formatted by git, not by us. */
  relative: string;
  /** Message below the subject line, verbatim, or "" when there is none. */
  body?: string;
  authorEmail?: string;
  /** Absolute author date, ISO 8601. */
  authorDate?: string;
  committer?: string;
  committerEmail?: string;
  committerDate?: string;
  stats?: CommitStats;
}

/**
 * This branch drawn against its base: what each has that the other doesn't,
 * and the commit where they last agreed.
 */
export interface CommitGraph {
  branch: string | null;
  base: string | null;
  mergeBase: GraphCommit | null;
  /** Commits here but not on base, newest first. */
  ahead: GraphCommit[];
  /** Commits on base but not here, newest first. */
  behind: GraphCommit[];
  /** Shared history below the merge base, for context. */
  common: GraphCommit[];
  /** True when either side was capped, so the UI can say so. */
  truncated: boolean;
}

/** One file a commit touched, as `git show --name-status --numstat` reports it. */
export interface CommitFile {
  path: string;
  kind: FileChangeKind;
  renamedFrom?: string;
  /** Null for binary files, where git counts nothing. */
  insertions: number | null;
  deletions: number | null;
}

/** A commit opened up: what it says, and what it changed. */
export interface CommitDetail {
  commit: GraphCommit;
  files: CommitFile[];
}

export interface TreeEntry {
  name: string;
  /** Worktree-relative path. */
  path: string;
  kind: "dir" | "file";
  size?: number;
}

export interface TreeListing {
  /** Worktree-relative directory, "" for the root. */
  path: string;
  entries: TreeEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  /** True when the file was cut off at the size cap. */
  truncated: boolean;
  /** True when the file isn't text; content is then empty. */
  binary: boolean;
  size: number;
}

export interface FileSearchResult {
  /** Worktree-relative path. */
  path: string;
  name: string;
  /** Higher is a better match; the server sorts, the UI just renders. */
  score: number;
}

export interface FileSearchResponse {
  query: string;
  results: FileSearchResult[];
  /** True when the walk or the result list hit its cap. */
  truncated: boolean;
}

/** One line inside a file that matched a content search. */
export interface ContentMatch {
  /** Worktree-relative path. */
  path: string;
  line: number;
  /** The matching line, trimmed and capped. */
  text: string;
}

export interface ContentSearchResponse {
  query: string;
  matches: ContentMatch[];
  /** Distinct files represented in `matches`. */
  fileCount: number;
  truncated: boolean;
}

export interface PullRequestResult {
  url: string;
  /** "gh" when the PR was created, "compare" when we could only open a form. */
  via: "gh" | "compare";
  draft: boolean;
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

/** A complete, resolved set of agent settings. */
export interface AgentSettings {
  /**
   * Run the agent with every permission check bypassed. Dangerous: the agent
   * can run any command without asking.
   */
  bypassPermissions: boolean;
  /** Model id, or null for the Claude Code default. */
  model: string | null;
  /** Reasoning effort, or null for the Claude Code default. */
  effort: EffortLevel | null;
}

/**
 * Per-worktree overrides. An absent key inherits the global setting; a present
 * key wins — including an explicit null, which means "use the Claude Code
 * default here even though global names something".
 */
export type WorktreeOverrides = Partial<AgentSettings>;

export const GLOBAL_DEFAULTS: AgentSettings = {
  bypassPermissions: false,
  model: null,
  effort: null,
};

/**
 * What an Open button hands the worktree to. Only the editor: a shell is no
 * longer somewhere else to go, because the Terminal tab is one.
 */
export type OpenKind = "editor";

export type OpenTarget = "vscode" | "cursor" | "zed" | "custom" | "none";

export interface OpenChoice {
  id: OpenTarget;
  label: string;
  note: string;
}

export const EDITOR_TARGETS: OpenChoice[] = [
  { id: "vscode", label: "VS Code", note: "needs the `code` command on your PATH" },
  { id: "cursor", label: "Cursor", note: "needs the `cursor` command on your PATH" },
  { id: "zed", label: "Zed", note: "needs the `zed` command on your PATH" },
  { id: "custom", label: "Custom command", note: "{path} is replaced by the worktree" },
  { id: "none", label: "Off", note: "hide the editor button" },
];

// ---------- Terminals ----------

export type TerminalStatus = "running" | "exited";

/**
 * One shell, in one worktree. Several may exist per worktree — a dev server in
 * the first and whatever you need to type in the second is the ordinary case,
 * and it is the reason this is a terminal rather than a run button.
 */
export interface TerminalInfo {
  id: string;
  worktreeId: string;
  /** Repository the worktree belongs to, for labelling a shared dryad's tabs. */
  repoId: string;
  /** What the tab says. The shell's name, or the command it was opened to run. */
  title: string;
  /** Program the pty is running, e.g. /bin/zsh. */
  shell: string;
  cwd: string;
  status: TerminalStatus;
  /** Exit code once it's gone; negative means it was signalled. */
  exitCode: number | null;
  cols: number;
  rows: number;
  startedAt: string;
  exitedAt: string | null;
}

/**
 * Everything a freshly attached client needs to draw a terminal it wasn't
 * watching: the retained output, and the sequence number that output ends at,
 * so live chunks that arrived while the request was in flight can be told from
 * the ones already in `data`.
 */
export interface TerminalBuffer {
  info: TerminalInfo;
  data: string;
  seq: number;
}

export interface CreateTerminalRequest {
  cols?: number;
  rows?: number;
  /** Typed into the shell once it's up, as if you had typed it yourself. */
  command?: string;
}

/**
 * The session that belongs to no worktree. A reserved id rather than a separate
 * type: worktree ids are path hashes, so this cannot collide with one, and every
 * map already keyed by worktree id keeps working untouched.
 */
export const GROVE_ID = "grove";

/**
 * One dryad tending several worktrees at once, so it can carry what it learned
 * in the old system across into the new one.
 *
 * The id *is* the membership — `circle-<id>-<id>` — rather than a key into a
 * registry somewhere. Nothing to store, nothing to garbage-collect, and picking
 * the same set of worktrees again lands you back in the same conversation,
 * because the transcript was keyed by this id all along.
 */
export const CIRCLE_PREFIX = "circle-";

/** Build the id for a set of worktrees. Order doesn't matter; the id is stable. */
export function circleId(worktreeIds: string[]): string {
  return CIRCLE_PREFIX + [...new Set(worktreeIds)].sort().join("-");
}

/** The worktrees behind a circle id, or null when this isn't one. */
export function circleMembers(id: string): string[] | null {
  if (!id.startsWith(CIRCLE_PREFIX)) return null;
  const members = id.slice(CIRCLE_PREFIX.length).split("-").filter(Boolean);
  // One worktree is not a circle — it is just that worktree, and treating it as
  // one would fork its conversation into a second transcript.
  return members.length >= 2 ? members : null;
}

/** True for any id that names a session rather than a plain worktree. */
export function isSharedTarget(id: string): boolean {
  return id === GROVE_ID || circleMembers(id) !== null;
}

/** A reusable prompt snippet, appended to whatever is already typed. */
export interface SavedPrompt {
  id: string;
  label: string;
  text: string;
}

/**
 * App-level preferences. Separate from AgentSettings because these describe
 * Sylva itself rather than how an agent runs, and nothing overrides them
 * per worktree.
 */
export interface AppPreferences {
  /** Editor the ⌥ Code button opens. */
  editorTarget: OpenTarget;
  /** Command template used when editorTarget is "custom"; {path} is substituted. */
  editorCommand: string;
  /** Shell the Terminal tab spawns. Empty means whatever $SHELL says. */
  terminalShell: string;
  savedPrompts: SavedPrompt[];
}

export const PREFERENCE_DEFAULTS: AppPreferences = {
  editorTarget: "vscode",
  editorCommand: "",
  terminalShell: "",
  savedPrompts: [
    {
      id: "review",
      label: "Review my changes",
      text: "Review the staged and unstaged changes in this worktree. Flag anything that looks wrong before I commit.",
    },
    {
      id: "tests",
      label: "Run the tests",
      text: "Run the test suite and fix whatever fails. Show me the failures before you change anything.",
    },
    {
      id: "explain",
      label: "Explain this code",
      text: "Explain how this part of the codebase works, and point out anything surprising.",
    },
  ],
};

export interface WorktreeSettings {
  overrides: WorktreeOverrides;
  /** Global merged with overrides — what the session actually runs with. */
  effective: AgentSettings;
  global: AgentSettings;
}

// ---------- filesystem browsing (for the repo picker) ----------

export interface DirEntry {
  name: string;
  path: string;
  /** True when the directory is itself a git repository. */
  isRepo: boolean;
  /** True when the name starts with a dot. */
  hidden: boolean;
}

export interface DirListing {
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  /** True when this directory is a git repository. */
  isRepo: boolean;
  entries: DirEntry[];
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
  /**
   * Branch the session is running on. Carried here so anything that has to
   * name a worktree — notifications, the blocked-agent list — can do it
   * without waiting on a separate worktree fetch.
   */
  branch: string | null;
  status: SessionStatus;
  /** The resolved settings this session is actually running under. */
  settings: AgentSettings;
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
  | { type: "focus.changed"; worktreeId: string | null }
  /**
   * HEAD moved in a worktree — a checkout, a branch rename, a rebase. Sent
   * alongside git.status because the branch *name* is carried by the worktree
   * list, which is fetched rather than streamed and so would otherwise stay
   * stale until a reload.
   */
  | { type: "worktrees.changed"; repoId: string | null }
  | { type: "terminal.state"; info: TerminalInfo }
  | { type: "terminal.closed"; terminalId: string }
  /**
   * Raw pty output. Sequenced rather than timestamped: a terminal is a byte
   * stream, and the only question a client ever has about a chunk is whether it
   * already has it.
   */
  | { type: "terminal.output"; terminalId: string; seq: number; data: string };

// ---------- WebSocket protocol (client -> server) ----------

/**
 * The only things a client sends up the socket, both of them terminal input.
 * Everything else Sylva does is a REST call — but a keystroke can't wait for a
 * round trip through fetch, and neither can a drag of the window edge.
 */
export type ClientEvent =
  | { type: "terminal.input"; terminalId: string; data: string }
  | { type: "terminal.resize"; terminalId: string; cols: number; rows: number };

// ---------- REST payloads ----------

export interface RegisterRepoRequest {
  path: string;
}

export interface CreateRepoRequest {
  /** Directory the new repository's folder is created inside. */
  parentPath: string;
  /** Folder name; also the repository's name. */
  name: string;
}

/**
 * Every worktree a pane currently holds. The server watches this set, so a
 * worktree in the second pane streams just as live as the one in the first.
 */
export interface OpenWorktreesRequest {
  worktreeIds: string[];
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

/**
 * One message, several worktrees. Deliberately not atomic — git has no
 * cross-repository transaction, and faking one by resetting the commits that
 * did land would be far more dangerous than reporting what happened.
 */
export interface CommitManyRequest {
  worktreeIds: string[];
  message: string;
}

export interface CommitOutcome {
  worktreeId: string;
  ok: boolean;
  /** New HEAD when it landed. */
  head?: string;
  /** Why it didn't, in git's own words. */
  error?: string;
}

export interface CommitManyResult {
  results: CommitOutcome[];
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

export type SetGlobalSettingsRequest = AgentSettings;
export type SetWorktreeOverridesRequest = WorktreeOverrides;

export interface ApiError {
  error: string;
  detail?: string;
}
