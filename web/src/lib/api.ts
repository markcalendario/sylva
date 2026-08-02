import type {
  AgentAvailability,
  AgentEvent,
  AgentSettings,
  AppPreferences,
  Attachment,
  BranchInfo,
  CommitGraph,
  CommitManyResult,
  DirListing,
  FileContent,
  FileDiff,
  FileEvent,
  ContentSearchResponse,
  FileSearchResponse,
  OpenKind,
  RunnerSnapshot,
  RunnerState,
  PullRequestResult,
  PermissionAnswer,
  PermissionRequest,
  Repo,
  SessionInfo,
  TreeListing,
  Worktree,
  WorktreeOverrides,
  WorktreeSettings,
  WorktreeStatus,
} from "sylva-shared";

/** Mirrors the server's OpenPullRequests; kept here to avoid a shared-type churn. */
export interface OpenPullRequests {
  pulls:
    | {
        number: number;
        title: string;
        url: string;
        draft: boolean;
        branch: string;
        author: string;
        updatedAt: string;
        isCurrent: boolean;
      }[]
    | null;
  fallbackUrl: string | null;
  reason: string | null;
}

export class ApiFailure extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiFailure(
      res.status,
      typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
      typeof body.detail === "string" ? body.detail : undefined,
    );
  }
  return body as T;
}

