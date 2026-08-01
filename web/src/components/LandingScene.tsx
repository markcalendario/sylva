import { useEffect, useMemo, useRef, useState } from "react";
import { PixelArt } from "../sprites/pixel";
import { Sprite } from "../sprites/Sprite";
import { BOARD_FRAMES, BOARD_H, BOARD_W, PROP_PALETTE } from "../sprites/props";
import { TREE_FRAMES, TREE_FRAMES_FRUITING, TREE_H, TREE_PALETTE, TREE_W } from "../sprites/tree";
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
  SHED_FRAMES,
  SHED_H,
  SHED_W,
  TENT_FRAMES,
  TENT_H,
  TENT_W,
  VILLAGE_PALETTE,
} from "../sprites/village";
import { LANDSCAPE_SCALE as S, renderLandscape, TREE_RISE } from "../sprites/landscape";
import "./landingScene.css";

/** Ground height in map pixels. Sky is whatever sits above it. */
const GROUND_H = 118;
/** Sky height in map pixels — room for the wordmark and the meteors. */
const SKY_H = 74;

/** Where each named area sits, as a fraction of the scene's width. */
const AREAS = [
  { key: "camp", label: "camp", at: 0.17 },
  { key: "grove", label: "grove", at: 0.42 },
  { key: "board", label: "needs you", at: 0.63 },
  { key: "workshop", label: "workshop", at: 0.85 },
] as const;

/**
 * The landing page's scene: the same night forest the app runs in, standing
 * still. It exists to say what Sylva feels like before it says what Sylva does,
 * so it is scenery rather than a map — the four areas are labelled because
 * those labels are the whole mental model.
 */
