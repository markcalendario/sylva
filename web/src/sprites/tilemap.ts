/**
 * The overworld plane. The map is generated to fit the panel it is shown in
 * rather than authored at a fixed size, so it never scrolls sideways and every
 * pixel stays square: the display scale is a whole number, and the world is
 * drawn at whatever size divides into the panel exactly.
 *
 * Geography, west to east: the camp with its cabin and fire, the grove at the
 * north, the workshop at the east, the notice board at the south, and a stream
 * along the southern edge with the road crossing it on a plank bridge.
 */

/** Whole-number display scale. Pixel art survives 2×; it does not survive 1.7×. */
export const SCALE = 2;

const MIN_W = 340;
const MAX_W = 900;
/**
 * Vertical pitch of one row of standing dryads. A dryad plus its nameplate is
 * 29 map px tall, so anything under 30 has the back row's label landing on the
 * front row's head.
 */
export const ROW = 32;
/**
 * Sky above the ground, in map pixels. The plane is tipped back far enough to
 * show a horizon: the world is still read from above, but there is a night over
 * it rather than a hard edge.
 */
export const SKY = 54;
/** How far the treeline climbs off the ground into that sky. */
export const RISE = 46;
/**
 * Horizontal pitch between standing places. Tighter than a nameplate is wide —
 * the stagger in makeSlots is what keeps neighbouring labels apart — because
 * every extra column that fits is a row the map doesn't have to grow by.
 */
const GAP = 36;

export type StationKey = "camp" | "workshop" | "grove" | "board";

export interface Spot {
  x: number;
  y: number;
}

export interface Station extends Spot {
  label: string;
  slots: Spot[];
}

