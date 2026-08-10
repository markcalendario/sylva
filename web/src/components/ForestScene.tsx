import { useEffect, useMemo, useRef, useState } from "react";
import { GROVE_ID, type Repo, type Worktree, type WorktreeStatus } from "sylva-shared";
import type { SpriteState } from "../sprites/frames";
import { playNoise, type Noise } from "../lib/audio";
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
  RISE,
  ROW,
  SCALE,
  SKY,
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
  FROG_FRAMES,
  FROG_H,
  FROG_W,
  OWL_FRAMES,
  OWL_H,
  OWL_W,
  RABBIT_FRAMES,
  RABBIT_H,
  RABBIT_W,
  GATE_FRAMES,
  GATE_H,
  GATE_W,
  SHED_FRAMES,
  SHED_H,
  SHED_W,
  SHRINE_FRAMES,
  SHRINE_H,
  SHRINE_W,
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
  /** Tokens this worktree's dryad has read and written. */
  tokens?: number;
  unseen: boolean;
  focused: boolean;
}

/**
 * A shared dryad on the map: several trees tended by one agent, so several
 * sprites travelling together as one. Its station comes from the shared
 * session's state, not from any one member's.
 */
export interface CirclePlot {
  id: string;
  members: { worktree: Worktree; repo: Repo }[];
  state: SpriteState;
  unseen: boolean;
  focused: boolean;
}

/**
 * The grove dryad, which tends no tree at all.
 *
 * It belongs on the map for the same reason the others do: the forest is meant
 * to answer "who is working and who needs me" in one look, and a dryad you can
 * only find by remembering a button in the top bar is a dryad that gets
 * forgotten while it waits.
 */
export interface GrovePlot {
  state: SpriteState;
  unseen: boolean;
  focused: boolean;
  /** How many repositories it can read, for the tooltip. */
  repoCount: number;
}

/**
 * Anything that stands somewhere and walks. A lone dryad has a crew of one, a
 * circle has one per worktree — which keeps the station claiming, the walking
 * and the thought bubbles from ever needing to know which they are looking at.
 */
interface SceneActor {
  id: string;
  state: SpriteState;
  unseen: boolean;
  focused: boolean;
  /** How many dryads to draw. More than one is drawn inside a bubble. */
  crew: number;
  label: string;
  tip: string;
  onOpen: () => void;
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

/**
 * What a dryad might be thinking, by what it is doing. Short, lowercase and
 * wordless where possible — these are atmosphere, not status text, and the
 * nameplate above them is already doing the reporting.
 */
const THOUGHTS: Record<SpriteState, string[]> = {
  idle: ["zzz", "…", "*yawn*", "hm?"],
  working: ["hmm", "aha", "*tap tap*", "nearly", "…"],
  success: ["done!", "✓", "♪", "at last"],
  error: ["?", "psst", "hey!", "waiting…"],
};

/** Sounds the world makes on its own, and the animals living in it. */
const NOISES = {
  tree: ["rustle", "~", "creak"],
  fire: ["crackle", "pop", "✦"],
  water: ["plip", "~", "burble"],
  forge: ["clink", "tink"],
  owl: ["hoo", "hoo…", "who?"],
  frog: ["ribbit", "*croak*"],
  cricket: ["chirp", "chrr", "♪"],
} as const;

interface Bubble {
  id: number;
  x: number;
  y: number;
  text: string;
  thought: boolean;
}

interface BubbleSource {
  x: number;
  y: number;
  phrases: readonly string[];
  thought: boolean;
  /** Scenery sound to play with the bubble, if this source makes one. */
  sound?: Noise;
}

/**
 * One bubble at a time, from a pool of everything that could make a sound.
 * Driven by a timer rather than per-source CSS so the world stays quiet most
 * of the time and never falls into a rhythm you can predict — and it reads the
 * sources through a ref, so a dryad moving doesn't restart the whole cycle.
 */
function useBubbles(sources: React.RefObject<BubbleSource[]>): Bubble[] {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let nextId = 0;
    const timers = new Set<number>();

    // Ten seconds apart at the least, with jitter on top. Ambience that
    // arrives on a countable beat stops being ambience.
    let tick = 0;
    const schedule = (): void => {
      tick = window.setTimeout(() => {
        emit();
        schedule();
      }, 10_000 + Math.random() * 7000);
    };

    const emit = (): void => {
      const pool = sources.current ?? [];
      if (pool.length === 0) return;
      const source = pool[Math.floor(Math.random() * pool.length)];
      if (!source) return;
      const text = source.phrases[Math.floor(Math.random() * source.phrases.length)];
      if (!text) return;
      const bubble: Bubble = {
        id: (nextId += 1),
        x: source.x,
        y: source.y,
        text,
        thought: source.thought,
      };
      // The bubble is the picture of the sound, so they go together.
      if (source.sound) playNoise(source.sound);
      // Keep at most three in the air; more reads as chatter, not ambience.
      setBubbles((current) => [...current.slice(-2), bubble]);
      const clear = window.setTimeout(() => {
        setBubbles((current) => current.filter((b) => b.id !== bubble.id));
        timers.delete(clear);
      }, 3800);
      timers.add(clear);
    };

    schedule();

    return () => {
      window.clearTimeout(tick);
      for (const t of timers) window.clearTimeout(t);
    };
  }, [sources]);

  return bubbles;
}

