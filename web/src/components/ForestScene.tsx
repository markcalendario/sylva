import { useMemo } from "react";
import type { Repo, Worktree, WorktreeStatus } from "sylva-shared";
import type { SpriteState } from "../sprites/frames";
import { PixelArt } from "../sprites/pixel";
import { Sprite } from "../sprites/Sprite";
import {
  BENCH_FRAMES,
  BENCH_H,
  BENCH_W,
  BOARD_FRAMES,
  BOARD_H,
  BOARD_W,
  PROP_PALETTE,
  STUMP_FRAMES,
  STUMP_H,
  STUMP_W,
} from "../sprites/props";
import { TREE_FRAMES, TREE_FRAMES_FRUITING, TREE_H, TREE_PALETTE, TREE_W } from "../sprites/tree";
import { MAP_H, MAP_W, renderPlane, STATIONS, type StationKey } from "../sprites/tilemap";
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

/** Display scale for the plane; everything on it is positioned in map px. */
const SCALE = 2;

const STATE_STATION: Record<SpriteState, StationKey> = {
  idle: "camp",
  working: "workshop",
  success: "grove",
  error: "board",
};

const STATE_WORD: Record<SpriteState, string> = {
  idle: "asleep at the camp",
  working: "at the workshop",
  success: "celebrating in the grove",
  error: "waiting at the notice board",
};

/** Scenery placed in map coordinates: [x, y] is the sprite's bottom-centre. */
const CAMP_TREES: Array<[number, number]> = [
  [40, 96],
  [110, 88],
  [26, 170],
];
const WORKSHOP_BENCHES: Array<[number, number]> = [
  [488, 96],
  [556, 96],
];
const EDGE_TREES: Array<[number, number]> = [
  [220, 54],
  [432, 50],
  [608, 130],
];

/**
 * The forest as one overworld plane. Stations are places on the map — camp,
 * workshop, grove, notice board — and each dryad walks to the station its
 * state names. Slots keep several dryads at one station from stacking, and
 * everything sorts by its y position so nearer things draw in front.
 */
export function ForestScene({ plots, onOpen }: { plots: Plot[]; onOpen: (id: string) => void }) {
  const plane = useMemo(() => renderPlane(), []);

  // A dryad's slot index must be stable while others change state, or one
  // agent finishing would shuffle every sleeper at the camp. Index within the
  // full roster gives that stability at the cost of occasional gaps.
  const placed = plots.map((plot, i) => {
    const station = STATIONS[STATE_STATION[plot.state]];
    const slot = station.slots[i % station.slots.length] ?? station;
    return { plot, x: slot.x, y: slot.y };
  });

  return (
    <div className="overworld-wrap">
      <div
        className="overworld"
        style={{ width: MAP_W * SCALE, height: MAP_H * SCALE, backgroundImage: `url(${plane})` }}
      >
        {/* scenery, depth-sorted with the actors via zIndex = y */}
        {CAMP_TREES.concat(EDGE_TREES).map(([x, y], i) => (
          <div key={`t${i}`} className="ow-prop" style={propStyle(x, y, TREE_W, TREE_H)}>
            <PixelArt cacheKey="tree" frames={TREE_FRAMES} palette={TREE_PALETTE} width={TREE_W} height={TREE_H} scale={SCALE} speed={1000} />
          </div>
        ))}
        <div className="ow-prop" style={propStyle(STATIONS.grove.x, STATIONS.grove.y - 22, TREE_W, TREE_H)}>
          <PixelArt cacheKey="tree-fruit" frames={TREE_FRAMES_FRUITING} palette={TREE_PALETTE} width={TREE_W} height={TREE_H} scale={SCALE} speed={900} />
        </div>
        {[
          [STATIONS.camp.x - 32, STATIONS.camp.y + 26],
          [STATIONS.camp.x + 30, STATIONS.camp.y + 34],
        ].map(([x, y], i) => (
          <div key={`s${i}`} className="ow-prop" style={propStyle(x!, y!, STUMP_W, STUMP_H)}>
            <PixelArt cacheKey="stump" frames={STUMP_FRAMES} palette={PROP_PALETTE} width={STUMP_W} height={STUMP_H} scale={SCALE} />
          </div>
        ))}
        {WORKSHOP_BENCHES.map(([x, y], i) => (
          <div key={`b${i}`} className="ow-prop" style={propStyle(x, y, BENCH_W, BENCH_H)}>
            <PixelArt cacheKey="bench" frames={BENCH_FRAMES} palette={PROP_PALETTE} width={BENCH_W} height={BENCH_H} scale={SCALE} />
          </div>
        ))}
        <div className="ow-prop" style={propStyle(STATIONS.board.x, STATIONS.board.y - 8, BOARD_W, BOARD_H)}>
          <PixelArt cacheKey="board" frames={BOARD_FRAMES} palette={PROP_PALETTE} width={BOARD_W} height={BOARD_H} scale={SCALE} />
        </div>

        {/* station name signs */}
        {(Object.keys(STATIONS) as StationKey[]).map((key) => (
          <span
            key={key}
            className={`ow-sign ${key === "board" ? "ow-sign-alert" : ""}`}
            style={{ left: STATIONS[key].x * SCALE, top: (STATIONS[key].y + 22) * SCALE }}
          >
            {STATIONS[key].label}
          </span>
        ))}

        {/* the dryads */}
        {placed.map(({ plot, x, y }) => (
          <Actor key={plot.worktree.id} plot={plot} x={x} y={y} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function propStyle(x: number, y: number, w: number, h: number): React.CSSProperties {
  return {
    left: (x - w / 2) * SCALE,
    top: (y - h) * SCALE,
    zIndex: Math.round(y),
  };
}

function Actor({
  plot,
  x,
  y,
  onOpen,
}: {
  plot: Plot;
  x: number;
  y: number;
  onOpen: (id: string) => void;
}) {
  const { worktree, repo, state, unseen, focused } = plot;
  const name = worktree.branch ?? worktree.head.slice(0, 7);

  return (
    <button
      className={`ow-actor ow-${state} ${focused ? "ow-focused" : ""}`}
      // Position via transform so the walk is a single animatable property.
      style={{ transform: `translate(${x * SCALE}px, ${y * SCALE}px)`, zIndex: Math.round(y) + 1 }}
      onClick={() => onOpen(worktree.id)}
      data-tip={`${name} — ${STATE_WORD[state]} · ${repo.name} · click to open`}
    >
      <span className="actor-name">
        {name}
        {unseen && !focused && <span className="actor-dot" />}
      </span>
      <span className="ow-body">
        <Sprite state={state} scale={2} />
      </span>
      {state === "idle" && (
        <>
          <span className="zzz zzz-a">z</span>
          <span className="zzz zzz-b">z</span>
        </>
      )}
      {state === "working" && <span className="ow-firefly" />}
      {state === "success" && (
        <>
          <span className="ow-spark ow-spark-a" />
          <span className="ow-spark ow-spark-b" />
        </>
      )}
      {state === "error" && <span className="ow-alert">!</span>}
    </button>
  );
}