export interface Layout {
  width: number;
  height: number;
  rows: number;
  stations: Record<StationKey, Station>;
  house: Spot;
  shed: Spot;
  campfire: Spot;
  tents: Spot[];
  lamps: Spot[];
  benches: Spot[];
  stumps: Spot[];
  trees: Array<Spot & { fruit?: boolean }>;
  boardProp: Spot;
  /** The grove's arch, where finished work is put. */
  shrine: Spot;
  /** The barrier at the notice board — down while a decision is pending. */
  gate: Spot;
  pond: { x: number; y: number; rx: number; ry: number };
  streamY: number;
  bridgeX: number;
  /** Warm pools of light, drawn as soft overlays rather than into the tiles. */
  glows: Array<{ x: number; y: number; r: number; warm: boolean }>;
  fireflies: Array<{ x: number; y: number; delay: number; dur: number }>;
  leaves: Array<{ x: number; delay: number; dur: number; drift: number }>;
  rabbit: { y: number; x: number; travel: number };
  moth: Spot;
  /** Forest animals that call: an owl in the trees, a frog on the bank. */
  owl: Spot;
  frog: Spot;
  cricket: Spot;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function makeSlots(cx: number, cy: number, cols: number, rows: number, gap: number): Spot[] {
  const out: Spot[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    out.push({
      x: Math.round(cx + (col - (cols - 1) / 2) * gap),
      // Alternate columns stand a little further forward. Branch nameplates are
      // wider than the gap between standing places, so without this offset
      // neighbours' labels sit on top of each other.
      y: cy + row * ROW + (col % 2) * 10,
    });
  }
  return out;
}

/**
 * Build the world for a given panel width and population. Pure and
 * deterministic: the same arguments always give the same map, which is what
 * lets the rendered plane be cached and the React tree memoised.
 */
export function computeLayout(viewWidth: number, plotCount: number): Layout {
  const width = clamp(Math.floor(viewWidth / SCALE), MIN_W, MAX_W);
  // One column count for every station: the narrowest station is what decides
  // how many rows the map needs, so making the camp as wide as the grove keeps
  // the whole world shorter.
  // Three station-widths plus breathing room have to fit across the map, which
  // is what caps this fraction: the camp and workshop each get one, and the
  // grove and notice board share the middle one.
  const cols = clamp(Math.floor((width * 0.36) / GAP), 2, 6);
  // Every station is sized for the worst case — all dryads at one station — so
  // the map does not resize each time an agent starts or stops.
  const rows = clamp(Math.ceil(Math.max(plotCount, 1) / cols), 1, 6);

  // A crossroads: one road east-west, one north-south, meeting in the middle.
  // Every journey is therefore a right angle, never a diagonal.
  const groveY = 46;
  const buildBase = groveY + rows * ROW + 46;
  const midY = buildBase + 10;
  const boardY = midY + rows * ROW + 46;
  const streamY = boardY + rows * ROW + 28;
  const height = streamY + 26;

  const campX = Math.round(width * 0.18);
  const shopX = Math.round(width * 0.82);
  const midX = Math.round(width * 0.5);

  const stations: Record<StationKey, Station> = {
    camp: { label: "camp", x: campX, y: midY, slots: makeSlots(campX, midY, cols, rows, GAP) },
    workshop: {
      label: "workshop",
      x: shopX,
      y: midY,
      slots: makeSlots(shopX, midY, cols, rows, GAP),
    },
    grove: { label: "grove", x: midX, y: groveY, slots: makeSlots(midX, groveY, cols, rows, GAP) },
    board: {
      label: "needs you",
      x: midX,
      y: boardY,
      slots: makeSlots(midX, boardY, cols, rows, GAP),
    },
  };

  // Nothing on the camp or workshop row may stray into the column the grove
  // and notice board occupy, however wide those get.
  const midHalf = ((cols - 1) * GAP) / 2 + 18;
  const free = (x: number, half: number): boolean =>
    x - half >= 3 &&
    x + half <= width - 3 &&
    (x + half < midX - midHalf || x - half > midX + midHalf);

  const house = { x: campX - 20, y: buildBase };
  const campfire = { x: campX + 28, y: buildBase - 2 };
  const shed = { x: shopX + 10, y: buildBase };

  // Tents sit further back than the cabin, so dryads standing at the camp pass
  // in front of them rather than through them.
  const tents: Spot[] = [];
  if (free(campX - 54, 14)) tents.push({ x: campX - 54, y: buildBase - 24 });
  if (free(campX + 62, 14)) tents.push({ x: campX + 62, y: buildBase - 28 });

  const benches: Spot[] = [];
  if (free(shopX - 32, 9)) benches.push({ x: shopX - 32, y: buildBase + 4 });
  if (free(shopX - 54, 9)) benches.push({ x: shopX - 54, y: buildBase + 10 });

  const stumps: Spot[] = [];
  if (free(campX + 54, 6)) stumps.push({ x: campX + 54, y: buildBase + 14 });
  if (free(campX - 44, 6)) stumps.push({ x: campX - 44, y: buildBase + 18 });

  const lamps: Spot[] = [
    { x: campX + 4, y: buildBase + 2 },
    { x: shopX - 16, y: buildBase + 2 },
    // Clear of the "needs you" sign, which is centred on the same column.
    { x: midX - 32, y: streamY - 16 },
    { x: midX + 32, y: streamY - 16 },
    // Marking the crossroads itself.
    { x: midX - 30, y: midY - 20 },
    { x: midX + 30, y: midY - 20 },
  ];

  // The grove's fruit trees flank its shrine rather than standing in for it.
  const trees: Array<Spot & { fruit?: boolean }> = [
    { x: midX - 44, y: groveY - 2, fruit: true },
    { x: midX + 44, y: groveY - 2, fruit: true },
    { x: 16, y: midY + 30 },
    { x: width - 16, y: boardY - 10 },
    { x: 20, y: boardY + 16 },
  ];

  // A deterministic scatter, so the ambience never reshuffles between renders.
  const rand = mulberry32(0x5f_1a);
  const fireflies = Array.from({ length: 16 }, () => ({
    x: Math.round(rand() * width),
    y: Math.round(40 + rand() * (height - 90)),
    delay: Math.round(rand() * 9000) / 1000,
    dur: Math.round((7 + rand() * 7) * 1000) / 1000,
  }));
  const leaves = Array.from({ length: 9 }, () => ({
    x: Math.round(rand() * width),
    delay: Math.round(rand() * 14000) / 1000,
    dur: Math.round((11 + rand() * 9) * 1000) / 1000,
    drift: Math.round(30 + rand() * 70),
  }));

  return {
    width,
    height,
    rows,
    stations,
    house,
    shed,
    campfire,
    tents,
    lamps,
    benches,
    stumps,
    trees,
    boardProp: { x: midX + 30, y: boardY - 6 },
    shrine: { x: midX, y: groveY - 4 },
    gate: { x: midX, y: boardY - 4 },
    pond: { x: width - 44, y: 32, rx: Math.min(38, Math.round(width * 0.12)), ry: 17 },
    streamY,
    bridgeX: midX,
    glows: [
      { x: campfire.x, y: campfire.y - 8, r: 40, warm: true },
      { x: house.x + 7, y: buildBase - 18, r: 30, warm: true },
      { x: house.x - 18, y: buildBase - 18, r: 26, warm: true },
      { x: shed.x + 7, y: buildBase - 8, r: 30, warm: true },
      ...lamps.map((l) => ({ x: l.x, y: l.y - 20, r: 22, warm: false })),
    ],
    fireflies,
    leaves,
    rabbit: { x: Math.round(width * 0.1), y: streamY - 24, travel: 54 },
    owl: { x: Math.round(width * 0.31), y: 16 },
    frog: { x: Math.round(width * 0.66), y: streamY - 13 },
    cricket: { x: Math.round(width * 0.42), y: boardY + 26 },
    moth: { x: lamps[0]?.x ?? campX, y: buildBase - 12 },
  };
}

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

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Value noise on a 4px lattice. Ground edges drawn straight off a distance
 * function come out as arcs and rectangles; nudging the distance by this makes
 * them ragged the way trodden earth is, and it stays deterministic.
 */
function edgeNoise(x: number, y: number): number {
  let h = Math.imul(x >> 2, 0x27d4eb2d) ^ Math.imul(y >> 2, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (((h ^ (h >>> 13)) >>> 0) / 4294967296 - 0.5) * 3.6;
}

/**
 * Renders are cached by size. Resizing a window walks through many widths, so
 * the cache is capped and evicted oldest-first rather than growing forever.
 */
const planes = new Map<string, string>();
const PLANE_CACHE_MAX = 6;

export function renderPlane(layout: Layout): string {
  const key = `${layout.width}x${layout.height}`;
  const hit = planes.get(key);
  if (hit) return hit;

  const { width: W, height: H, streamY, pond, bridgeX } = layout;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  // Extra rows above the ground for the treeline to climb into. Translating by
  // RISE means every coordinate below stays in ground space, and a canopy drawn
  // at a negative y simply reaches up into the sky.
  canvas.height = H + RISE;
  const cx = canvas.getContext("2d");
  if (!cx) return "";
  cx.translate(0, RISE);
  const rand = mulberry32(0x51_1a);

  const px = (x: number, y: number, colour: string): void => {
    cx.fillStyle = colour;
    cx.fillRect(x, y, 1, 1);
  };

  // ---- grass: two-tone checker with mowed banding ----
  const TILE = 16;
  for (let y = 0; y < H; y += TILE) {
    for (let x = 0; x < W; x += TILE) {
      const band = Math.floor(y / TILE / 2) % 2 === 0;
      const checker = ((x / TILE + y / TILE) | 0) % 2 === 0;
      cx.fillStyle = band === checker ? "#22391f" : "#1e3420";
      cx.fillRect(x, y, TILE, TILE);
    }
  }

  // ---- the forest wall along the north edge ----
  // No solid band behind it: the canopies themselves are the horizon, so the
  // sky meets the wood on a ragged edge rather than a ruled one.
  const TREELINE = 26;

  /**
   * A conifer: stacked tiers narrowing to a point, over a short trunk. The
   * trunk matters — without it the widest tier is the bottom edge, and a rank
   * of them lands as a row of triangles cut off along a line.
   */
  const conifer = (bx: number, baseY: number, height: number, body: string, lit: string): void => {
    const halfAt = (t: number): number => (1 - t) * height * 0.42 + 1;
    for (let step = 0; step <= height; step++) {
      const y = baseY - step;
      if (y < -RISE) break;
      const t = step / height;
      // Tiers rather than a clean cone: a triangle reads as a shape, a tiered
      // triangle reads as a tree.
      const tier = ((step % 7) / 7) * 1.6;
      // The lowest tiers pull back in, so the silhouette sits on a trunk
      // rather than flaring straight into the ground.
      const foot = t < 0.14 ? (0.14 - t) * height * 1.5 : 0;
      const half = Math.max(0, Math.round(halfAt(t) - tier - foot));
      for (let x = bx - half; x <= bx + half; x++) {
        if (x < 0 || x >= W) continue;
        px(x, y, x < bx ? lit : body);
      }
    }
    for (let y = baseY; y <= baseY + 3; y++) {
      px(bx, y, body);
      px(bx - 1, y, body);
    }
  };

  /** A broadleaf: a wobbled crown over a short trunk. */
  const broadleaf = (bx: number, baseY: number, r: number, body: string, lit: string): void => {
    const cy = baseY - Math.round(r * 1.1);
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < -RISE) continue;
      for (let x = bx - r; x <= bx + r; x++) {
        if (x < 0 || x >= W) continue;
        const nx = (x - bx) / r;
        const ny = (y - cy) / (r * 0.88);
        if (nx * nx + ny * ny + edgeNoise(x, y) * 0.05 > 1) continue;
        px(x, y, x < bx - 1 ? lit : body);
      }
    }
    for (let y = cy + r - 1; y <= baseY; y++) {
      if (y < -RISE) continue;
      px(bx, y, body);
    }
  };

