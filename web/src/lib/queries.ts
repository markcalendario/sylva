import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type { FileEvent } from "sylva-shared";
import { api } from "./api";
import { useSylva } from "../state/store";

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

/** App-level preferences: the Open target, the terminal, and worktree defaults. */
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

/**
 * How long changes are collected before anything is re-read. An agent mid-turn
 * writes in bursts, and re-reading the open file for each write in a burst
 * would spend a `git diff` on every keystroke it made.
 */
const FILE_SETTLE_MS = 500;

/**
 * Keep what is on screen honest about files changing underneath it.
 *
 * The file feed already streams every change in a watched worktree; nothing was
 * listening to it on this side. So an open file, its diff and its gutter went
 * stale the moment the dryad edited it, and stayed stale until something
 * happened to refetch them — which in practice meant leaving the window and
 * coming back, since focus is when React Query re-asks. Reading a file that
 * quietly stopped being true is worse than a moment's flicker, and refetching
 * *everything* on every focus is the other half of the same bad bargain.
 *
 * Only the queries currently mounted actually re-read: invalidating a path
 * nobody has open costs nothing, so every changed path can be named without
 * thinking about which of them are on screen.
 */
export function useFileEventInvalidation(): (worktreeId: string, events: FileEvent[]) => void {
  const qc = useQueryClient();
  const pending = useRef(new Map<string, { paths: Set<string>; listing: boolean }>());
  const timer = useRef(0);

  return useCallback(
    (worktreeId: string, events: FileEvent[]) => {
      const entry = pending.current.get(worktreeId) ?? { paths: new Set<string>(), listing: false };
      for (const event of events) {
        entry.paths.add(event.path);
        // A file that merely changed leaves the directory listing as it was;
        // one that appeared or vanished does not.
        if (event.change !== "changed") entry.listing = true;
      }
      pending.current.set(worktreeId, entry);

      if (timer.current) return;
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        const batch = pending.current;
        pending.current = new Map();

        for (const [id, { paths, listing }] of batch) {
          for (const path of paths) {
            void qc.invalidateQueries({ queryKey: ["file", id, path] });
            void qc.invalidateQueries({ queryKey: ["changed-lines", id, path] });
            // Blame is cached forever per line, which is only true while the
            // file is: an edit above moves every line below it.
            void qc.invalidateQueries({ queryKey: ["blame", id, path] });
          }
          // The working-tree diff, but not a commit's — what a commit changed
          // was settled when it was made, and re-reading it through a build
          // would be a `git show` every half second for an answer that cannot
          // have moved.
          void qc.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey;
              return key[0] === "diff" && key[1] === id && key[4] === null;
            },
          });
          if (listing) void qc.invalidateQueries({ queryKey: ["tree", id] });
        }
      }, FILE_SETTLE_MS);
    },
    [qc],
  );
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
    /**
     * Re-read a worktree's git status right now, and put it in the store.
     *
     * Invalidating the query is not enough: the dirty counts on the sidebar and
     * the tab badges read the *store*, which is fed by the watcher over the
     * socket. Committing through the app used to leave both saying what was
     * true before — the working tree hadn't changed, so the watcher had nothing
     * to report, and the count sat there until something else happened.
     *
     * The watcher now notices a commit too, so this is belt and braces — but it
     * is the half that lands immediately, and it covers a worktree that isn't
     * being watched at all.
     */
    statusNow: (worktreeId: string) => {
      void qc.invalidateQueries({ queryKey: ["status", worktreeId] });
      void api
        .status(worktreeId)
        .then((status) => useSylva.getState().setStatus(status))
        .catch(() => {
          // The worktree may have just been removed; the next event corrects it.
        });
    },
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
