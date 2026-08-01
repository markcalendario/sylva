/**
 * The landing page's backdrop: a wide strip of night forest, painted with the
 * same vocabulary as the overworld map but composed as scenery rather than as
 * a place you navigate. Generated to whatever size it is asked for, so it fits
 * the panel at a whole-number scale exactly like the map does.
 */

/** Whole-number display scale — pixel art survives 3×, not 3.4×. */
export const LANDSCAPE_SCALE = 3;
/** How far the treeline is allowed to climb above the grass, in map pixels. */
export const TREE_RISE = 16;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ragged edges: a plain distance test gives arcs and rules, not ground. */
function edgeNoise(x: number, y: number): number {
  let h = Math.imul(x >> 2, 0x27d4eb2d) ^ Math.imul(y >> 2, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (((h ^ (h >>> 13)) >>> 0) / 4294967296 - 0.5) * 3.6;
}

/** Where the road runs, so props and scatter can keep off it. */
export function roadMid(x: number, width: number): number {
  return TREE_RISE + 62 + (x / width) * 5 + Math.sin(x * 0.028) * 2.4;
}

const cache = new Map<string, string>();
const CACHE_MAX = 4;

/**
 * @param width  ground width in map pixels
 * @param height ground height in map pixels, excluding the treeline's rise
 */
export function renderLandscape(width: number, height: number): string {
  const key = `${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + TREE_RISE;
  const cx = canvas.getContext("2d");
  if (!cx) return "";
  const rand = mulberry32(0x5b_1a);
  const px = (x: number, y: number, colour: string): void => {
    cx.fillStyle = colour;
    cx.fillRect(x, y, 1, 1);
  };

  // Grass begins below the rise; above it is sky the trees climb into.
  for (let y = TREE_RISE; y < height + TREE_RISE; y += 16) {
    for (let x = 0; x < width; x += 16) {
      const band = Math.floor((y - TREE_RISE) / 16 / 2) % 2 === 0;
      const checker = ((x / 16 + (y - TREE_RISE) / 16) | 0) % 2 === 0;
      cx.fillStyle = band === checker ? "#22391f" : "#1e3420";
      cx.fillRect(x, y, 16, 16);
    }
  }

  // Treeline in two depths, straddling the horizon so it is never a ruled line.
  const canopy = (bx: number, by: number, r: number, far: boolean): void => {
    for (let y = Math.max(0, by - r); y < by + r; y++) {
      for (let x = bx - r; x <= bx + r; x++) {
        if (x < 0 || x >= width || y < 0) continue;
        const nx = (x - bx) / r;
        const ny = (y - by) / (r * 0.82);
        const d = nx * nx + ny * ny + edgeNoise(x, y) * 0.05;
        if (d > 1) continue;
        px(
          x,
          y,
          far
            ? d > 0.7
              ? "#0e1a12"
              : (x + y) % 3 === 0
                ? "#132218"
                : "#101d15"
            : d > 0.72
              ? "#112016"
              : (x + y) % 3 === 0
                ? "#1b3421"
                : "#182d1d",
        );
      }
    }
  };
  for (let i = 0; i * 15 < width + 30; i++) {
    canopy(i * 15 + 5, TREE_RISE - 2 + Math.round(rand() * 7), 10 + Math.round(rand() * 7), true);
  }
  for (let i = 0; i * 12 < width + 24; i++) {
    canopy(i * 12 + 8, TREE_RISE + 5 + Math.round(rand() * 6), 8 + Math.round(rand() * 6), false);
  }

  // The road the dryads would walk, with worn edges rather than a stripe.
  for (let x = 0; x < width; x++) {
    const mid = roadMid(x, width);
    for (let y = Math.round(mid - 12); y <= Math.round(mid + 12); y++) {
      const d = Math.abs(y - mid) + edgeNoise(x, y);
      if (d >= 9) continue;
      px(x, y, d > 7 ? "#2e2718" : (x + y) % 4 === 0 ? "#4a3a22" : "#42351f");
      if (d < 5 && rand() < 0.04) px(x, y, "#5a4d33");
    }
  }

  // Ground cover, off the road and out of the water.
  const scatter = Math.round(width * height * 0.012);
  for (let i = 0; i < scatter; i++) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(TREE_RISE + 14 + rand() * (height - 34));
    if (Math.abs(y - roadMid(x, width)) < 14) continue;
    if (y > TREE_RISE + height - 30) continue;
    const roll = rand();
    if (roll < 0.48) {
      px(x, y, "#2c4b2c");
      px(x, y + 1, "#2c4b2c");
    } else if (roll < 0.72) {
      for (let dy = -3; dy <= 1; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx * 0.32 + (dy + 1) * (dy + 1) > 4.6) continue;
          px(x + dx, y + dy, dy <= -2 ? "#3f8244" : dy >= 1 ? "#1b3520" : "#2f6136");
        }
      }
    } else if (roll < 0.88) {
      px(x, y, "#3f8244");
    } else if (roll < 0.95) {
      px(x, y, "#ffb454");
      px(x, y + 1, "#2c4b2c");
    } else {
      px(x, y, "#e58fb1");
      px(x, y + 1, "#2c4b2c");
    }
  }

  // The stream along the foot of the frame.
  for (let x = 0; x < width; x++) {
    const mid =
      TREE_RISE + height - 12 + Math.sin(x * 0.05) * 3 + Math.sin(x * 0.019 + 1.3) * 2;
    const top = Math.round(mid - 11);
    for (let y = top - 3; y < height + TREE_RISE; y++) {
      if (y < top) {
        px(x, y, (x + y) % 3 === 0 ? "#5a4a30" : "#4a3d28");
        continue;
      }
      const depth = Math.abs(y - mid) / 11;
      if (depth > 0.82) px(x, y, "#1c3a44");
      else if (depth > 0.5) px(x, y, (x + y) % 5 === 0 ? "#2a5563" : "#20444f");
      else px(x, y, (x * 3 + y) % 7 === 0 ? "#3d7181" : "#25505d");
    }
    if (x % 9 === 0 && rand() < 0.8) {
      const rh = 5 + Math.round(rand() * 6);
      for (let k = 0; k < rh; k++) px(x, top - 1 - k, k > rh - 3 ? "#5aa557" : "#2f6136");
    }
  }

  // Distance shading, dithered so it stays pixel art: the ground under the
  // trees falls into shadow and the near bank darkens, which leaves the lit
  // village as the brightest band in the frame.
  for (let y = TREE_RISE; y < height + TREE_RISE; y++) {
    const fromTrees = Math.max(0, 1 - (y - TREE_RISE) / 24);
    const fromFront = Math.max(0, (y - (TREE_RISE + height - 34)) / 26);
    const shade = Math.min(0.9, fromTrees * 0.8 + fromFront * 0.5);
    if (shade <= 0) continue;
    for (let x = 0; x < width; x++) {
      if (((x * 2 + y * 3) % 7) / 7 > shade) continue;
      px(x, y, "#111d16");
    }
  }

  const uri = canvas.toDataURL("image/png");
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, uri);
  return uri;
}
