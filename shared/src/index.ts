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

/**
 * What fetching before a worktree was created actually changed.
 *
 * Reported rather than assumed: "pull first" can mean nothing happened (no
 * remote), or that the new branch quietly started from `origin/main` instead
 * of the stale `main` you named — and the second is worth being told.
 */
export interface WorktreePull {
  /** True when there was a remote and the fetch ran. */
  fetched: boolean;
  /** The ref the worktree actually started from, when it wasn't the one asked for. */
  basedOn: string | null;
  /** The local branch fast-forwarded onto its upstream, when one was. */
  fastForwarded: string | null;
}

/**
 * A worktree that has just been grown, and what was carried into it that git
 * would not have brought itself. Reported rather than done silently: copying a
 * file nobody asked about into a new directory should be visible.
 */
export interface CreatedWorktree {
  worktree: Worktree;
  /** Paths, relative to the worktree root, of the env files copied across. */
  copiedEnvFiles: string[];
  /** What the pre-creation fetch did, or null when it wasn't asked for. */
  pull: WorktreePull | null;
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

/** How GitHub's checks finished on a head commit, rolled up to one word. */
export type ChecksState = "passing" | "failing" | "pending" | "none";

/**
 * The pull request for the branch a worktree is standing on.
 *
 * Everything here comes from one `gh pr view` — which answers only for the
 * current branch, and so cannot describe any other. That narrowness is the
 * point: the Git tab wants the PR you are working in, not a list to pick from.
 */
export interface CurrentPullRequest {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  /** "OPEN", "MERGED" or "CLOSED", as GitHub spells it. */
  state: string;
  branch: string;
  baseBranch: string;
  author: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Rolled up from the head commit's status checks. */
  checks: ChecksState;
  /** Counts behind the rollup, for the tooltip. */
  checksPassed: number;
  checksFailed: number;
  checksPending: number;
  /** "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", or null when unknown. */
  reviewDecision: string | null;
  /** Whether GitHub thinks it merges cleanly: "MERGEABLE", "CONFLICTING", … */
  mergeable: string | null;
  commentCount: number;
}

export interface CurrentPullRequestResponse {
  /** Null when the branch has no PR, or when `gh` couldn't be asked. */
  pull: CurrentPullRequest | null;
  /**
   * Why there is no PR to show, in a sentence. Null when the branch simply
   * hasn't got one — that is an ordinary state, not a problem to explain.
   */
  reason: string | null;
  /** The compare page, so "no PR yet" is still a way forward. */
  createUrl: string | null;
}

/**
 * Who last touched one line, and in which commit.
 *
 * `committed` is false for a line that only exists in the working tree — git
 * blames those to a zero sha and the name "Not Committed Yet", which is a fact
 * worth reporting plainly rather than passing through as an author.
 */
export interface LineBlame {
  line: number;
  committed: boolean;
  sha: string;
  /** Short sha, ready to show. Empty for an uncommitted line. */
  shortSha: string;
  author: string;
  authorEmail: string;
  /** ISO 8601, or empty when uncommitted. */
  authoredAt: string;
  /** The commit's subject line. */
  summary: string;
}

/**
 * Which lines of a file differ from the last commit.
 *
 * Line numbers are in the file as it is now, which is what the editor draws —
 * deletions have no line to mark and so are simply absent.
 */
export interface ChangedLines {
  path: string;
  /** Lines added since the last commit. */
  added: number[];
  /** Lines whose content changed. */
  modified: number[];
  /** False when the file is untracked, where "changed" means all of it. */
  tracked: boolean;
}

/** One worktree's contribution to the fleet digest. */
export interface FleetEntry {
  worktreeId: string;
  repoId: string;
  repoName: string;
  branch: string | null;
  /** Null when the worktree couldn't be read. */
  status: WorktreeStatus | null;
  /** Why it couldn't, when it couldn't. */
  error: string | null;
}

export interface FleetDigest {
  entries: FleetEntry[];
}

/** What a transcript search is asking: about a file, or about words said. */
export type TranscriptSearchMode = "file" | "text";

/** One moment in one dryad's conversation that matched a search. */
export interface TranscriptHit {
  sessionId: string;
  /** The worktree, circle or grove the session belonged to. */
  worktreeId: string;
  repoId: string;
  at: string;
  kind: "tool-use" | "user-prompt" | "assistant-text";
  /** Which tool, when the match was a step rather than something said. */
  tool?: string;
  /** The matching line, trimmed to something a row can hold. */
  summary: string;
  /** The file the step was about, when the transcript recorded one. */
  file?: { worktreeId: string; path: string };
}

export interface TranscriptSearchResponse {
  query: string;
  mode: TranscriptSearchMode;
  /** Newest first — what a dryad did an hour ago beats last Tuesday. */
  hits: TranscriptHit[];
  /** How many conversations were read, so "no hits" can be told from "nothing to read". */
  sessionsSearched: number;
  /** True when the cap was reached and there is more than this. */
  truncated: boolean;
}

/**
 * One rate-limit window on a Claude plan: how much of it is spent, and when it
 * refills. Both are nullable because the server may know a window exists
 * without yet knowing its numbers.
 */
export interface UsageWindow {
  /** Percentage of the window used, 0–100. */
  utilization: number | null;
  /** ISO 8601 timestamp when the window resets. */
  resetsAt: string | null;
}

/**
 * What is left of your Claude plan, as the `/usage` command sees it.
 *
 * This replaced the dollar figures Sylva used to show. A session cost in USD is
 * a number nobody acts on when the plan is a subscription — what actually
 * stops work is the weekly window running out, and that is what this reports.
 */
export interface PlanUsage {
  /** False for API-key, Bedrock and Vertex sessions, where plan limits don't apply. */
  available: boolean;
  /** "pro", "max", "team", "enterprise", or null when not a claude.ai plan. */
  subscription: string | null;
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  /** Per-model weekly windows, when the server reports them. */
  models: { name: string; utilization: number | null; resetsAt: string | null }[];
  /** Why there are no numbers, when there are none. */
  reason: string | null;
  /** When this snapshot was taken, so the client can say how stale it is. */
  fetchedAt: string;
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

/**
 * How much the agent has to ask before it acts.
 *
 * Three, and each one is a thing the Agent SDK actually does rather than a
 * label over the same behaviour:
 *
 * - `supervised` stops before every command *and* every file change.
 * - `acceptEdits` writes files freely and stops before running anything. This
 *   is the useful middle: an edit is visible in the diff and revertible, and a
 *   command is neither.
 * - `full` asks nothing, including before deletes, history rewrites and
 *   pushes, and the shell it runs in can reach the whole machine.
 */
export type PermissionMode = "supervised" | "acceptEdits" | "full";

export const PERMISSION_MODES: PermissionMode[] = ["supervised", "acceptEdits", "full"];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return (PERMISSION_MODES as string[]).includes(value as string);
}

/**
 * Read a mode from settings that may predate it.
 *
 * Settings were a boolean — `bypassPermissions` — saved to disk in every
 * installation that existed before this. `true` was "ask nothing", and `false`
 * was the SDK's acceptEdits, so that is what each becomes. Anything else is a
 * file written by hand, and the safest reading of a file we don't understand
 * is the mode that asks the most.
 */
export function toPermissionMode(value: unknown): PermissionMode {
  if (isPermissionMode(value)) return value;
  if (value === true) return "full";
  if (value === false) return "acceptEdits";
  return "supervised";
}

/** A complete, resolved set of agent settings. */
export interface AgentSettings {
  /** How much the agent has to ask before it acts. */
  permissionMode: PermissionMode;
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
  // The behaviour Sylva has always had, now that it has a name.
  permissionMode: "acceptEdits",
  model: null,
  effort: null,
};

/**
 * What an Open button hands the worktree to.
 *
 * The editor, a real terminal window, or the desktop's own file browser. The
 * first two are configurable because everyone has a favourite; the last is
 * not — there is exactly one file browser per platform, and asking someone to
 * name it would be a setting with a single right answer.
 *
 * The Terminal tab is still the shell you want nearly always, already in the
 * right directory and beside the diff. "terminal" here is for the times it
 * isn't: a full-screen TUI, a long build you want to keep watching after
 * closing Sylva, tmux, anything your own terminal does that a tab can't.
 */
export type OpenKind = "editor" | "reveal" | "terminal";

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

/**
 * Which terminal application a worktree is opened in.
 *
 * "system" is whatever this desktop ships with — Terminal on a Mac, Windows
 * Terminal on Windows, the one X says is the default elsewhere — and is the
 * choice that needs no explanation. The named ones are the terminals people
 * actually go out and install instead.
 */
export type TerminalTarget = "system" | "iterm" | "warp" | "ghostty" | "kitty" | "custom" | "none";

export interface TerminalChoice {
  id: TerminalTarget;
  label: string;
  note: string;
  /** Platforms this one exists on. Absent means everywhere. */
  macOnly?: boolean;
}

export const TERMINAL_TARGETS: TerminalChoice[] = [
  { id: "system", label: "System terminal", note: "whatever this desktop opens by default" },
  { id: "iterm", label: "iTerm2", note: "macOS only", macOnly: true },
  { id: "warp", label: "Warp", note: "needs Warp installed" },
  { id: "ghostty", label: "Ghostty", note: "needs Ghostty installed" },
  { id: "kitty", label: "kitty", note: "needs kitty installed" },
  { id: "custom", label: "Custom command", note: "{path} is replaced by the worktree" },
  { id: "none", label: "Off", note: "hide the terminal action" },
];

/**
 * A slash command the agent understands — a built-in like `/clear`, a skill, a
 * project command from `.claude/commands`, whatever this directory offers.
 *
 * Read from Claude Code rather than listed here, because the answer is
 * different in every worktree: a repository's own commands and skills are part
 * of it, and a list Sylva kept would be a list that is wrong for most people.
 */
export interface AgentCommand {
  /** Name without the leading slash. */
  name: string;
  description: string;
  /** What the command expects after it, e.g. "<file>". Empty when nothing. */
  argumentHint: string;
  /** Other names that reach the same command. */
  aliases?: string[];
}

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
  /** Terminal application "Open in terminal" launches on the worktree. */
  terminalApp: TerminalTarget;
  /** Command template used when terminalApp is "custom"; {path} is substituted. */
  terminalAppCommand: string;
  /**
   * How many lines of output a terminal keeps behind the top of the screen.
   *
   * Scrollback is held in the browser, one cell object per character, so this
   * is the number that decides whether four terminals running a build are free
   * or are the reason the window has started to stutter.
   */
  terminalScrollback: number;
  /**
   * Carry `.env` files from the main worktree into every new one.
   *
   * They are gitignored, which is the whole point of them, and so `git worktree
   * add` leaves them behind — the new tree checks out and then can't start. On
   * by default because a worktree that can't run is the wrong default.
   */
  copyEnvFiles: boolean;
  /**
   * Fetch from the remote before growing a worktree.
   *
   * A worktree is only as current as the ref it was cut from, and the ref you
   * name is nearly always a local branch someone last updated on Tuesday. On by
   * default because starting a week of work on a stale base is the expensive
   * mistake, and a fetch is the cheap one.
   */
  pullBeforeWorktree: boolean;
}

