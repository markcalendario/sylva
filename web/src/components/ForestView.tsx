import { useQueries } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useRepos } from "../lib/queries";
import { spriteStateFor, useSylva } from "../state/store";
import { ForestScene, type Plot } from "./ForestScene";

/**
 * The clearing: every worktree across every repository, living in one scene.
 * State is read from the dryads themselves — asleep by the stump, at the bench,
 * celebrating — so the page is scanned rather than read.
 */
export function ForestView() {
  const repos = useRepos();
  const available = repos.data?.filter((r) => r.available) ?? [];

  const worktreeQueries = useQueries({
    queries: available.map((repo) => ({
      queryKey: ["worktrees", repo.id],
      queryFn: () => api.listWorktrees(repo.id),
    })),
  });

  const pairs = available.flatMap((repo, i) =>
    (worktreeQueries[i]?.data ?? []).map((worktree) => ({ repo, worktree })),
  );

  // The store only holds status for worktrees the server watches, so the
  // clearing fetches the rest and prefers the live copy when there is one.
  const statusQueries = useQueries({
    queries: pairs.map(({ worktree }) => ({
      queryKey: ["status", worktree.id],
      queryFn: () => api.status(worktree.id),
    })),
  });

  // Select stable slices, never a derived function: a selector that builds a
  // new function or object every call changes snapshot identity on each render
  // and spins the loop.
  const live = useSylva((s) => s.statuses);
  const sessions = useSylva((s) => s.sessions);
  const pendingPermissions = useSylva((s) => s.pendingPermissions);
  const celebrating = useSylva((s) => s.celebrating);
  const focusedId = useSylva((s) => s.focusedWorktreeId);
  const unseenMap = useSylva((s) => s.unseenActivity);

  const plots: Plot[] = pairs.map(({ repo, worktree }, i) => {
    const status = live[worktree.id] ?? statusQueries[i]?.data;
    return {
      repo,
      worktree,
      state: spriteStateFor({ sessions, pendingPermissions, celebrating }, worktree.id),
      ...(status ? { status } : {}),
      ...(sessions[worktree.id]?.totalCostUsd !== undefined
        ? { cost: sessions[worktree.id]?.totalCostUsd }
        : {}),
      unseen: unseenMap[worktree.id] ?? false,
      focused: focusedId === worktree.id,
    };
  });

  const busy = plots.filter((p) => p.state === "working").length;
  const loading = worktreeQueries.some((q) => q.isLoading);

  return (
    <div className="forest-view">
      <header className="forest-head">
        <h1 className="forest-title">The forest</h1>
        <p className="forest-sub">
          {plots.length} tree{plots.length === 1 ? "" : "s"} across {available.length} repositor
          {available.length === 1 ? "y" : "ies"}
          {busy > 0 ? ` · ${busy} being worked` : " · all quiet"}. Click a dryad to work in its
          tree.
        </p>
      </header>

      {loading && plots.length === 0 && <div className="forest-note">Counting the trees…</div>}

      {!loading && plots.length === 0 && (
        <div className="forest-note">
          No worktrees yet. Register a repository, then grow one from the sidebar.
        </div>
      )}

      {plots.length > 0 && (
        <>
          <ForestScene plots={plots} onOpen={(id) => void api.setFocus(id)} />

          {/* The facts live here rather than on the map, so the plane stays a
              scene and the numbers stay scannable. */}
          <div className="ow-roster">
            {plots.map((plot) => {
              const dirty = plot.status
                ? plot.status.staged.length +
                  plot.status.unstaged.length +
                  plot.status.untracked.length
                : 0;
              const stateWord =
                plot.state === "idle"
                  ? "resting"
                  : plot.state === "working"
                    ? "working"
                    : plot.state === "success"
                      ? "done"
                      : "needs you";
              return (
                <button
                  key={plot.worktree.id}
                  className={`ow-chip ${plot.focused ? "ow-chip-focused" : ""}`}
                  onClick={() => void api.setFocus(plot.worktree.id)}
                  data-tip={`${plot.repo.name} · ${plot.worktree.path}`}
                >
                  <span className="ow-chip-name">
                    {plot.worktree.branch ?? plot.worktree.head.slice(0, 7)}
                  </span>
                  <span className={`ow-chip-state ow-state-${plot.state}`}>{stateWord}</span>
                  {plot.status?.base && (
                    <span className="tabular">
                      <span className={plot.status.base.ahead ? "div-ahead" : "div-zero"}>
                        ↑{plot.status.base.ahead}
                      </span>{" "}
                      <span className={plot.status.base.behind ? "div-behind" : "div-zero"}>
                        ↓{plot.status.base.behind}
                      </span>
                    </span>
                  )}
                  <span className={`tabular ${dirty ? "" : "div-zero"}`}>
                    {dirty === 0 ? "clean" : `${dirty} dirty`}
                  </span>
                  {plot.cost !== undefined && plot.cost > 0 && (
                    <span className="ow-chip-cost tabular">${plot.cost.toFixed(2)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
