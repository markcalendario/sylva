/**
 * The overworld plane: grass tiles, dirt paths, and four stations the dryads
 * travel between. Rendered once to a PNG data URI, the way the sprites are —
 * nothing ships as an asset, and every pixel is deterministic so the map is
 * identical on every load.
 */

const TILE = 16;
export const MAP_W = 640;
export const MAP_H = 208;
const TILES_X = MAP_W / TILE;
const TILES_Y = MAP_H / TILE;

/** Where a dryad stands for each state, in map pixels (before display scaling). */
export interface Station {
  label: string;
  x: number;
  y: number;
  /** Standing spots, filled in order so dryads don't stack. */
  slots: Array<{ x: number; y: number }>;
}

function makeSlots(
  cx: number,
  cy: number,
  perRow: number,
  count: number,
  gap = 34,
): Station["slots"] {
  const slots: Station["slots"] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    slots.push({
      x: cx + (col - (perRow - 1) / 2) * gap,
      // Stagger rows so back-row nameplates peek between front-row heads.
      y: cy + row * 26 + (col % 2) * 4,
    });
  }
  return slots;
}

export const STATIONS = {
  /** Sleeping under the big trees, west side. */
  camp: { label: "camp", x: 96, y: 128, slots: makeSlots(96, 122, 3, 9, 46) },
  /** The benches, east side. */
  workshop: { label: "workshop", x: 520, y: 128, slots: makeSlots(520, 122, 3, 9, 46) },
  /** The fruit tree, centre — where a finished dryad celebrates. */
  grove: { label: "grove", x: 320, y: 96, slots: makeSlots(320, 92, 4, 8, 42) },
  /** The notice board, front and centre — a dryad stuck and waiting on you. */
  board: { label: "needs you", x: 320, y: 168, slots: makeSlots(320, 164, 4, 8, 42) },
} satisfies Record<string, Station>;

export type StationKey = keyof typeof STATIONS;

/** Deterministic PRNG so the map never changes between loads. */
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

const PATHS: Array<[StationKey, StationKey]> = [
  ["camp", "grove"],
  ["grove", "workshop"],
  ["grove", "board"],
];

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

let cached: string | null = null;

export function renderPlane(): string {
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const cx = canvas.getContext("2d");
  if (!cx) return "";
  const rand = mulberry32(0x51_1a);

  // ---- grass: a two-tone checker with mowed banding, night palette ----
  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const band = Math.floor(ty / 2) % 2 === 0;
      const checker = (tx + ty) % 2 === 0;
      cx.fillStyle = band === checker ? "#22391f" : "#1e3420";
      cx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }

  // ---- dirt paths between stations ----
  for (let y = 0; y < MAP_H; y += 2) {
    for (let x = 0; x < MAP_W; x += 2) {
      let d = Infinity;
      for (const [a, b] of PATHS) {
        const s1 = STATIONS[a];
        const s2 = STATIONS[b];
        d = Math.min(d, distToSegment(x, y, s1.x, s1.y + 10, s2.x, s2.y + 10));
      }
      // Station courtyards widen the path into a clearing.
      for (const key of Object.keys(STATIONS) as StationKey[]) {
        const s = STATIONS[key];
        d = Math.min(d, Math.hypot(x - s.x, y - (s.y + 8)) * 0.9);
      }
      if (d < 6.5) {
        const edge = d > 4.6;
        cx.fillStyle = edge ? "#33291a" : (x + y) % 4 === 0 ? "#4a3a22" : "#42351f";
        cx.fillRect(x, y, 2, 2);
      }
    }
  }

  // ---- grass blades and flowers, sparse and deterministic ----
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(rand() * MAP_W);
    const y = Math.floor(rand() * MAP_H);
    // Skip the paths so decoration doesn't sit on trodden ground.
    let onPath = false;
    for (const [a, b] of PATHS) {
      const s1 = STATIONS[a];
      const s2 = STATIONS[b];
      if (distToSegment(x, y, s1.x, s1.y + 10, s2.x, s2.y + 10) < 9) onPath = true;
    }
    if (onPath) continue;
    const roll = rand();
    if (roll < 0.82) {
      cx.fillStyle = "#2c4b2c";
      cx.fillRect(x, y, 1, 2);
    } else if (roll < 0.94) {
      cx.fillStyle = "#3f8244";
      cx.fillRect(x, y, 1, 1);
    } else if (roll < 0.975) {
      cx.fillStyle = "#ffb454";
      cx.fillRect(x, y, 1, 1);
    } else {
      cx.fillStyle = "#e58fb1";
      cx.fillRect(x, y, 1, 1);
    }
  }

  // ---- pond in the north-east corner, ringed with a lighter lip ----
  const pond = { x: 596, y: 34, rx: 34, ry: 18 };
  for (let y = pond.y - pond.ry; y <= pond.y + pond.ry; y++) {
    for (let x = pond.x - pond.rx; x <= pond.x + pond.rx; x++) {
      if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) continue;
      const nx = (x - pond.x) / pond.rx;
      const ny = (y - pond.y) / pond.ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      if (d > 0.8) cx.fillStyle = "#2c4b2c";
      else if (d > 0.62) cx.fillStyle = "#1c3a44";
      else cx.fillStyle = (x + y) % 5 === 0 ? "#2a5563" : "#20444f";
      cx.fillRect(x, y, 1, 1);
    }
  }

  cached = canvas.toDataURL("image/png");
  return cached;
}