  /**
   * Three ranks, far to near. Depth comes from height, density and value:
   * distant trees are shorter, paler and hazier, near ones taller and almost
   * black. Silhouettes rather than blobs — a skyline of actual tree shapes is
   * what makes it read as a wood instead of a hedge.
   */
  const ranks = [
    { step: 9, lift: -6, vary: 7, min: 9, grow: 7, body: "#1a2b21", lit: "#20342a" },
    { step: 12, lift: 1, vary: 9, min: 13, grow: 11, body: "#132218", lit: "#182a1e" },
    { step: 16, lift: 8, vary: 7, min: 16, grow: 14, body: "#0c1610", lit: "#101c14" },
  ];
  for (const [i, r] of ranks.entries()) {
    for (let n = 0; n * r.step < W + r.step * 2; n++) {
      const bx = n * r.step + Math.round(rand() * r.step) - r.step / 2;
      const baseY = r.lift + Math.round(rand() * r.vary);
      const height = r.min + Math.round(rand() * r.grow);
      // Mostly conifers, which give the skyline its teeth; the odd rounded
      // crown stops it turning into a saw blade.
      if (rand() < (i === 2 ? 0.34 : 0.24)) {
        broadleaf(Math.round(bx), baseY, Math.round(height * 0.42) + 3, r.body, r.lit);
      } else {
        conifer(Math.round(bx), baseY, height, r.body, r.lit);
      }
    }
  }