export function LandingScene() {
  const wrap = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      // Only ever write a different value, or the observer re-enters through
      // layout and never settles.
      setViewWidth((current) => (current === next ? current : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = viewWidth > 0 ? Math.max(220, Math.floor(viewWidth / S)) : 0;

  return (
    <div className="scene-wrap" ref={wrap}>
      {width > 0 && <Scene width={width} />}
    </div>
  );
}

function Scene({ width }: { width: number }) {
  const ground = useMemo(() => renderLandscape(width, GROUND_H), [width]);
  const groundTop = SKY_H * S;

  /** Places a sprite by its bottom-centre, in ground-map coordinates. */
  const at = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    left: (x - w / 2) * S,
    top: groundTop + (y - h) * S,
    width: w * S,
    height: h * S,
  });

  // Deterministic sky: the same stars every visit, so it reads as a place.
  const stars = useMemo(() => {
    const out: Array<{ x: number; y: number; warm: boolean; dim: number }> = [];
    let seed = 0x51_1a;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 8) & 0xffff) / 0xffff;
    };
    for (let i = 0; i < 40; i++) {
      out.push({
        x: Math.round(rand() * width * S),
        y: Math.round(rand() * (SKY_H * S - 24)),
        warm: rand() < 0.2,
        dim: 0.16 + rand() * 0.4,
      });
    }
    return out;
  }, [width]);

  const campX = Math.round(width * AREAS[0].at);
  const groveX = Math.round(width * AREAS[1].at);
  const boardX = Math.round(width * AREAS[2].at);
  const shopX = Math.round(width * AREAS[3].at);

  return (
    <div
      className="scene"
      style={{ width: width * S, height: (SKY_H + GROUND_H) * S }}
      aria-hidden="true"
    >
      {stars.map((s, i) => (
        <span
          key={`star${i}`}
          className="scene-star"
          style={{
            left: s.x,
            top: s.y,
            width: s.warm ? 3 : 2,
            height: s.warm ? 3 : 2,
            background: s.warm ? "var(--firefly)" : "var(--moon)",
            opacity: s.warm ? 0.8 : s.dim,
            boxShadow: s.warm ? "0 0 8px var(--firefly)" : "none",
          }}
        />
      ))}

      {/* Meteors. Long, staggered delays so they read as occasional rather
          than as a loop you can time. */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={`meteor${i}`}
          className="scene-meteor"
          style={{
            left: `${18 + i * 15}%`,
            top: `${4 + ((i * 7) % 26)}px`,
            animationDelay: `${i * 3.7 + 1}s`,
            animationDuration: `${5 + (i % 3)}s`,
          }}
        />
      ))}

      <div
        className="scene-ground"
        style={{
          top: groundTop - TREE_RISE * S,
          width: width * S,
          height: (GROUND_H + TREE_RISE) * S,
          backgroundImage: `url(${ground})`,
        }}
      />

      {/* Warm light. The one warm thing in a cold night. */}
      <span className="scene-glow scene-glow-fire" style={glow(campX + 26, 46, 118, groundTop)} />
      <span className="scene-glow scene-glow-lamp" style={glow(campX - 8, 30, 70, groundTop)} />
      <span className="scene-glow scene-glow-lamp" style={glow(shopX + 4, 34, 78, groundTop)} />

      {/* camp */}
      <div className="scene-prop" style={at(campX - 40, 40, TENT_W, TENT_H)}>
        <PixelArt cacheKey="tent" frames={TENT_FRAMES} palette={VILLAGE_PALETTE} width={TENT_W} height={TENT_H} scale={S} />
      </div>
      <div className="scene-prop" style={at(campX - 6, 48, HOUSE_W, HOUSE_H)}>
        <PixelArt cacheKey="house" frames={HOUSE_FRAMES} palette={VILLAGE_PALETTE} width={HOUSE_W} height={HOUSE_H} scale={S} speed={1500} />
      </div>
      <div className="scene-prop" style={at(campX + 26, 54, FIRE_W, FIRE_H)}>
        <PixelArt cacheKey="campfire" frames={FIRE_FRAMES} palette={VILLAGE_PALETTE} width={FIRE_W} height={FIRE_H} scale={S} speed={130} />
      </div>
      <div className="scene-prop" style={at(campX - 20, 56, LAMP_W, LAMP_H)}>
        <PixelArt cacheKey="lamp" frames={LAMP_FRAMES} palette={VILLAGE_PALETTE} width={LAMP_W} height={LAMP_H} scale={S} speed={900} />
      </div>

      {/* grove */}
      <div className="scene-prop" style={at(groveX, 44, TREE_W, TREE_H)}>
        <PixelArt cacheKey="tree-fruit" frames={TREE_FRAMES_FRUITING} palette={TREE_PALETTE} width={TREE_W} height={TREE_H} scale={S} speed={900} />
      </div>

      {/* needs you */}
      <div className="scene-prop" style={at(boardX, 48, BOARD_W, BOARD_H)}>
        <PixelArt cacheKey="board" frames={BOARD_FRAMES} palette={PROP_PALETTE} width={BOARD_W} height={BOARD_H} scale={S} />
      </div>

      {/* workshop */}
      <div className="scene-prop" style={at(shopX + 6, 48, SHED_W, SHED_H)}>
        <PixelArt cacheKey="shed" frames={SHED_FRAMES} palette={VILLAGE_PALETTE} width={SHED_W} height={SHED_H} scale={S} speed={420} />
      </div>
      <div className="scene-prop" style={at(shopX - 26, 56, LAMP_W, LAMP_H)}>
        <PixelArt cacheKey="lamp" frames={LAMP_FRAMES} palette={VILLAGE_PALETTE} width={LAMP_W} height={LAMP_H} scale={S} speed={900} />
      </div>

      {/* Edge trees, framing the scene. */}
      <div className="scene-prop" style={at(10, 86, TREE_W, TREE_H)}>
        <PixelArt cacheKey="tree" frames={TREE_FRAMES} palette={TREE_PALETTE} width={TREE_W} height={TREE_H} scale={S} speed={1000} />
      </div>
      <div className="scene-prop" style={at(width - 10, 82, TREE_W, TREE_H)}>
        <PixelArt cacheKey="tree" frames={TREE_FRAMES} palette={TREE_PALETTE} width={TREE_W} height={TREE_H} scale={S} speed={1000} />
      </div>

      {/* One dryad per area, each in the state that area means. */}
      <Dryad state="idle" x={campX + 4} y={76} groundTop={groundTop} />
      <Dryad state="success" x={groveX} y={80} groundTop={groundTop} />
      <Dryad state="error" x={boardX} y={78} groundTop={groundTop} />
      <Dryad state="working" x={shopX - 8} y={76} groundTop={groundTop} />

      {/* The labels are the point: this is the vocabulary the whole app uses. */}
      {AREAS.map((area) => (
        <span
          key={area.key}
          className={`scene-sign ${area.key === "board" ? "scene-sign-alert" : ""}`}
          style={{ left: Math.round(width * area.at) * S, top: groundTop + 84 * S }}
        >
          {area.label}
        </span>
      ))}
    </div>
  );
}

function glow(x: number, y: number, r: number, groundTop: number): React.CSSProperties {
  return {
    left: x * S - r,
    top: groundTop + y * S - r,
    width: r * 2,
    height: r * 2,
  };
}

function Dryad({
  state,
  x,
  y,
  groundTop,
}: {
  state: "idle" | "working" | "success" | "error";
  x: number;
  y: number;
  groundTop: number;
}) {
  return (
    <div
      className={`scene-dryad scene-dryad-${state}`}
      style={{ left: x * S - 12 * S, top: groundTop + (y - 24) * S }}
    >
      <Sprite state={state} scale={S} />
    </div>
  );
}