/** Labels float over the world; ambience floats over the labels. */
const Z_SIGN = 900;
const Z_AIR = 940;

/**
 * Where the scene last painted each dryad. Module state on purpose: leaving the
 * forest unmounts the scene, and a dryad that changed station while you were
 * away has to be put back where you last saw it so the walk still plays when
 * you return. A dryad we have never painted starts at the camp, which is where
 * one is when nothing is running.
 */
const standing = new Map<string, StationKey>();

/**
 * The overworld. Stations are places — camp, workshop, grove, notice board —
 * and each dryad walks to the one its state names. The map is generated to the
 * width of this panel, so it fits without scrolling sideways at any window
 * size, and grows downwards instead as worktrees are added.
 */
export function ForestScene({
  plots,
  circles = [],
  grove,
  onOpen,
  onOpenCircle,
  onOpenGrove,
}: {
  plots: Plot[];
  circles?: CirclePlot[];
  grove?: GrovePlot;
  onOpen: (id: string) => void;
  onOpenCircle?: (worktreeIds: string[]) => void;
  onOpenGrove?: () => void;
}) {
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
    // Circles and the grove stand on the map too, so they count towards how
    // much of it there needs to be.
    () =>
      viewWidth > 0
        ? computeLayout(viewWidth, plots.length + circles.length + (grove ? 1 : 0))
        : null,
    [viewWidth, plots.length, circles.length, grove ? 1 : 0],
  );

  return (
    <div className="overworld-wrap" ref={wrap}>
      {layout && (
        <Plane
          layout={layout}
          plots={plots}
          circles={circles}
          {...(grove ? { grove } : {})}
          onOpen={onOpen}
          {...(onOpenCircle ? { onOpenCircle } : {})}
          {...(onOpenGrove ? { onOpenGrove } : {})}
        />
      )}
    </div>
  );
}

