import { useQueries } from "@tanstack/react-query";
import type { Repo, Worktree } from "sylva-shared";
import { api } from "../lib/api";
import { useRepos, useStatusQuery } from "../lib/queries";
import { spriteStateFor, useSylva } from "../state/store";
import { Sprite } from "../sprites/Sprite";

const STATE_LABEL: Record<string, string> = {
  idle: "resting",
  working: "working",
  success: "just finished",
  error: "needs you",
};

function TreeCard({ worktree, repo }: { worktree: Worktree; repo: Repo }) {
  const state = useSylva((s) => spriteStateFor(s, worktree.id));
  const focused = useSylva((s) => s.focusedWorktreeId) === worktree.id;
  const session = useSylva((s) => s.sessions[worktree.id]);
  const unseen = useSylva((s) => s.unseenActivity[worktree.id] ?? false);

  // The store only carries status for worktrees the server is watching, so the
  // overview fetches its own for the rest and prefers the live one when present.
  const liveStatus = useSylva((s) => s.statuses[worktree.id]);
  const fetched = useStatusQuery(worktree.id);
  const status = liveStatus ?? fetched.data;

  const dirty = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  return (
    <button
      className={`tree-card tree-card-${state} ${focused ? "tree-card-focused" : ""}`}
      onClick={() => void api.setFocus(worktree.id)}
      title={worktree.path}
    >
      <div className="tree-card-sprite">
        <Sprite state={state} scale={3} />
        {unseen && !focused && <span className="unseen-dot tree-card-dot" />}
      </div>

      <div className="tree-card-branch">{worktree.branch ?? `${worktree.head.slice(0, 7)}`}</div>
      <div className="tree-card-repo">{repo.name}</div>

      <div className={`tree-card-state tree-state-${state}`}>{STATE_LABEL[state]}</div>

      <div className="tree-card-facts">
        {status?.base ? (
          <span title={`Compared with ${status.base.branch}`}>
            <span className={status.base.ahead ? "div-ahead" : "div-zero"}>
              ↑{status.base.ahead}
            </span>{" "}
            <span className={status.base.behind ? "div-behind" : "div-zero"}>
              ↓{status.base.behind}
            </span>
          </span>
        ) : (
          <span className="div-zero">—</span>
        )}
        <span className={dirty ? "" : "div-zero"}>{dirty === 0 ? "clean" : `${dirty} dirty`}</span>
        {session && session.totalCostUsd > 0 && (
          <span className="tree-card-cost">${session.totalCostUsd.toFixed(2)}</span>
        )}
      </div>
    </button>
  );
}

/** Every worktree across every repo, as a grid of dryads. */
export function ForestView() {
  const repos = useRepos();
  const available = repos.data?.filter((r) => r.available) ?? [];

  const worktreeQueries = useQueries({
    queries: available.map((repo) => ({
      queryKey: ["worktrees", repo.id],
      queryFn: () => api.listWorktrees(repo.id),
    })),
  });

  const trees = available.flatMap((repo, i) =>
    (worktreeQueries[i]?.data ?? []).map((worktree) => ({ repo, worktree })),
  );

  const loading = worktreeQueries.some((q) => q.isLoading);

  return (
    <div className="forest-view">
      <header className="forest-head">
        <h1 className="forest-title">The forest</h1>
        <p className="forest-sub">
          {trees.length} tree{trees.length === 1 ? "" : "s"} across {available.length} repositor
          {available.length === 1 ? "y" : "ies"}. Click one to work in it.
        </p>
      </header>

      {loading && trees.length === 0 && <div className="forest-note">Counting the trees…</div>}

      {!loading && trees.length === 0 && (
        <div className="forest-note">
          No worktrees yet. Register a repository, then grow one from the sidebar.
        </div>
      )}

      <div className="forest-grid">
        {trees.map(({ repo, worktree }) => (
          <TreeCard key={worktree.id} worktree={worktree} repo={repo} />
        ))}
      </div>
    </div>
  );
}