  // Undergrowth along the foot of the wood: bracken and scrub in the gap
  // between the trunks and the grass, so the treeline is rooted in something
  // instead of standing on a ruled line.
  for (let x = 0; x < W; x++) {
    const lip = 12 + Math.sin(x * 0.09) * 2.5 + Math.sin(x * 0.031 + 2.1) * 3;
    for (let y = 2; y < lip; y++) {
      const fade = 1 - (y - 2) / (lip - 2);
      if (edgeNoise(x, y) * 0.14 + 0.55 > fade + rand() * 0.5) continue;
      px(x, y, (x + y) % 3 === 0 ? "#16281b" : "#122015");
    }
    if (rand() < 0.16) {
      const h = 2 + Math.round(rand() * 3);
      for (let k = 0; k < h; k++) px(x, Math.round(lip) - k, k > h - 2 ? "#2f6136" : "#1d3b23");
    }
  }

  // Haze along the horizon, dithered, so the furthest trees sit *in* the night
  // rather than being pasted onto it. source-atop confines it to pixels that
  // already have a tree on them — painted freely it tints the empty sky too,
  // and the dither pattern becomes a visible hatch across the stars.
  cx.save();
  cx.globalCompositeOperation = "source-atop";
  for (let y = -RISE; y < 8; y++) {
    const nearness = (y + RISE) / (RISE + 8);
    const veil = Math.max(0, 0.62 - nearness * 0.62);
    if (veil <= 0) continue;
    for (let x = 0; x < W; x++) {
      if (((x * 3 + y * 5) % 11) / 11 > veil) continue;
      px(x, y, "#0a0f0f");
    }
  }
  cx.restore();

