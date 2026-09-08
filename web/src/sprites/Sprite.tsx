import { useMemo } from "react";
import { useHasForest } from "../lib/theme";
import { Mascot } from "./Mascot";
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

/**
 * What the drawing is telling you, for the tooltip.
 *
 * Two sets, because the two drawings say it differently: a dryad *celebrates*
 * and *panics*, and a check and a triangle do neither. The forest's words are
 * about a character; the other set is about a worktree.
 */
const STATE_TIP: Record<SpriteState, string> = {
  idle: "Resting — no agent is running here",
  working: "Working — the agent is running right now",
  success: "Celebrating — the last turn finished cleanly",
  blocked: "Waiting — it needs a permission decision from you",
  error: "Panicking — the last turn ended in an error",
};

const GLYPH_TIP: Record<SpriteState, string> = {
  idle: "Resting — no agent is running here",
  working: "Working — the agent is running right now",
  success: "Done — the last turn finished cleanly",
  blocked: "Waiting — it needs a permission decision from you",
  error: "Failed — the last turn ended in an error",
};

interface SpriteProps {
  state: SpriteState;
  /** Pixel scale factor; 2 → 32px, 4 → 64px. */
  scale?: number;
  title?: string;
}

/**
 * A dryad, or — in a theme that has no forest — the flat creature that stands
 * in for one.
 *
 * Both occupy exactly GRID × scale, because every caller has already laid out
 * around a square of that size: a worktree header, a fleet row, the About
 * dialog. Swapping the drawing must not move anything beside it.
 */
export function Sprite({ state, scale = 2, title }: SpriteProps) {
  const hasForest = useHasForest();
  const sheet = useMemo(() => (hasForest ? buildSheet(state) : ""), [state, hasForest]);

  if (!hasForest) {
    return (
      <Mascot
        state={state}
        size={GRID * scale}
        label={title ? `${title}: ${state}` : `status: ${state}`}
        tip={title ? `${title} · ${GLYPH_TIP[state]}` : GLYPH_TIP[state]}
      />
    );
  }

  const frames = SPRITE_FRAMES[state].length;
  const size = GRID * scale;
  return (
    <div
      className="sprite"
      role="img"
      aria-label={title ?? `sprite: ${state}`}
      data-tip={title ? `${title} · ${STATE_TIP[state]}` : STATE_TIP[state]}
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
