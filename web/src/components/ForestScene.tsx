import type { Repo, Worktree, WorktreeStatus } from "sylva-shared";
import type { SpriteState } from "../sprites/frames";
import { PixelArt } from "../sprites/pixel";
import { Sprite } from "../sprites/Sprite";
import {
  BENCH_FRAMES,
  BENCH_H,
  BENCH_W,
  PROP_PALETTE,
  STUMP_FRAMES,
  STUMP_H,
  STUMP_W,
} from "../sprites/props";
import { TREE_FRAMES, TREE_FRAMES_FRUITING, TREE_H, TREE_PALETTE, TREE_W } from "../sprites/tree";
import "./forestScene.css";

export interface Plot {
  worktree: Worktree;
  repo: Repo;
  state: SpriteState;
  status?: WorktreeStatus;
  cost?: number;
  unseen: boolean;
  focused: boolean;
}

const STATE_TIP: Record<SpriteState, string> = {
  idle: "Asleep by the stump — no agent is running here",
  working: "At the bench — an agent is working in this worktree",
  success: "Celebrating — the last turn finished cleanly",
  error: "Slumped by the bench — the last turn failed or needs you",
};

/**
 * One clearing shared by every worktree, rather than a card each.
 *
 * Each dryad keeps a plot: it sleeps by the stump on the left and walks to the
 * bench on the right when its agent starts working — so a glance across the
 * clearing tells you who is busy without reading a word. Movement is a CSS
 * transition on transform, which means the walk happens automatically whenever
 * the state changes, with no animation bookkeeping in React.
 */
export function ForestScene({ plots, onOpen }: { plots: Plot[]; onOpen: (id: string) => void }) {
  return (
    <div className="clearing" role="list">
      <div className="clearing-sky" />
      <div className="clearing-stars" />

      <div className="clearing-plots">
        {plots.map((plot) => (
          <PlotView key={plot.worktree.id} plot={plot} onOpen={onOpen} />
        ))}
      </div>

    </div>
  );
}

function PlotView({ plot, onOpen }: { plot: Plot; onOpen: (id: string) => void }) {
  const { worktree, repo, state, status, cost, unseen, focused } = plot;
  const name = worktree.branch ?? worktree.head.slice(0, 7);
  const dirty = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;
  const atBench = state === "working" || state === "error";

  return (
    <button
      className={`plot plot-${state} ${focused ? "plot-focused" : ""}`}
      onClick={() => onOpen(worktree.id)}
      role="listitem"
      data-tip={`${STATE_TIP[state]} · ${worktree.path}`}
    >
      <PixelArt
        className="plot-tree"
        cacheKey={state === "success" ? "tree-fruit" : "tree"}
        frames={state === "success" ? TREE_FRAMES_FRUITING : TREE_FRAMES}
        palette={TREE_PALETTE}
        width={TREE_W}
        height={TREE_H}
        scale={3}
        speed={900}
      />

      <PixelArt
        className="plot-stump"
        cacheKey="stump"
        frames={STUMP_FRAMES}
        palette={PROP_PALETTE}
        width={STUMP_W}
        height={STUMP_H}
        scale={3}
      />

      <PixelArt
        className={`plot-bench ${atBench ? "plot-bench-lit" : ""}`}
        cacheKey="bench"
        frames={BENCH_FRAMES}
        palette={PROP_PALETTE}
        width={BENCH_W}
        height={BENCH_H}
        scale={3}
      />

      {/* The actor carries its own nameplate, so the label walks with it. */}
      <div className={`actor ${atBench ? "actor-at-bench" : ""}`}>
        <span className="actor-name">
          {name}
          {unseen && !focused && <span className="actor-dot" />}
        </span>
        <div className="actor-body">
          <Sprite state={state} scale={2} />
        </div>
        {state === "idle" && (
          <>
            <span className="zzz zzz-a">z</span>
            <span className="zzz zzz-b">z</span>
          </>
        )}
      </div>

      {state === "working" && (
        <>
          <span className="plot-firefly" />
          <span className="plot-mote plot-mote-a" />
          <span className="plot-mote plot-mote-b" />
        </>
      )}
      {state === "success" && (
        <>
          <span className="plot-spark plot-spark-a" />
          <span className="plot-spark plot-spark-b" />
          <span className="plot-spark plot-spark-c" />
        </>
      )}

      <span className="plot-caption">
        <span className="plot-repo">{repo.name}</span>
        {status?.base && (
          <span className="plot-facts tabular">
            <span className={status.base.ahead ? "div-ahead" : "div-zero"}>
              ↑{status.base.ahead}
            </span>
            <span className={status.base.behind ? "div-behind" : "div-zero"}>
              ↓{status.base.behind}
            </span>
          </span>
        )}
        <span className={`plot-facts tabular ${dirty ? "" : "div-zero"}`}>
          {dirty === 0 ? "clean" : `${dirty} dirty`}
        </span>
        {cost !== undefined && cost > 0 && (
          <span className="plot-facts plot-cost tabular">${cost.toFixed(2)}</span>
        )}
      </span>
    </button>
  );
}