  // ---- the road network ----
  // Roads join the stations; each row of standing places wears its own lane in
  // the grass. Lanes rather than one big yard: a filled rectangle under a
  // station reads as a car park, a worn strip reads as ground people stand on.
  // A crossroads. Every segment is axis-aligned: one road runs the width of the
  // map through the camp and the workshop, one runs its height from the grove
  // down over the bridge, and they meet in the middle. No diagonals anywhere,
  // which is also why the dryads can walk it in right angles.
  const eastWest = layout.stations.camp.y + 8;
  const roads: Array<[Spot, Spot]> = [
    [
      { x: 0, y: eastWest },
      { x: W, y: eastWest },
    ],
    [
      { x: bridgeX, y: layout.stations.grove.y + 8 },
      { x: bridgeX, y: H + 12 },
    ],
  ];
  const lanes: Array<[Spot, Spot]> = [];
  for (const key of Object.keys(layout.stations) as StationKey[]) {
    const { slots } = layout.stations[key];
    const cols = slots.length / layout.rows;
    for (let r = 0; r < layout.rows; r++) {
      const first = slots[r * cols];
      const last = slots[r * cols + cols - 1];
      if (!first || !last) continue;
      lanes.push([
        { x: first.x - 8, y: first.y - 3 },
        { x: last.x + 8, y: last.y - 3 },
      ]);
    }
  }

  const roadDist = (x: number, y: number): number => {
    let d = Infinity;
    for (const [a, b] of roads) {
      d = Math.min(d, distToSegment(x, y, a.x, a.y, b.x, b.y) * 1.28);
    }
    for (const [a, b] of lanes) {
      d = Math.min(d, distToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    return d;
  };

  for (let y = TREELINE; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const d = roadDist(x, y) + edgeNoise(x, y);
      if (d >= 8) continue;
      cx.fillStyle = d > 6 ? "#2e2718" : (x + y) % 4 === 0 ? "#4a3a22" : "#42351f";
      cx.fillRect(x, y, 2, 2);
      // Stones trodden up through the dirt.
      if (d < 5 && rand() < 0.05) {
        cx.fillStyle = "#5a4d33";
        cx.fillRect(x, y, 2, 1);
      }
    }
  }

  // ---- the kitchen garden, south-west ----
  const gx = Math.round(W * 0.16);
  const gy = streamY - 44;
  if (roadDist(gx, gy) > 30) {
    const gw = Math.min(26, Math.round(W * 0.06));
    for (let y = gy - 24; y <= gy + 2; y++) {
      for (let x = gx - gw; x <= gx + gw; x++) px(x, y, (x + y) % 4 === 0 ? "#3a2c1c" : "#2f2416");
    }
    for (let r = 0; r < 5; r++) {
      const ry = gy - 20 + r * 5;
      for (let x = gx - gw + 2; x <= gx + gw - 2; x++) {
        px(x, ry, "#453425");
        px(x, ry + 1, "#241b10");
        if ((x + r * 3) % 6 === 0) {
          px(x, ry - 1, r % 2 === 0 ? "#3f8244" : "#5aa557");
          px(x, ry - 2, "#2f6136");
        }
      }
    }
    // A stone kerb, so the beds read as tended rather than churned.
    for (let x = gx - gw; x <= gx + gw; x++) {
      px(x, gy - 25, x % 3 === 0 ? "#6d7477" : "#565b5e");
      px(x, gy + 3, x % 3 === 0 ? "#3b3f42" : "#565b5e");
    }
  }

  // ---- fences penning the camp and the workshop ----
  const post = (x: number, y: number): void => {
    for (let k = 0; k <= 9; k++) px(x, y - k, k > 7 ? "#8a6238" : "#4a3220");
    px(x + 1, y - 9, "#2b1d11");
    px(x + 1, y, "#2b1d11");
  };
  const railAcross = (x0: number, x1: number, y: number): void => {
    for (let x = x0; x <= x1; x++) {
      if (roadDist(x, y) < 14) continue;
      px(x, y - 7, "#6b4a2c");
      px(x, y - 4, "#5c3f25");
      if ((x - x0) % 15 === 0) post(x, y);
    }
  };
  const railDown = (x: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) {
      if (roadDist(x, y) < 14) continue;
      px(x, y, "#5c3f25");
      px(x + 1, y, "#4a3220");
      if ((y - y0) % 13 === 0) post(x, y + 5);
    }
  };
  const pen = (x0: number, x1: number, top: number, bottom: number): void => {
    railAcross(x0, x1, top);
    railDown(x0, top, bottom);
    railDown(x1, top, bottom);
  };
  const penTop = layout.house.y - 40;
  const penBottom = layout.house.y + 8;
  pen(Math.max(6, layout.house.x - 44), Math.min(W - 8, layout.house.x + 68), penTop, penBottom);
  pen(Math.max(6, layout.shed.x - 76), Math.min(W - 8, layout.shed.x + 32), penTop, penBottom);

