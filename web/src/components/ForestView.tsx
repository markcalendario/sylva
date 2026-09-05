import { useQueries } from "@tanstack/react-query";
import { api } from "../lib/api";
import { worktreeLabel } from "../lib/branch";
import { compactTokens } from "../lib/format";
import { useRepos } from "../lib/queries";
import { useHasForest, useWords } from "../lib/theme";
import { Sprite } from "../sprites/Sprite";
import { spriteStateFor, useSylva } from "../state/store";
import { circleMembers, GROVE_ID } from "sylva-shared";
import { ForestScene, type CirclePlot, type GrovePlot, type Plot } from "./ForestScene";

/**
 * The clearing: every worktree across every repository, living in one scene.
 * State is read from the dryads themselves — asleep by the stump, at the bench,
 * celebrating — so the page is scanned rather than read.
 *
 * In a theme with no forest there is no scene, and the roster underneath it —
 * which was always the part carrying the numbers — becomes the whole page. The
 * data behind both is identical; only the drawing of it is a theme's business.
 */
export function ForestView() {
  const hasForest = useHasForest();
  const words = useWords();
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
  const paneWorktreeId = useSylva((s) => s.pane.worktreeId);
  const unseenMap = useSylva((s) => s.unseenActivity);
  const knownCircles = useSylva((s) => s.knownCircles);

  const plots: Plot[] = pairs.map(({ repo, worktree }, i) => {
    const status = live[worktree.id] ?? statusQueries[i]?.data;
    return {
      repo,
      worktree,
      state: spriteStateFor({ sessions, pendingPermissions, celebrating }, worktree.id),
      ...(status ? { status } : {}),
      ...(sessions[worktree.id]?.totalTokens !== undefined
        ? { tokens: sessions[worktree.id]?.totalTokens }
        : {}),
      unseen: unseenMap[worktree.id] ?? false,
      focused: paneWorktreeId === worktree.id,
    };
  });

  /**
   * Shared dryads stand on the map too. A circle whose worktrees aren't all
   * present is left off rather than drawn short — half a circle would say
   * something untrue about what the dryad can reach.
   */
  const byId = new Map(pairs.map(({ repo, worktree }) => [worktree.id, { repo, worktree }]));
  const circlePlots: CirclePlot[] = knownCircles.flatMap((id) => {
    const ids = circleMembers(id) ?? [];
    const members = ids.map((m) => byId.get(m)).filter((m): m is NonNullable<typeof m> => !!m);
    if (members.length !== ids.length || members.length < 2) return [];
    return [
      {
        id,
        members,
        state: spriteStateFor({ sessions, pendingPermissions, celebrating }, id),
        unseen: unseenMap[id] ?? false,
        focused: paneWorktreeId === id,
      },
    ];
  });

  /**
   * The grove stands on the map with everyone else. It is never "focused" here
   * — reaching it means leaving the forest for its own view — so it only ever
   * reads as unseen while it has news.
   */
  const grove: GrovePlot = {
    state: spriteStateFor({ sessions, pendingPermissions, celebrating }, GROVE_ID),
    unseen: unseenMap[GROVE_ID] ?? false,
    focused: false,
    repoCount: available.length,
  };

  const busy =
    plots.filter((p) => p.state === "working").length + (grove.state === "working" ? 1 : 0);
  const loading = worktreeQueries.some((q) => q.isLoading);

  return (
    <div className="forest-view">
      <header className="forest-head">
        <h1 className="forest-title">{hasForest ? "The forest" : "Worktrees"}</h1>
        <p className="forest-sub">
          {plots.length} {hasForest ? (plots.length === 1 ? "tree" : "trees") : "worktrees"} across{" "}
          {available.length} repositor
          {available.length === 1 ? "y" : "ies"}
          {busy > 0 ? ` · ${busy} being worked` : " · all quiet"}.{" "}
          {hasForest ? "Click a dryad to work in its tree." : "Click one to open it."}
        </p>
      </header>

      {loading && plots.length === 0 && (
        <div className="forest-note">{hasForest ? "Counting the trees…" : "Loading…"}</div>
      )}

      {!loading && plots.length === 0 && (
        <div className="forest-note">
          No worktrees yet. Register a repository, then {hasForest ? "grow" : "create"} one from the
          sidebar.
        </div>
      )}

      {plots.length > 0 && (
        <>
          {hasForest && (
            <ForestScene
              plots={plots}
              circles={circlePlots}
              grove={grove}
              onOpen={(id) => useSylva.getState().openWorktree(id)}
              onOpenCircle={(ids) => useSylva.getState().openCircle(ids)}
              onOpenGrove={() => useSylva.getState().setView("grove")}
            />
          )}

          {/* The facts live here rather than on the map, so the plane stays a
              scene and the numbers stay scannable. In a theme with no map this
              is the whole page. A card per worktree rather than a table row:
              what you do here is pick one and go, and a card is a target you
              aim at — the numbers on it are context for that choice, not a
              column you read down. */}
          <div className="wt-cards">
            {/* First, and without divergence or a dirty count: the grove has no
                worktree, so those facts would be blanks pretending to be
                numbers. */}
            <button
              className="wt-card"
              onClick={() => useSylva.getState().setView("grove")}
              data-tip={`The ${words.agent} that belongs to no worktree`}
            >
              <div className="wt-card-head">
                <Sprite state={grove.state} scale={1} />
                <span className="wt-card-name">the {words.grove.toLowerCase()}</span>
                {grove.unseen && (
                  <span className="wt-card-unseen" data-tip="New activity you haven't read" />
                )}
              </div>
              <div className="wt-card-repo">
                {available.length === 1 ? "1 repository" : `${available.length} repositories`}
              </div>
              <div className="wt-card-facts tabular">
                <span className="div-zero">no worktree</span>
                {(sessions[GROVE_ID]?.totalTokens ?? 0) > 0 && (
                  <span
                    className="wt-card-tokens"
                    data-tip={`Tokens this ${words.agent} has read and written`}
                  >
                    {compactTokens(sessions[GROVE_ID]?.totalTokens ?? 0)}
                  </span>
                )}
              </div>
            </button>

            {plots.map((plot) => {
              const dirty = plot.status
                ? plot.status.staged.length +
                  plot.status.unstaged.length +
                  plot.status.untracked.length
                : 0;
              const branch = plot.worktree.branch;
              const label = worktreeLabel(branch, plot.worktree.head.slice(0, 7));
              return (
                <button
                  key={plot.worktree.id}
                  className={`wt-card wt-card-${plot.state} ${plot.focused ? "wt-card-on" : ""}`}
                  onClick={() => useSylva.getState().openWorktree(plot.worktree.id)}
                  data-tip={`${branch ?? "detached"}\n${plot.worktree.path}`}
                >
                  <div className="wt-card-head">
                    <Sprite state={plot.state} scale={1} title={label} />
                    <span className="wt-card-name">{label}</span>
                    {plot.unseen && (
                      <span className="wt-card-unseen" data-tip="New activity you haven't read" />
                    )}
                  </div>
                  <div className="wt-card-repo">
                    {plot.repo.name}
                    {branch?.includes("/") && <span className="wt-card-branch">{branch}</span>}
                  </div>
                  <div className="wt-card-facts tabular">
                    {plot.status?.base ? (
                      <span data-tip={`Ahead of and behind ${plot.status.base.branch}`}>
                        <span className={plot.status.base.ahead ? "div-ahead" : "div-zero"}>
                          ↑{plot.status.base.ahead}
                        </span>{" "}
                        <span className={plot.status.base.behind ? "div-behind" : "div-zero"}>
                          ↓{plot.status.base.behind}
                        </span>
                      </span>
                    ) : (
                      <span className="div-zero">no base</span>
                    )}
                    <span className={dirty ? "wt-card-dirty" : "div-zero"}>
                      {dirty === 0 ? "clean" : `${dirty} dirty`}
                    </span>
                    {plot.tokens ? (
                      <span
                        className="wt-card-tokens"
                        data-tip={`Tokens this ${words.agent} has read and written`}
                      >
                        {compactTokens(plot.tokens)}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