function Plane({
  layout,
  plots,
  circles,
  grove,
  onOpen,
  onOpenCircle,
  onOpenGrove,
}: {
  layout: Layout;
  plots: Plot[];
  circles: CirclePlot[];
  grove?: GrovePlot;
  onOpen: (id: string) => void;
  onOpenCircle?: (worktreeIds: string[]) => void;
  onOpenGrove?: () => void;
}) {
  const plane = useMemo(() => renderPlane(layout), [layout]);
  const { stations } = layout;

  // A deterministic night: the same stars every time the forest is opened, so
  // it reads as one place rather than a fresh random sky on each visit.
  const sky = useMemo(() => {
    let seed = 0x51_1a;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 8) & 0xffff) / 0xffff;
    };
    const stars = Array.from({ length: 34 }, () => ({
      x: Math.round(rand() * layout.width * SCALE),
      y: Math.round(rand() * (SKY * SCALE - 14)),
      warm: rand() < 0.18,
      dim: 0.16 + rand() * 0.4,
    }));
    const meteors = Array.from({ length: 4 }, (_, i) => ({
      left: 20 + i * 20,
      top: 4 + ((i * 9) % 22),
      delay: i * 5.3 + 2,
      dur: 7 + (i % 3),
    }));
    return { stars, meteors };
  }, [layout.width]);

  // Dryads pack into their station's slots in worktree order, filling from the
  // first. Indexing by position in the whole roster looks stabler but isn't:
  // states cycle, so roster index and station membership fall into step and
  // every dryad at a station lands in the same column.
  // Nameplates are narrower than most branch names, and "feature/overworl" cut
  // off tells you nothing. Where the last segment identifies every dryad on
  // its own, show that instead; the roster and the tooltip keep the full name.
  const labels = useMemo(() => byLeafSegment(plots), [plots]);

  /**
   * Circles first: they are the fewest and the most consequential, so when two
   * actors land on the same slot the shared one keeps the nearer place.
   */
  const actors: SceneActor[] = useMemo(() => {
    // The grove leads for the same reason circles do: there is one of it, it
    // is the odd one out, and when it shares a slot it should keep the front.
    const fromGrove: SceneActor[] = grove
      ? [
          {
            id: GROVE_ID,
            state: grove.state,
            unseen: grove.unseen,
            focused: grove.focused,
            crew: 1,
            label: "the grove",
            tip: `the grove — tends no tree, ${
              grove.repoCount === 0
                ? "no repositories registered yet"
                : `can read ${grove.repoCount} ${grove.repoCount === 1 ? "repository" : "repositories"}`
            } · ${STATE_WORD[grove.state]} · click to open`,
            onOpen: () => onOpenGrove?.(),
          },
        ]
      : [];

    const fromCircles = circles.map((circle) => {
      const names = circle.members.map(
        (m) => m.worktree.branch ?? m.worktree.head.slice(0, 7),
      );
      return {
        id: circle.id,
        state: circle.state,
        unseen: circle.unseen,
        focused: circle.focused,
        crew: circle.members.length,
        label: `${circle.members.length} trees`,
        tip: `one dryad, ${circle.members.length} worktrees — ${names.join(" + ")} · ${STATE_WORD[circle.state]} · click to open`,
        onOpen: () => onOpenCircle?.(circle.members.map((m) => m.worktree.id)),
      } satisfies SceneActor;
    });

    const fromPlots = plots.map((plot) => {
      const name = fullName(plot);
      return {
        id: plot.worktree.id,
        state: plot.state,
        unseen: plot.unseen,
        focused: plot.focused,
        crew: 1,
        label: labels.get(plot.worktree.id) || name,
        tip: `${name} — ${STATE_WORD[plot.state]} · ${plot.repo.name} · click to open`,
        onOpen: () => onOpen(plot.worktree.id),
      } satisfies SceneActor;
    });

    return [...fromGrove, ...fromCircles, ...fromPlots];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots, circles, grove, labels]);

  // Position comes from where each dryad is *painted*, which lags where its
  // state says it should be until the walk has been kicked off below. A CSS
  // transition needs a value to move from, so rendering an actor straight into
  // its destination — which is what happens when you open the forest after
  // starting an agent elsewhere — teleports it instead of walking it.
  const [painted, setPainted] = useState<Record<string, StationKey>>(() =>
    Object.fromEntries(actors.map((a) => [a.id, standing.get(a.id) ?? "camp"])),
  );
  const stationFor = (actor: SceneActor): StationKey =>
    painted[actor.id] ?? standing.get(actor.id) ?? "camp";

  const destinations = actors.map((a) => `${a.id}:${STATE_STATION[a.state]}`).join(",");
  useEffect(() => {
    // Two frames deep: the first commit has to reach the screen at the old
    // station before the new one is applied, or the browser folds both into a
    // single paint and there is nothing to animate between.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setPainted((current) => {
          let moved = false;
          const next = { ...current };
          for (const actor of actors) {
            const target = STATE_STATION[actor.state];
            standing.set(actor.id, target);
            if (next[actor.id] !== target) {
              next[actor.id] = target;
              moved = true;
            }
          }
          // Same object back when nobody moved, so this can't spin the loop.
          return moved ? next : current;
        });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // `actors` is read inside; `destinations` is what decides if it matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations]);

  const sources = useRef<BubbleSource[]>([]);
  const bubbles = useBubbles(sources);

  const taken = new Map<StationKey, number>();
  const placed = [...actors]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((actor) => {
      // Claimed against the painted station, so a dryad reserves its place the
      // moment it sets off and no two ever glide onto the same spot.
      const key = stationFor(actor);
      const station = stations[key];
      const next = taken.get(key) ?? 0;
      taken.set(key, next + 1);
      const slot = station.slots[next % station.slots.length] ?? station;
      // Which leg goes first depends on the destination. The camp and workshop
      // sit on the east-west road, the grove and board on the north-south one,
      // so heading for a central station means "along, then up"; heading for a
      // lateral one means "down, then along". Either way it is a right angle.
      const alongFirst = key === "grove" || key === "board";
      return { actor, x: slot.x, y: slot.y, alongFirst };
    });

  // Everything in the world that could make a sound, plus everyone in it who
  // could have a thought. Rebuilt each render, read by the timer through a ref.
  sources.current = [
    ...placed.map((p) => ({
      x: p.x,
      y: p.y - 34,
      phrases: THOUGHTS[p.actor.state],
      thought: true,
    })),
    ...layout.trees.map((t) => ({
      x: t.x,
      y: t.y - 30,
      phrases: NOISES.tree,
      thought: false,
      sound: "rustle" as const,
    })),
    {
      x: layout.campfire.x,
      y: layout.campfire.y - 22,
      phrases: NOISES.fire,
      thought: false,
      sound: "fire" as const,
    },
    {
      x: layout.shed.x,
      y: layout.shed.y - 40,
      phrases: NOISES.forge,
      thought: false,
      sound: "forge" as const,
    },
    {
      x: layout.pond.x,
      y: layout.pond.y - 6,
      phrases: NOISES.water,
      thought: false,
      sound: "water" as const,
    },
    {
      x: Math.round(layout.width * 0.24),
      y: layout.streamY - 14,
      phrases: NOISES.water,
      thought: false,
      sound: "water" as const,
    },
    {
      x: Math.round(layout.width * 0.76),
      y: layout.streamY - 14,
      phrases: NOISES.water,
      thought: false,
      sound: "water" as const,
    },
    // The animals. They call from where they actually are, so the sound and
    // the bubble agree with the thing you can see.
    {
      x: layout.owl.x,
      y: layout.owl.y - 16,
      phrases: NOISES.owl,
      thought: false,
      sound: "owl" as const,
    },
    {
      x: layout.frog.x,
      y: layout.frog.y - 12,
      phrases: NOISES.frog,
      thought: false,
      sound: "frog" as const,
    },
    {
      x: layout.cricket.x,
      y: layout.cricket.y - 8,
      phrases: NOISES.cricket,
      thought: false,
      sound: "cricket" as const,
    },
    {
      x: layout.rabbit.x + 20,
      y: layout.rabbit.y - 12,
      phrases: NOISES.tree,
      thought: false,
      sound: "rustle" as const,
    },
  ];

  return (
    <div
      className="overworld"
      style={{ width: layout.width * SCALE, height: (layout.height + SKY) * SCALE }}
    >
      {/* Sky first, then the ground laid over it with the treeline breaking
          the join. Tipping the plane back this far is what makes room for it. */}
      <div
        className="ow-ground"
        style={{
          top: (SKY - RISE) * SCALE,
          width: layout.width * SCALE,
          height: (layout.height + RISE) * SCALE,
          backgroundImage: `url(${plane})`,
        }}
      />
      {sky.stars.map((star, i) => (
        <span
          key={`star${i}`}
          className="ow-star"
          style={{
            left: star.x,
            top: star.y,
            width: star.warm ? 3 : 2,
            height: star.warm ? 3 : 2,
            background: star.warm ? "var(--firefly)" : "var(--moon)",
            opacity: star.warm ? 0.8 : star.dim,
            boxShadow: star.warm ? "0 0 8px var(--firefly)" : "none",
          }}
        />
      ))}
      {sky.meteors.map((m, i) => (
        <span
          key={`meteor${i}`}
          className="ow-meteor"
          style={{ left: `${m.left}%`, top: m.top, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` }}
        />
      ))}
      {/* Fog banked at the foot of the treeline. Soft rather than pixelated on
          purpose: mist is the one thing in this world with no edges, and two
          bands drifting at different speeds read as depth. */}
      <span className="ow-fog ow-fog-far" style={{ top: (SKY - 16) * SCALE }} />
      <span className="ow-fog ow-fog-near" style={{ top: (SKY - 4) * SCALE }} />

      {/* Pools of light. Under the props, over the ground. */}
      {layout.glows.map((glow, i) => (
        <span
          key={`glow${i}`}
          className={`ow-glow ${glow.warm ? "ow-glow-warm" : "ow-glow-cool"}`}
          style={{
            left: (glow.x - glow.r) * SCALE,
            top: (glow.y - glow.r + SKY) * SCALE,
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

      {/* The grove's shrine: somewhere for finished work to be put. */}
      <div className="ow-prop" style={at(layout.shrine.x, layout.shrine.y, SHRINE_W, SHRINE_H)}>
        <PixelArt
          cacheKey="shrine"
          frames={SHRINE_FRAMES}
          palette={VILLAGE_PALETTE}
          width={SHRINE_W}
          height={SHRINE_H}
          scale={SCALE}
          speed={180}
        />
      </div>

      {/* The checkpoint. Its bar is down, which is the whole point. */}
      <div className="ow-prop" style={at(layout.gate.x, layout.gate.y, GATE_W, GATE_H)}>
        <PixelArt
          cacheKey="gate"
          frames={GATE_FRAMES}
          palette={VILLAGE_PALETTE}
          width={GATE_W}
          height={GATE_H}
          scale={SCALE}
          speed={800}
        />
      </div>

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
      <div className="ow-prop ow-owl" style={at(layout.owl.x, layout.owl.y, OWL_W, OWL_H)}>
        <PixelArt
          cacheKey="owl"
          frames={OWL_FRAMES}
          palette={VILLAGE_PALETTE}
          width={OWL_W}
          height={OWL_H}
          scale={SCALE}
          speed={2600}
        />
      </div>
      <div className="ow-prop ow-frog" style={at(layout.frog.x, layout.frog.y, FROG_W, FROG_H)}>
        <PixelArt
          cacheKey="frog"
          frames={FROG_FRAMES}
          palette={VILLAGE_PALETTE}
          width={FROG_W}
          height={FROG_H}
          scale={SCALE}
          speed={1400}
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
          top: (layout.pond.y + SKY) * SCALE,
          width: (layout.pond.rx * 2 - 12) * SCALE,
          zIndex: Math.round(layout.pond.y),
        }}
      />
      <span
        className="ow-shimmer ow-shimmer-slow"
        style={{
          left: 0,
          top: (layout.streamY - 2 + SKY) * SCALE,
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
            top: (stations[key].y + (layout.rows - 1) * ROW + 18 + SKY) * SCALE,
            zIndex: Z_SIGN,
          }}
        >
          {stations[key].label}
        </span>
      ))}

      {/* The dryads. */}
      {placed.map(({ actor, x, y, alongFirst }) => (
        <Actor key={actor.id} actor={actor} x={x} y={y} alongFirst={alongFirst} />
      ))}

      {/* Thoughts and noises. Above the props, below the signs. */}
      {bubbles.map((b) => (
        <span
          key={b.id}
          className={`ow-bubble ${b.thought ? "ow-bubble-thought" : "ow-bubble-noise"}`}
          style={{ left: b.x * SCALE, top: (b.y + SKY) * SCALE, zIndex: Z_SIGN - 2 }}
        >
          {b.text}
        </span>
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
              top: (fly.y + SKY) * SCALE,
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
            top: (y + SKY) * SCALE,
            zIndex: Z_SIGN - 1,
            animationDelay: `${i * 1.6}s`,
          }}
        />
      ))}
    </>
  );
}

/**
 * Places a sprite by its bottom-centre and sorts it by how near it stands.
 * Ground coordinates start below the sky band, so every one of them is offset
 * by SKY — there is exactly one place that happens, and this is it.
 */
function at(x: number, y: number, w: number, h: number): React.CSSProperties {
  return {
    left: (x - w / 2) * SCALE,
    top: (y - h + SKY) * SCALE,
    zIndex: Math.round(y),
  };
}

/** Full branch name for each worktree, and a short form to put on the map. */
function fullName(plot: Plot): string {
  return plot.worktree.branch ?? plot.worktree.head.slice(0, 7);
}

/**
 * Trim from the middle, not the end. Branch names carry their meaning in the
 * tail as often as the head — "feature/overworld-map" and
 * "feature/overworld-roads" are identical for sixteen characters — so cutting
 * the end is the one place you cannot afford to cut.
 *
 * The budget is in characters and the plate is sized in pixels, so the two
 * have to agree: 14 monospace characters at this size is what fits inside
 * --actor-name-max, and letting CSS clip instead would put the plain
 * end-truncation straight back.
 */
function shorten(name: string, budget = 14): string {
  if (name.length <= budget) return name;
  const head = Math.ceil((budget - 1) / 2);
  const tail = Math.floor((budget - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

function byLeafSegment(plots: Plot[]): Map<string, string> {
  const full = new Map(plots.map((p) => [p.worktree.id, fullName(p)]));
  const leaves = plots.map((p) => fullName(p).split("/").pop() ?? "");
  // Two branches ending in the same word would become indistinguishable, so
  // shortening is all-or-nothing across the scene.
  if (new Set(leaves).size !== plots.length) {
    return new Map(plots.map((p) => [p.worktree.id, shorten(full.get(p.worktree.id) ?? "")]));
  }
  return new Map(
    plots.map((p, i) => [p.worktree.id, shorten(leaves[i] ?? full.get(p.worktree.id) ?? "")]),
  );
}

function Actor({
  actor,
  x,
  y,
  alongFirst,
}: {
  actor: SceneActor;
  x: number;
  y: number;
  alongFirst: boolean;
}) {
  const { state, unseen, focused, crew, label, tip } = actor;
  const shared = crew > 1;

  // The two axes are separate elements so each can carry its own transition.
  // Delaying one by the other's duration turns what would be a diagonal glide
  // into a walk along the roads: east-west, then north-south, or the reverse.
  return (
    <button
      className={`ow-actor ow-lane-${alongFirst ? "x-first" : "y-first"} ${focused ? "ow-focused" : ""}`}
      style={{ transform: `translateX(${x * SCALE}px)`, zIndex: Math.round(y) + 1 }}
      onClick={actor.onOpen}
      // No expand-on-hover: the plate is centred on the dryad, so growing it
      // slides the name sideways under the pointer. The tooltip already has
      // the full branch, and it doesn't move anything to show it.
      data-tip={tip}
    >
      <span
        className={`ow-actor-lift ow-${state}`}
        style={{ transform: `translateY(${(y + SKY) * SCALE}px)` }}
      >
        <span className="actor-name">
          {label}
          {unseen && !focused && <span className="actor-dot" />}
        </span>
        {/* A shared dryad is several sprites travelling as one, so they are
            ringed together — the ring is the thing that says "these are not
            four dryads who happen to be standing near each other". */}
        <span className={`ow-body ${shared ? "ow-crew" : ""}`}>
          {Array.from({ length: crew }, (_, i) => (
            <Sprite key={i} state={state} scale={2} />
          ))}
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
      </span>
    </button>
  );
}