  // ---- the stream along the south, and its banks ----
  const streamEdge = (x: number): number =>
    Math.sin(x * 0.045) * 3 + Math.sin(x * 0.017 + 1.3) * 2;
  for (let x = 0; x < W; x++) {
    const mid = streamY + streamEdge(x);
    const top = Math.round(mid - 9);
    const bot = Math.round(mid + 9);
    for (let y = top - 3; y <= bot + 3; y++) {
      if (y < 0 || y >= H) continue;
      if (y < top || y > bot) {
        px(x, y, (x + y) % 3 === 0 ? "#5a4a30" : "#4a3d28");
        continue;
      }
      const depth = Math.abs(y - mid) / 9;
      if (depth > 0.82) px(x, y, "#1c3a44");
      else if (depth > 0.5) px(x, y, (x + y) % 5 === 0 ? "#2a5563" : "#20444f");
      else px(x, y, (x * 3 + y) % 7 === 0 ? "#3d7181" : "#25505d");
    }
    // Reeds standing in the shallows.
    if (x % 11 === 0 && rand() < 0.7) {
      const rh = 5 + Math.round(rand() * 5);
      for (let k = 0; k < rh; k++) px(x, top - 1 - k, k > rh - 3 ? "#5aa557" : "#2f6136");
    }
  }

  // ---- the plank bridge carrying the road over the stream ----
  const bTop = Math.round(streamY - 17);
  const bBot = Math.round(streamY + 17);
  for (let y = bTop; y <= bBot; y++) {
    for (let x = bridgeX - 12; x <= bridgeX + 12; x++) {
      px(x, y, (y - bTop) % 4 === 3 ? "#4a3220" : (y - bTop) % 4 === 0 ? "#8a6238" : "#6b4a2c");
    }
    px(bridgeX - 13, y, "#2b1d11");
    px(bridgeX + 13, y, "#2b1d11");
  }
  for (const rx of [bridgeX - 13, bridgeX + 13]) {
    for (let y = bTop; y <= bBot; y += 8) {
      for (let k = 0; k <= 7; k++) px(rx, y - k, "#5c3f25");
    }
    for (let y = bTop - 7; y <= bBot; y++) px(rx, y - 7, "#6b4a2c");
  }

  // ---- the pond in the north-east ----
  for (let y = pond.y - pond.ry - 3; y <= pond.y + pond.ry + 3; y++) {
    for (let x = pond.x - pond.rx - 3; x <= pond.x + pond.rx + 3; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const nx = (x - pond.x) / pond.rx;
      const ny = (y - pond.y) / pond.ry;
      const d = nx * nx + ny * ny;
      if (d > 1.28) continue;
      if (d > 1) px(x, y, (x + y) % 3 === 0 ? "#5a4a30" : "#2c4b2c");
      else if (d > 0.78) px(x, y, "#1c3a44");
      else if (d > 0.5) px(x, y, (x + y) % 5 === 0 ? "#2a5563" : "#20444f");
      else px(x, y, (x * 3 + y) % 7 === 0 ? "#3d7181" : "#25505d");
    }
  }
  for (const [lx, ly] of [
    [pond.x - 14, pond.y + 3],
    [pond.x + 9, pond.y - 5],
    [pond.x + 2, pond.y + 8],
  ] as const) {
    for (let y = -2; y <= 2; y++) {
      for (let x = -3; x <= 3; x++) {
        if (x * x * 0.4 + y * y > 3.4) continue;
        px(lx + x, ly + y, y < 0 ? "#3f8244" : "#2f6136");
      }
    }
  }

