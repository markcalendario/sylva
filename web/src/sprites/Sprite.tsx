import { useMemo } from "react";
import { GRID, PALETTE, SPRITE_FRAMES, SPRITE_SPEED, type SpriteState } from "./frames";
import "./sprite.css";

const sheetCache = new Map<string, string>();

/** Render a state's frames into a horizontal sprite-sheet PNG (data URI). */
function buildSheet(state: SpriteState): string {
  const cached = sheetCache.get(state);
  if (cached) return cached;
  const frames = SPRITE_FRAMES[state];
  const canvas = document.createElement("canvas");
  canvas.width = GRID * frames.length;
  canvas.height = GRID;
  const cx = canvas.getContext("2d");
  if (!cx) return "";
  frames.forEach((rows, f) => {
    for (let y = 0; y < GRID; y++) {
      const row = rows[y] ?? "";
      for (let x = 0; x < GRID; x++) {
        const color = PALETTE[row[x] ?? "."];
        if (!color || color === "transparent") continue;
        cx.fillStyle = color;
        cx.fillRect(f * GRID + x, y, 1, 1);
      }
    }
  });
  const uri = canvas.toDataURL("image/png");
  sheetCache.set(state, uri);
  return uri;
}

interface SpriteProps {
  state: SpriteState;
  /** Pixel scale factor; 2 → 32px, 4 → 64px. */
  scale?: number;
  title?: string;
}

/**
 * A dryad. The sheet is a horizontal strip; an inner element as wide as all
 * frames slides left with steps(n), showing one frame at a time.
 */
export function Sprite({ state, scale = 2, title }: SpriteProps) {
  const sheet = useMemo(() => buildSheet(state), [state]);
  const frames = SPRITE_FRAMES[state].length;
  const size = GRID * scale;
  return (
    <div
      className="sprite"
      role="img"
      aria-label={title ?? `sprite: ${state}`}
      title={title}
      style={{ width: size, height: size }}
    >
      <div
        className="sprite-strip"
        style={{
          width: size * frames,
          height: size,
          backgroundImage: `url(${sheet})`,
          backgroundSize: `${size * frames}px ${size}px`,
          animationDuration: `${SPRITE_SPEED[state] * frames}ms`,
          animationTimingFunction: `steps(${frames})`,
        }}
      />
    </div>
  );
}
