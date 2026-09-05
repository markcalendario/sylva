import { useMemo } from "react";
import { useHasForest } from "../lib/theme";
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
 * A dryad, or — in a theme that has no forest — the same four states said
 * plainly.
 *
 * Both shapes occupy exactly GRID × scale, because every caller has already
 * laid out around a square of that size: a worktree header, a fleet row, the
 * About dialog. Swapping the drawing must not move anything beside it.
 */
export function Sprite({ state, scale = 2, title }: SpriteProps) {
  const hasForest = useHasForest();
  const sheet = useMemo(() => (hasForest ? buildSheet(state) : ""), [state, hasForest]);

  if (!hasForest) return <StatusGlyph state={state} scale={scale} {...(title ? { title } : {})} />;

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

/**
 * What a dryad was saying, without the dryad.
 *
 * A presence dot — the mark beside a name in every chat and issue tracker
 * built in the last ten years. Borrowed rather than invented on purpose: an
 * invented shape has to be learned before it can be read, and this one is read
 * a hundred times a day at sixteen pixels, out of the corner of an eye.
 *
 * The silhouette barely changes across the four states, so the *motion* is
 * what distinguishes them: resting is a hollow ring and perfectly still;
 * working beats and throws rings off itself; done lands once and stays; needs
 * you knocks twice, waits, and knocks again for as long as it takes.
 */
function StatusGlyph({
  state,
  scale,
  title,
}: {
  state: SpriteState;
  scale: number;
  title?: string;
}) {
  const size = GRID * scale;
  const tip = title ? `${title} · ${GLYPH_TIP[state]}` : GLYPH_TIP[state];
  return (
    <div
      className={`statusglyph statusglyph-${state}`}
      role="img"
      aria-label={title ? `${title}: ${state}` : `status: ${state}`}
      data-tip={tip}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
        {state === "idle" ? (
          /* Nothing is happening, so the mark is an outline and holds still. */
          <circle className="statusglyph-ring" cx="12" cy="12" r="4.4" />
        ) : (
          <>
            {/* Rings leaving the dot. The second is the first again, half a
                beat later — which is what turns a pulse into a rhythm. */}
            <circle className="statusglyph-halo" cx="12" cy="12" r="6.4" />
            {state === "working" && (
              <circle className="statusglyph-halo statusglyph-halo-2" cx="12" cy="12" r="6.4" />
            )}
            <circle className="statusglyph-core" cx="12" cy="12" r="3.6" />
          </>
        )}
      </svg>
    </div>
  );
}
