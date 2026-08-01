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

export function useDiff(worktreeId: string | null, path: string | null, staged: boolean) {
  return useQuery({
    queryKey: ["diff", worktreeId, path, staged],
    queryFn: () => api.diff(worktreeId as string, path as string, staged),
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