/**
 * What a terminal's scrollback may be set to.
 *
 * The floor is a screenful and a bit — below it "scroll back" stops meaning
 * anything. The ceiling is where a single terminal starts costing hundreds of
 * megabytes, which is not a limit worth letting someone opt into by typing a
 * number into a box.
 */
export const TERMINAL_SCROLLBACK_MIN = 100;
export const TERMINAL_SCROLLBACK_MAX = 50_000;

/** Clamp a scrollback to the range a terminal will actually accept. */
export function clampScrollback(lines: number): number {
  if (!Number.isFinite(lines)) return PREFERENCE_DEFAULTS.terminalScrollback;
  return Math.min(TERMINAL_SCROLLBACK_MAX, Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(lines)));
}

export const PREFERENCE_DEFAULTS: AppPreferences = {
  editorTarget: "vscode",
  editorCommand: "",
  terminalShell: "",
  terminalApp: "system",
  terminalAppCommand: "",
  // A thousand lines is a long build's worth of tail and costs almost nothing.
  // It used to be ten thousand, which nobody asked for and everybody paid for.
  terminalScrollback: 1_000,
  copyEnvFiles: true,
  pullBeforeWorktree: true,
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
  /**
   * Work the dryad left running beside its own turn — a backgrounded subagent,
   * a task that will wake it when it reports back.
   *
   * Deliberately not folded into `status`. That word answers "is it this
   * dryad's turn", which is what decides whether your next prompt is sent or
   * queued, and background work isn't its turn: you can talk to it while a
   * subagent grinds away. But the dryad is plainly not resting either, which is
   * what everything that draws one needs to know.
   */
  backgroundTasks: BackgroundTask[];
  createdAt: string;
}

