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

export function useInvalidate() {
  const qc = useQueryClient();
  return {
    repos: () => void qc.invalidateQueries({ queryKey: ["repos"] }),
    worktrees: (repoId?: string) =>
      void qc.invalidateQueries({ queryKey: repoId ? ["worktrees", repoId] : ["worktrees"] }),
    branches: () => void qc.invalidateQueries({ queryKey: ["branches"] }),
    status: (worktreeId?: string) =>
      void qc.invalidateQueries({ queryKey: worktreeId ? ["status", worktreeId] : ["status"] }),
    diffs: () => void qc.invalidateQueries({ queryKey: ["diff"] }),
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