  // ---- ground cover: tufts, flowers, pebbles, mushrooms ----
  // All of it painted into the tiles rather than placed as sprites, so however
  // dense it gets it can never stand in front of a dryad and hide them.
  const scatter = Math.round(W * H * 0.0034);
  for (let i = 0; i < scatter; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(TREELINE + rand() * (H - TREELINE));
    if (roadDist(x, y) < 9) continue;
    if (Math.abs(y - (streamY + streamEdge(x))) < 20) continue;
    const nx = (x - pond.x) / (pond.rx + 5);
    const ny = (y - pond.y) / (pond.ry + 5);
    if (nx * nx + ny * ny < 1) continue;
    const roll = rand();
    if (roll < 0.52) {
      px(x, y, "#2c4b2c");
      px(x, y + 1, "#2c4b2c");
    } else if (roll < 0.68) {
      // A clump of blades rather than a single stroke.
      for (const [dx, dy, h] of [
        [0, 0, 2],
        [2, 1, 3],
        [4, 0, 2],
      ] as const) {
        for (let k = 0; k < h; k++) px(x + dx, y + dy - k, k === h - 1 ? "#3f8244" : "#2c4b2c");
      }
    } else if (roll < 0.8) {
      // A low shrub: dark at the base, catching light on its crown.
      for (let dy = -3; dy <= 1; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (dx * dx * 0.32 + (dy + 1) * (dy + 1) > 4.6) continue;
          px(x + dx, y + dy, dy <= -2 ? "#3f8244" : dy >= 1 ? "#1b3520" : "#2f6136");
        }
      }
    } else if (roll < 0.88) {
      // Flowers come in patches; one pixel on its own reads as a stray dot.
      const petal = rand() < 0.5 ? "#ffb454" : "#e58fb1";
      for (const [dx, dy] of [
        [0, 0],
        [3, 1],
        [1, 3],
        [4, 4],
      ] as const) {
        px(x + dx, y + dy, petal);
        px(x + dx, y + dy + 1, "#2c4b2c");
      }
    } else if (roll < 0.955) {
      px(x, y, "#4d4237");
      px(x + 1, y, "#3a3128");
    } else if (roll < 0.972) {
      // A toadstool: red cap, pale stalk.
      px(x, y, "#c4574a");
      px(x + 1, y, "#c4574a");
      px(x, y + 1, "#d8d2c4");
    } else if (roll < 0.988) {
      // A boulder with moss on its north face.
      for (let dy = 0; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx * 0.5 + (dy - 1.5) * (dy - 1.5) > 4.2) continue;
          px(x + dx, y + dy, dy === 0 ? "#6d7477" : dy === 3 ? "#2f3335" : "#4d5254");
        }
      }
      px(x - 1, y, "#3c5a37");
    } else {
      // A fallen log going back to the soil.
      for (let dx = 0; dx <= 8; dx++) {
        px(x + dx, y, dx === 0 || dx === 8 ? "#2b1d11" : "#5c3f25");
        px(x + dx, y + 1, dx === 0 || dx === 8 ? "#2b1d11" : "#3a2717");
      }
      px(x + 3, y - 1, "#3c5a37");
      px(x + 5, y - 1, "#3c5a37");
    }
  }

  // ---- edge falloff, dithered so it stays pixel art ----
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const edge = Math.min(x, W - x, H - y) / 26;
      if (edge >= 1) continue;
      if (rand() > 1 - edge) continue;
      cx.fillStyle = "rgb(8 13 12 / 0.55)";
      cx.fillRect(x, y, 2, 2);
    }
  }

  const uri = canvas.toDataURL("image/png");
  if (planes.size >= PLANE_CACHE_MAX) {
    const oldest = planes.keys().next().value;
    if (oldest !== undefined) planes.delete(oldest);
  }
  planes.set(key, uri);
  return uri;
}