/** One piece of background work, named the way the agent named it. */
export interface BackgroundTask {
  id: string;
  description: string;
}

/**
 * Is anything happening here at all?
 *
 * The one answer everything that draws a dryad reads, so the forest, the fleet
 * and the worktree header can't disagree about whether one is resting. Its own
 * turn or work it left running both count; only `status` distinguishes them,
 * and only the composer cares which.
 */
export function sessionBusy(session: SessionInfo | undefined | null): boolean {
  if (!session) return false;
  return session.status === "running" || session.backgroundTasks.length > 0;
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
      /**
       * The file this step was about, when it was about one, resolved to a
       * worktree Sylva knows. Present so the transcript row can open it — the
       * summary is a truncated label and the raw input is an absolute path, and
       * neither can be turned back into "this file, in that worktree" by a
       * client that doesn't know where the worktrees live.
       */
      file?: { worktreeId: string; path: string };
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

export type AgentAvailability = { available: true } | { available: false; reason: string };

// ---------- File activity ----------

export interface FileEvent {
  worktreeId: string;
  path: string;
  change: "added" | "changed" | "deleted";
  at: string;
}

// ---------- Tools ----------

/**
 * One process holding a port open.
 *
 * `self` marks Sylva's own server. It is the one listener the tool refuses to
 * kill: the answer would arrive over a connection the kill had just closed, and
 * "the app vanished" is a poor way to learn what a button does.
 */
export interface PortListener {
  port: number;
  pid: number;
  /** The program's name, as the operating system reports it. */
  command: string;
  /** Whoever the process belongs to — killing another user's needs privileges. */
  user?: string;
  /** What it is bound to: "*", "127.0.0.1", "[::1]". */
  address?: string;
  self: boolean;
}

export interface PortScan {
  /** The ports that were asked about, or every listening port when none were. */
  listeners: PortListener[];
  /** Ports asked about that nothing is listening on. */
  free: number[];
  scannedAt: string;
}

export type KillOutcome = "killed" | "free" | "refused" | "failed";

/** What became of one port the kill was asked to free. */
export interface KillPortResult {
  port: number;
  outcome: KillOutcome;
  /** Processes the kill was aimed at, whether or not it reached them. */
  pids: number[];
  /** Why, when the outcome isn't "killed" — and how it ended when it is. */
  note: string;
}

export interface KillPortsRequest {
  ports: number[];
}

// ---------- WebSocket protocol (server -> client) ----------

export type ServerEvent =
  | { type: "agent.event"; sessionId: string; worktreeId: string; event: AgentEvent }
  | { type: "agent.session"; session: SessionInfo }
  | { type: "agent.availability"; availability: AgentAvailability }
  /**
   * This dryad's memory was cleared: session, transcript and running cost are
   * all gone. Broadcast rather than answered, because the same conversation can
   * be on screen in both panes at once.
   */
  | { type: "agent.cleared"; worktreeId: string }
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
