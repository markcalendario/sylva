import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function useRepos() {
  return useQuery({ queryKey: ["repos"], queryFn: api.listRepos });
}

export function useWorktrees(repoId: string) {
  return useQuery({
    queryKey: ["worktrees", repoId],
    queryFn: () => api.listWorktrees(repoId),
  });
}

export function useBranches(repoId: string | null) {
  return useQuery({
    queryKey: ["branches", repoId],
    queryFn: () => api.branches(repoId as string),
    enabled: repoId !== null,
  });
}

export function useStatusQuery(worktreeId: string | null) {
  return useQuery({
    queryKey: ["status", worktreeId],
    queryFn: () => api.status(worktreeId as string),
    enabled: worktreeId !== null,
  });
}

/**
 * A file's diff — as it stands in the worktree, or as one commit left it.
 * The same query either way, because it answers the same question and lands in
 * the same panel; only where the patch comes from differs.
 */
export function useDiff(
  worktreeId: string | null,
  path: string | null,
  staged: boolean,
  commit?: string,
) {
  return useQuery({
    queryKey: ["diff", worktreeId, path, staged, commit ?? null],
    queryFn: () =>
      commit
        ? api.commitDiff(worktreeId as string, commit, path as string)
        : api.diff(worktreeId as string, path as string, staged),
    enabled: worktreeId !== null && path !== null,
  });
}

/** What a commit changed. Fetched only once its row is opened. */
export function useCommitDetail(worktreeId: string | null, sha: string | null) {
  return useQuery({
    queryKey: ["commit", worktreeId, sha],
    queryFn: () => api.commitDetail(worktreeId as string, sha as string),
    enabled: worktreeId !== null && sha !== null,
    // A commit is immutable; once read there is nothing to refetch.
    staleTime: Infinity,
  });
}

/** App-level preferences: the Open target and saved prompts. */
export function usePreferences() {
  return useQuery({ queryKey: ["preferences"], queryFn: api.preferences, staleTime: 60_000 });
}

export function useGraph(worktreeId: string | null) {
  return useQuery({
    queryKey: ["graph", worktreeId],
    queryFn: () => api.graph(worktreeId as string),
    enabled: worktreeId !== null,
  });
}

export function useTree(worktreeId: string | null, path: string) {
  return useQuery({
    queryKey: ["tree", worktreeId, path],
    queryFn: () => api.tree(worktreeId as string, path),
    enabled: worktreeId !== null,
  });
}

export function useFileContent(worktreeId: string | null, path: string | null) {
  return useQuery({
    queryKey: ["file", worktreeId, path],
    queryFn: () => api.fileContent(worktreeId as string, path as string),
    enabled: worktreeId !== null && path !== null,
  });
}

/**
 * The pull request for a worktree's branch.
 *
 * Refetched on an interval rather than only on mount: checks go green minutes
 * after a push, and a card that still says "pending" long after CI finished is
 * worse than no card. Kept slow — every poll is a `gh` process.
 */
export function useCurrentPull(worktreeId: string | null) {
  return useQuery({
    queryKey: ["pull", worktreeId],
    queryFn: () => api.currentPull(worktreeId as string),
    enabled: worktreeId !== null,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/**
 * What's left of the Claude plan. One query for the whole app — the limits
 * belong to the login, so panes share the answer rather than each asking.
 */
export function usePlanUsage() {
  return useQuery({
    queryKey: ["usage"],
    queryFn: api.usage,
    staleTime: 60_000,
    refetchInterval: 120_000,
    // A machine on an API key has no plan windows and never will within a
    // session; retrying that answer just spawns processes.
    retry: false,
  });
}

/**
 * Which lines of the open file differ from the last commit.
 *
 * Invalidated alongside the diff, since they are two readings of one fact — a
 * gutter still marking lines you committed a minute ago is worse than no
 * gutter, because you would believe it.
 */
export function useChangedLines(worktreeId: string | null, path: string | null) {
  return useQuery({
    queryKey: ["changed-lines", worktreeId, path],
    queryFn: () => api.changedLines(worktreeId as string, path as string),
    enabled: worktreeId !== null && path !== null,
  });
}

/**
 * Who last touched the line the caret is on.
 *
 * One query per line, cached forever: a line's history doesn't change while you
 * sit on it, and moving up and down a file re-asking the same twenty questions
 * would run a `git blame` per keystroke.
 */
export function useLineBlame(worktreeId: string | null, path: string | null, line: number | null) {
  return useQuery({
    queryKey: ["blame", worktreeId, path, line],
    queryFn: () => api.blame(worktreeId as string, path as string, line as number),
    enabled: worktreeId !== null && path !== null && line !== null,
    staleTime: Infinity,
    retry: false,
  });
}

/** Every worktree's status in one answer, for the fleet digest. */
export function useFleet(enabled: boolean) {
  return useQuery({
    queryKey: ["fleet"],
    queryFn: api.fleet,
    enabled,
    // It reads git status in every registered worktree; polling it hard would
    // be rude to the disk for a screen you glance at.
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return {
    repos: () => void qc.invalidateQueries({ queryKey: ["repos"] }),
    worktrees: (repoId?: string) =>
      void qc.invalidateQueries({ queryKey: repoId ? ["worktrees", repoId] : ["worktrees"] }),
    branches: () => void qc.invalidateQueries({ queryKey: ["branches"] }),
    status: (worktreeId?: string) =>
      void qc.invalidateQueries({ queryKey: worktreeId ? ["status", worktreeId] : ["status"] }),
    diffs: () => {
      void qc.invalidateQueries({ queryKey: ["diff"] });
      // The gutter is the same fact read another way; they must move together.
      void qc.invalidateQueries({ queryKey: ["changed-lines"] });
      void qc.invalidateQueries({ queryKey: ["blame"] });
      void qc.invalidateQueries({ queryKey: ["fleet"] });
    },
    file: (worktreeId: string, path: string) =>
      void qc.invalidateQueries({ queryKey: ["file", worktreeId, path] }),
    pull: (worktreeId?: string) =>
      void qc.invalidateQueries({ queryKey: worktreeId ? ["pull", worktreeId] : ["pull"] }),
    everything: () => void qc.invalidateQueries(),
  };
}

export function useApiMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  onDone?: (result: TResult) => void,
) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => onDone?.(r),
  });
}