export const api = {
  listRepos: () => request<Repo[]>("/api/repos"),
  registerRepo: (path: string) =>
    request<Repo>("/api/repos", { method: "POST", body: JSON.stringify({ path }) }),
  createRepo: (parentPath: string, name: string) =>
    request<Repo>("/api/repos/create", {
      method: "POST",
      body: JSON.stringify({ parentPath, name }),
    }),
  removeRepo: (repoId: string) => request<{ ok: true }>(`/api/repos/${repoId}`, { method: "DELETE" }),

  listWorktrees: (repoId: string) => request<Worktree[]>(`/api/repos/${repoId}/worktrees`),
  createWorktree: (repoId: string, body: { branch: string; baseRef?: string; path?: string }) =>
    request<Worktree>(`/api/repos/${repoId}/worktrees`, { method: "POST", body: JSON.stringify(body) }),
  removeWorktree: (worktreeId: string, force: boolean) =>
    request<{ ok: true }>(`/api/worktrees/${worktreeId}`, {
      method: "DELETE",
      body: JSON.stringify({ force }),
    }),

  getFocus: () => request<{ worktreeId: string | null }>("/api/focus"),
  setFocus: (worktreeId: string | null) =>
    request<{ worktreeId: string | null }>("/api/focus", {
      method: "POST",
      body: JSON.stringify({ worktreeId }),
    }),

  /**
   * Everything the panes hold. The server watches this set, so a worktree in
   * the second pane streams as live as the one in the first.
   */
  setOpenWorktrees: (worktreeIds: string[]) =>
    request<{ worktreeIds: string[] }>("/api/open-worktrees", {
      method: "POST",
      body: JSON.stringify({ worktreeIds }),
    }),

  status: (worktreeId: string) => request<WorktreeStatus>(`/api/worktrees/${worktreeId}/status`),
  diff: (worktreeId: string, path: string, staged: boolean) =>
    request<FileDiff>(
      `/api/worktrees/${worktreeId}/diff?path=${encodeURIComponent(path)}&staged=${staged ? "1" : "0"}`,
    ),
  stage: (worktreeId: string, paths: string[] | "all") =>
    request<{ ok: true }>(`/api/worktrees/${worktreeId}/stage`, {
      method: "POST",
      body: JSON.stringify(paths === "all" ? { all: true } : { paths }),
    }),
  unstage: (worktreeId: string, paths: string[] | "all") =>
    request<{ ok: true }>(`/api/worktrees/${worktreeId}/unstage`, {
      method: "POST",
      body: JSON.stringify(paths === "all" ? { all: true } : { paths }),
    }),
  commit: (worktreeId: string, message: string) =>
    request<{ head: string }>(`/api/worktrees/${worktreeId}/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  commitMany: (worktreeIds: string[], message: string) =>
    request<CommitManyResult>("/api/worktrees/commit-many", {
      method: "POST",
      body: JSON.stringify({ worktreeIds, message }),
    }),
  recentFiles: (worktreeId: string) =>
    request<FileEvent[]>(`/api/worktrees/${worktreeId}/recent-files`),
  commitMessage: (worktreeId: string) =>
    request<{ message: string }>(`/api/worktrees/${worktreeId}/commit-message`, {
      method: "POST",
      body: "{}",
    }),

  branches: (repoId: string) => request<BranchInfo[]>(`/api/repos/${repoId}/branches`),
  push: (worktreeId: string, setUpstream: boolean) =>
    request<{ output: string }>(`/api/worktrees/${worktreeId}/push`, {
      method: "POST",
      body: JSON.stringify({ setUpstream }),
    }),
  pull: (worktreeId: string) =>
    request<{ output: string }>(`/api/worktrees/${worktreeId}/pull`, { method: "POST", body: "{}" }),

  session: (worktreeId: string) =>
    request<{
      session: SessionInfo | null;
      pendingPermissions: PermissionRequest[];
      availability: AgentAvailability;
    }>(`/api/worktrees/${worktreeId}/session`),
  listSessions: () => request<SessionInfo[]>("/api/sessions"),

  /** Every request waiting on an answer, for rebuilding state after a reload. */
  listPermissions: () => request<PermissionRequest[]>("/api/permissions"),
  transcript: (worktreeId: string) =>
    request<AgentEvent[]>(`/api/worktrees/${worktreeId}/session/transcript`),
  prompt: (worktreeId: string, text: string) =>
    request<SessionInfo>(`/api/worktrees/${worktreeId}/session/prompt`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  interrupt: (worktreeId: string) =>
    request<SessionInfo>(`/api/worktrees/${worktreeId}/session/interrupt`, {
      method: "POST",
      body: "{}",
    }),
  removeQueued: (worktreeId: string, promptId: string) =>
    request<SessionInfo>(`/api/worktrees/${worktreeId}/session/queue/${promptId}`, {
      method: "DELETE",
    }),
  answerPermission: (requestId: string, answer: PermissionAnswer) =>
    request<{ ok: true }>("/api/permissions/answer", {
      method: "POST",
      body: JSON.stringify({ requestId, answer }),
    }),
  graph: (worktreeId: string) => request<CommitGraph>(`/api/worktrees/${worktreeId}/graph`),
  tree: (worktreeId: string, path = "") =>
    request<TreeListing>(`/api/worktrees/${worktreeId}/tree?path=${encodeURIComponent(path)}`),
  fileContent: (worktreeId: string, path: string) =>
    request<FileContent>(`/api/worktrees/${worktreeId}/file?path=${encodeURIComponent(path)}`),
  searchContent: (worktreeId: string, q: string) =>
    request<ContentSearchResponse>(
      `/api/worktrees/${worktreeId}/search-content?q=${encodeURIComponent(q)}`,
    ),
  openPulls: (worktreeId: string) =>
    request<OpenPullRequests>(`/api/worktrees/${worktreeId}/pulls`),
  searchFiles: (worktreeId: string, q: string) =>
    request<FileSearchResponse>(
      `/api/worktrees/${worktreeId}/search-files?q=${encodeURIComponent(q)}`,
    ),

  runner: (worktreeId: string) =>
    request<RunnerSnapshot>(`/api/worktrees/${worktreeId}/runner`),
  startRunner: (worktreeId: string) =>
    request<RunnerState>(`/api/worktrees/${worktreeId}/runner/start`, {
      method: "POST",
      body: "{}",
    }),
  stopRunner: (worktreeId: string) =>
    request<RunnerState>(`/api/worktrees/${worktreeId}/runner/stop`, {
      method: "POST",
      body: "{}",
    }),
  listRunners: () => request<RunnerState[]>("/api/runners"),
  createPr: (worktreeId: string, opts: { draft: boolean; title?: string; body?: string }) =>
    request<PullRequestResult>(`/api/worktrees/${worktreeId}/pr`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  openExternally: (worktreeId: string, kind: OpenKind) =>
    request<{ ok: true; ran: string }>(`/api/worktrees/${worktreeId}/open`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),

  preferences: () => request<AppPreferences>("/api/preferences"),
  setPreferences: (prefs: AppPreferences) =>
    request<AppPreferences>("/api/preferences", { method: "PUT", body: JSON.stringify(prefs) }),

  globalSettings: () => request<AgentSettings>("/api/settings"),
  setGlobalSettings: (settings: AgentSettings) =>
    request<AgentSettings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),

  worktreeSettings: (worktreeId: string) =>
    request<WorktreeSettings>(`/api/worktrees/${worktreeId}/settings`),
  setWorktreeOverrides: (worktreeId: string, overrides: WorktreeOverrides) =>
    request<WorktreeSettings>(`/api/worktrees/${worktreeId}/settings`, {
      method: "PUT",
      body: JSON.stringify(overrides),
    }),

  browse: (path?: string) =>
    request<DirListing>(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),

  async attach(worktreeId: string, file: File): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(`/api/worktrees/${worktreeId}/attachments`, {
      method: "POST",
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new ApiFailure(
        res.status,
        typeof body.error === "string" ? body.error : "Upload failed",
        typeof body.detail === "string" ? body.detail : undefined,
      );
    }
    return body as unknown as Attachment;
  },
};
