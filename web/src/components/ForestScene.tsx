import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  computeLayout,
  renderPlane,
  ROW,
  SCALE,
  type Layout,
  type StationKey,
} from "../sprites/tilemap";
import {
  FIRE_FRAMES,
  FIRE_H,
  FIRE_W,
  HOUSE_FRAMES,
  HOUSE_H,
  HOUSE_W,
  LAMP_FRAMES,
  LAMP_H,
  LAMP_W,
  MOTH_FRAMES,
  MOTH_H,
  MOTH_W,
  RABBIT_FRAMES,
  RABBIT_H,
  RABBIT_W,
  SHED_FRAMES,
  SHED_H,
  SHED_W,
  TENT_FRAMES,
  TENT_H,
  TENT_W,
  VILLAGE_PALETTE,
} from "../sprites/village";
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

/** Labels float over the world; ambience floats over the labels. */
const Z_SIGN = 900;
const Z_AIR = 940;

/**
 * The overworld. Stations are places — camp, workshop, grove, notice board —
 * and each dryad walks to the one its state names. The map is generated to the
 * width of this panel, so it fits without scrolling sideways at any window
 * size, and grows downwards instead as worktrees are added.
 */
export function ForestScene({ plots, onOpen }: { plots: Plot[]; onOpen: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      // Only ever set a different value: a state write on every observation
      // would re-enter the observer through layout and never settle.
      setViewWidth((current) => (current === next ? current : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => (viewWidth > 0 ? computeLayout(viewWidth, plots.length) : null),
    [viewWidth, plots.length],
  );

  return (
    <div className="overworld-wrap" ref={wrap}>
      {layout && <Plane layout={layout} plots={plots} onOpen={onOpen} />}
    </div>
  );
}

function Plane({
  layout,
  plots,
  onOpen,
}: {
  layout: Layout;
  plots: Plot[];
  onOpen: (id: string) => void;
}) {
  const plane = useMemo(() => renderPlane(layout), [layout]);
  const { stations } = layout;

  // Dryads pack into their station's slots in worktree order, filling from the
  // first. Indexing by position in the whole roster looks stabler but isn't:
  // states cycle, so roster index and station membership fall into step and
  // every dryad at a station lands in the same column.
  // Nameplates are narrower than most branch names, and "feature/overworl" cut
  // off tells you nothing. Where the last segment identifies every dryad on
  // its own, show that instead; the roster and the tooltip keep the full name.
  const labels = useMemo(() => byLeafSegment(plots), [plots]);

  const taken = new Map<StationKey, number>();
  const placed = [...plots]
    .sort((a, b) => a.worktree.id.localeCompare(b.worktree.id))
    .map((plot) => {
      const key = STATE_STATION[plot.state];
      const station = stations[key];
      const next = taken.get(key) ?? 0;
      taken.set(key, next + 1);
      const slot = station.slots[next % station.slots.length] ?? station;
      return { plot, x: slot.x, y: slot.y };
    });

  return (
    <div
      className="overworld"
      style={{
        width: layout.width * SCALE,
        height: layout.height * SCALE,
        backgroundImage: `url(${plane})`,
      }}
    >
      {/* Pools of light. Under the props, over the ground. */}
      {layout.glows.map((glow, i) => (
        <span
          key={`glow${i}`}
          className={`ow-glow ${glow.warm ? "ow-glow-warm" : "ow-glow-cool"}`}
          style={{
            left: (glow.x - glow.r) * SCALE,
            top: (glow.y - glow.r) * SCALE,
            width: glow.r * 2 * SCALE,
            height: glow.r * 2 * SCALE,
            zIndex: Math.max(0, Math.round(glow.y) - 2),
          }}
        />
      ))}

      {/* Trees: the fruiting one marks the grove, the rest frame the map. */}
      {layout.trees.map((tree, i) => (
        <div key={`tree${i}`} className="ow-prop" style={at(tree.x, tree.y, TREE_W, TREE_H)}>
          <PixelArt
            cacheKey={tree.fruit ? "tree-fruit" : "tree"}
            frames={tree.fruit ? TREE_FRAMES_FRUITING : TREE_FRAMES}
            palette={TREE_PALETTE}
            width={TREE_W}
            height={TREE_H}
            scale={SCALE}
            speed={tree.fruit ? 900 : 1000}
          />
        </div>
      ))}

      {/* The camp: a cabin with the candle lit, tents, and the fire. */}
      <div className="ow-prop" style={at(layout.house.x, layout.house.y, HOUSE_W, HOUSE_H)}>
        <PixelArt
          cacheKey="house"
          frames={HOUSE_FRAMES}
          palette={VILLAGE_PALETTE}
          width={HOUSE_W}
          height={HOUSE_H}
          scale={SCALE}
          speed={1500}
        />
      </div>
      <Smoke x={layout.house.x - 13} y={layout.house.y - HOUSE_H} />

      {layout.tents.map((tent, i) => (
        <div key={`tent${i}`} className="ow-prop" style={at(tent.x, tent.y, TENT_W, TENT_H)}>
          <PixelArt
            cacheKey="tent"
            frames={TENT_FRAMES}
            palette={VILLAGE_PALETTE}
            width={TENT_W}
            height={TENT_H}
            scale={SCALE}
          />
        </div>
      ))}

      <div
        className="ow-prop"
        style={at(layout.campfire.x, layout.campfire.y, FIRE_W, FIRE_H)}
      >
        <PixelArt
          cacheKey="campfire"
          frames={FIRE_FRAMES}
          palette={VILLAGE_PALETTE}
          width={FIRE_W}
          height={FIRE_H}
          scale={SCALE}
          speed={130}
        />
      </div>

      {/* The workshop: an open shed with the forge banked, and its benches. */}
      <div className="ow-prop" style={at(layout.shed.x, layout.shed.y, SHED_W, SHED_H)}>
        <PixelArt
          cacheKey="shed"
          frames={SHED_FRAMES}
          palette={VILLAGE_PALETTE}
          width={SHED_W}
          height={SHED_H}
          scale={SCALE}
          speed={420}
        />
      </div>
      <Smoke x={layout.shed.x + 18} y={layout.shed.y - SHED_H} />

      {layout.benches.map((bench, i) => (
        <div key={`bench${i}`} className="ow-prop" style={at(bench.x, bench.y, BENCH_W, BENCH_H)}>
          <PixelArt
            cacheKey="bench"
            frames={BENCH_FRAMES}
            palette={PROP_PALETTE}
            width={BENCH_W}
            height={BENCH_H}
            scale={SCALE}
          />
        </div>
      ))}

      {layout.stumps.map((stump, i) => (
        <div key={`stump${i}`} className="ow-prop" style={at(stump.x, stump.y, STUMP_W, STUMP_H)}>
          <PixelArt
            cacheKey="stump"
            frames={STUMP_FRAMES}
            palette={PROP_PALETTE}
            width={STUMP_W}
            height={STUMP_H}
            scale={SCALE}
          />
        </div>
      ))}

      {/* Lamps along the road, at the door, and at the bridgehead. */}
      {layout.lamps.map((lamp, i) => (
        <div key={`lamp${i}`} className="ow-prop" style={at(lamp.x, lamp.y, LAMP_W, LAMP_H)}>
          <PixelArt
            cacheKey="lamp"
            frames={LAMP_FRAMES}
            palette={VILLAGE_PALETTE}
            width={LAMP_W}
            height={LAMP_H}
            scale={SCALE}
            speed={900}
          />
        </div>
      ))}

      <div
        className="ow-prop"
        style={at(layout.boardProp.x, layout.boardProp.y, BOARD_W, BOARD_H)}
      >
        <PixelArt
          cacheKey="board"
          frames={BOARD_FRAMES}
          palette={PROP_PALETTE}
          width={BOARD_W}
          height={BOARD_H}
          scale={SCALE}
        />
      </div>

      {/* Nobody's pets: a rabbit on the riverbank and a moth at the lamp. */}
      <div
        className="ow-prop ow-rabbit"
        style={
          {
            ...at(layout.rabbit.x, layout.rabbit.y, RABBIT_W, RABBIT_H),
            "--travel": `${layout.rabbit.travel * SCALE}px`,
          } as React.CSSProperties
        }
      >
        <PixelArt
          cacheKey="rabbit"
          frames={RABBIT_FRAMES}
          palette={VILLAGE_PALETTE}
          width={RABBIT_W}
          height={RABBIT_H}
          scale={SCALE}
          speed={260}
        />
      </div>
      <div className="ow-prop ow-moth" style={at(layout.moth.x, layout.moth.y, MOTH_W, MOTH_H)}>
        <PixelArt
          cacheKey="moth"
          frames={MOTH_FRAMES}
          palette={VILLAGE_PALETTE}
          width={MOTH_W}
          height={MOTH_H}
          scale={SCALE}
          speed={110}
        />
      </div>

      {/* Water catching the moon. */}
      <span
        className="ow-shimmer"
        style={{
          left: (layout.pond.x - layout.pond.rx + 6) * SCALE,
          top: layout.pond.y * SCALE,
          width: (layout.pond.rx * 2 - 12) * SCALE,
          zIndex: Math.round(layout.pond.y),
        }}
      />
      <span
        className="ow-shimmer ow-shimmer-slow"
        style={{
          left: 0,
          top: (layout.streamY - 2) * SCALE,
          width: layout.width * SCALE,
          zIndex: Math.round(layout.streamY),
        }}
      />

      {/* Station names. */}
      {(Object.keys(stations) as StationKey[]).map((key) => (
        <span
          key={key}
          className={`ow-sign ${key === "board" ? "ow-sign-alert" : ""}`}
          style={{
            left: stations[key].x * SCALE,
            top: (stations[key].y + (layout.rows - 1) * ROW + 18) * SCALE,
            zIndex: Z_SIGN,
          }}
        >
          {stations[key].label}
        </span>
      ))}

      {/* The dryads. */}
      {placed.map(({ plot, x, y }) => (
        <Actor
          key={plot.worktree.id}
          plot={plot}
          label={labels.get(plot.worktree.id) ?? ""}
          x={x}
          y={y}
          onOpen={onOpen}
        />
      ))}

      {/* Ambience, over everything: fireflies at large and leaves on the wind.
          Both wander, so they live in a clipped layer — otherwise a leaf blown
          past the eastern edge widens the plane and puts the panel back into
          horizontal scrolling. */}
      <div className="ow-air" style={{ zIndex: Z_AIR }}>
        {layout.fireflies.map((fly, i) => (
          <span
            key={`fly${i}`}
            className="ow-wild-fly"
            style={{
              left: fly.x * SCALE,
              top: fly.y * SCALE,
              animationDelay: `-${fly.delay}s`,
              animationDuration: `${fly.dur}s`,
            }}
          />
        ))}
        {layout.leaves.map((leaf, i) => (
          <span
            key={`leaf${i}`}
            className={`ow-leaf ${i % 3 === 0 ? "ow-leaf-warm" : ""}`}
            style={
              {
                left: leaf.x * SCALE,
                animationDelay: `-${leaf.delay}s`,
                animationDuration: `${leaf.dur}s`,
                "--drift": `${(i % 2 === 0 ? 1 : -1) * leaf.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

/** Chimney smoke: three puffs on the same path, spaced out in time. */
function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ow-smoke"
          style={{
            left: x * SCALE,
            top: y * SCALE,
            zIndex: Z_SIGN - 1,
            animationDelay: `${i * 1.6}s`,
          }}
        />
      ))}
    </>
  );
}

/** Places a sprite by its bottom-centre, and sorts it by how near it stands. */
function at(x: number, y: number, w: number, h: number): React.CSSProperties {
  return {
    left: (x - w / 2) * SCALE,
    top: (y - h) * SCALE,
    zIndex: Math.round(y),
  };
}

/** Full branch name for each worktree, and a short form to put on the map. */
function fullName(plot: Plot): string {
  return plot.worktree.branch ?? plot.worktree.head.slice(0, 7);
}

function byLeafSegment(plots: Plot[]): Map<string, string> {
  const full = new Map(plots.map((p) => [p.worktree.id, fullName(p)]));
  const leaves = plots.map((p) => fullName(p).split("/").pop() ?? "");
  // Two branches ending in the same word would become indistinguishable, so
  // shortening is all-or-nothing across the scene.
  if (new Set(leaves).size !== plots.length) return full;
  return new Map(plots.map((p, i) => [p.worktree.id, leaves[i] ?? full.get(p.worktree.id) ?? ""]));
}

function Actor({
  plot,
  label,
  x,
  y,
  onOpen,
}: {
  plot: Plot;
  label: string;
  x: number;
  y: number;
  onOpen: (id: string) => void;
}) {
  const { worktree, repo, state, unseen, focused } = plot;
  const name = fullName(plot);

  return (
    <button
      className={`ow-actor ow-${state} ${focused ? "ow-focused" : ""}`}
      // Position via transform so the walk is a single animatable property.
      style={{ transform: `translate(${x * SCALE}px, ${y * SCALE}px)`, zIndex: Math.round(y) + 1 }}
      onClick={() => onOpen(worktree.id)}
      data-tip={`${name} — ${STATE_WORD[state]} · ${repo.name} · click to open`}
    >
      <span className="actor-name">
        {label || name}
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
