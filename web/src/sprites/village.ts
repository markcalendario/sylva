/**
 * The village: the buildings and props that make the overworld somewhere people
 * live rather than a field with signs on it. Generated the same way the trees
 * are — every pixel is computed, nothing ships as an asset — so a building can
 * be resized or reshaded by changing a number instead of retyping a grid.
 */

export const VILLAGE_PALETTE: Record<string, string> = {
  ".": "transparent",
  O: "#150f0a", // outline / deep shadow
  w: "#7a5636", // log wall
  W: "#573a23", // wall in shadow
  L: "#95704a", // lit top of a log course
  R: "#3b3129", // roof shingle
  S: "#2a221b", // shingle seam
  H: "#4c4236", // roof catching moonlight
  m: "#3c5a37", // moss on the shingles
  y: "#ffe6b4", // lit glass
  Y: "#ffb454", // glass, further from the candle
  d: "#4a321d", // door
  D: "#241708", // interior dark
  s: "#565b5e", // stone
  t: "#3b3f42", // stone in shadow
  u: "#727a7d", // stone catching light
  b: "#6b4a2c", // plank
  k: "#4a3220", // plank in shadow
  a: "#ffb454", // lamp glass
  A: "#fff0cd", // lamp flame
  e: "#e0503f", // outer flame
  E: "#ff9a3c", // mid flame
  F: "#ffe08a", // flame core
  c: "#cfc4ac", // tent canvas
  C: "#9a8f79", // canvas in shadow
  n: "#d3cdbf", // fur
  N: "#948e80", // fur in shadow
  g: "#3f8244", // leaf
  i: "#2e3f47", // iron
  I: "#4d666f", // iron catching light
};

type Grid = string[][];

function grid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array<string>(w).fill("."));
}

function put(g: Grid, x: number, y: number, c: string): void {
  const row = g[y];
  if (!row || x < 0 || x >= row.length) return;
  row[x] = c;
}

function box(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, c);
}

function rows(g: Grid): string[] {
  return g.map((r) => r.join(""));
}

/* ------------------------------------------------------------------ house */

export const HOUSE_W = 50;
export const HOUSE_H = 47;

/** The camp cabin: log walls, a shingle gable, a stone chimney, lit windows. */
function buildHouse(bright: boolean): string[] {
  const g = grid(HOUSE_W, HOUSE_H);
  const wallTop = 21;
  const wallBottom = 43;
  const left = 4;
  const right = 45;
  const cx = 25;

  // Log courses: lit along the top of each log, shadowed at the seam, so the
  // wall reads as stacked rounds instead of a flat plank.
  for (let y = wallTop; y <= wallBottom; y++) {
    const inCourse = (y - wallTop) % 4;
    const tone = inCourse === 0 ? "L" : inCourse === 3 ? "W" : "w";
    for (let x = left; x <= right; x++) put(g, x, y, tone);
  }
  for (let y = wallTop; y <= wallBottom; y++) {
    put(g, left, y, "O");
    put(g, left + 1, y, "W");
    put(g, right, y, "O");
    put(g, right - 1, y, "W");
  }

  // Gable roof, overhanging the walls at the eaves.
  const apexY = 3;
  const eaveY = 20;
  for (let y = apexY; y <= eaveY; y++) {
    const half = Math.round(((y - apexY) / (eaveY - apexY)) * 26);
    for (let x = cx - half; x <= cx + half; x++) {
      put(g, x, y, (y - apexY) % 3 === 0 ? "S" : x < cx - 2 ? "H" : "R");
    }
    put(g, cx - half, y, "O");
    put(g, cx + half, y, "O");
  }
  for (let x = 0; x < HOUSE_W; x++) put(g, x, eaveY, "O");
  for (const [mx, my] of [
    [18, 10],
    [19, 11],
    [20, 10],
    [33, 15],
    [34, 16],
    [35, 15],
    [36, 16],
    [30, 12],
    [31, 13],
  ] as const) {
    put(g, mx, my, "m");
  }

  // Stone chimney, drawn over the roof so it sits proud of the slope.
  box(g, 8, 1, 15, 16, "s");
  for (let y = 3; y <= 16; y += 3) for (let x = 8; x <= 15; x++) put(g, x, y, "t");
  for (let y = 1; y <= 16; y++) {
    put(g, 8, y, "u");
    put(g, 7, y, "O");
    put(g, 16, y, "O");
  }
  for (let x = 7; x <= 16; x++) put(g, x, 0, "O");

  // Windows. The far pane is dimmer than the near one — one candle, two rooms.
  const glass = bright ? "y" : "Y";
  for (const x0 of [7, 32]) {
    box(g, x0, 24, x0 + 10, 34, "O");
    box(g, x0 + 1, 25, x0 + 9, 33, "Y");
    box(g, x0 + 2, 26, x0 + 8, 32, glass);
    for (let y = 25; y <= 33; y++) put(g, x0 + 5, y, "d");
    for (let x = x0 + 1; x <= x0 + 9; x++) put(g, x, 29, "d");
    for (let x = x0 - 1; x <= x0 + 11; x++) put(g, x, 35, "b");
  }

  // Door, planked, with a brass knob catching the lamp outside.
  box(g, 21, 29, 29, 43, "O");
  box(g, 22, 30, 28, 43, "d");
  for (let y = 30; y <= 43; y++) {
    put(g, 24, y, "D");
    put(g, 26, y, "D");
  }
  put(g, 27, 37, "a");
  for (let x = 20; x <= 30; x++) put(g, x, 28, "b");

  // Stone footing and the step at the door.
  for (let y = 44; y <= 46; y++) {
    for (let x = 3; x <= 46; x++) put(g, x, y, (x + y) % 3 === 0 ? "t" : "s");
  }
  box(g, 19, 44, 31, 46, "u");
  for (let x = 19; x <= 31; x++) put(g, x, 46, "t");

  return rows(g);
}

/** Four frames of candlelight: mostly steady, with one guttering beat. */
export const HOUSE_FRAMES: string[][] = [
  buildHouse(true),
  buildHouse(true),
  buildHouse(false),
  buildHouse(true),
];

/* -------------------------------------------------------------- workshop */

export const SHED_W = 54;
export const SHED_H = 44;

/** The workshop: an open-fronted shed with a forge that breathes. */
function buildShed(heat: number): string[] {
  const g = grid(SHED_W, SHED_H);
  const cx = 27;
  const apexY = 2;
  const eaveY = 15;

  // Shallow roof — a working building, not a home.
  for (let y = apexY; y <= eaveY; y++) {
    const half = Math.round(((y - apexY) / (eaveY - apexY)) * 27);
    for (let x = cx - half; x <= cx + half; x++) {
      put(g, x, y, (y - apexY) % 3 === 0 ? "S" : x < cx - 2 ? "H" : "R");
    }
    put(g, cx - half, y, "O");
    put(g, cx + half, y, "O");
  }
  for (let x = 0; x < SHED_W; x++) put(g, x, eaveY, "O");

  // Vertical board-and-batten walls.
  for (let y = 16; y <= 40; y++) {
    for (let x = 3; x <= 50; x++) put(g, x, y, x % 4 === 0 ? "k" : "b");
  }
  for (let y = 16; y <= 40; y++) {
    put(g, 3, y, "O");
    put(g, 50, y, "O");
  }

  // The open bay, and the dark of the shop behind it.
  box(g, 12, 19, 41, 40, "D");
  box(g, 12, 19, 41, 20, "b");
  for (let y = 19; y <= 40; y++) {
    box(g, 12, y, 13, y, "b");
    box(g, 40, y, 41, y, "k");
    put(g, 11, y, "O");
    put(g, 42, y, "O");
  }

  // Tools on the back wall.
  for (const x of [16, 19, 22, 25]) {
    put(g, x, 23, "I");
    put(g, x, 24, "i");
    put(g, x, 25, "i");
  }

  // Workbench along the left of the bay.
  box(g, 15, 32, 27, 34, "b");
  box(g, 15, 35, 27, 35, "k");
  put(g, 16, 31, "I");
  put(g, 21, 31, "I");

  // The forge. Coals brighten and fade; the mouth throws light on the sill.
  box(g, 29, 30, 39, 39, "t");
  box(g, 30, 31, 38, 38, "s");
  box(g, 31, 33, 37, 38, "O");
  const coal = heat === 0 ? "e" : heat === 1 ? "E" : "F";
  const flame = heat === 2 ? "F" : "E";
  box(g, 32, 36, 36, 37, coal);
  box(g, 33, 34, 35, 35, flame);
  put(g, 34, 33, heat === 2 ? "F" : "E");
  for (let x = 31; x <= 37; x++) put(g, x, 39, heat === 0 ? "E" : "F");

  // Stove pipe venting the forge.
  box(g, 44, 2, 47, 16, "i");
  for (let y = 2; y <= 16; y++) {
    put(g, 44, y, "I");
    put(g, 43, y, "O");
    put(g, 48, y, "O");
  }
  for (let x = 42; x <= 49; x++) put(g, x, 1, "O");
  for (let x = 43; x <= 48; x++) put(g, x, 2, "I");

  // Hanging sign on the left wall.
  box(g, 4, 21, 10, 29, "O");
  box(g, 5, 22, 9, 28, "b");
  put(g, 7, 24, "I");
  put(g, 6, 25, "I");
  put(g, 7, 25, "I");
  put(g, 8, 25, "I");
  put(g, 7, 26, "k");

  // Footing.
  for (let y = 41; y <= 43; y++) {
    for (let x = 2; x <= 51; x++) put(g, x, y, (x + y) % 3 === 0 ? "t" : "s");
  }

  return rows(g);
}

export const SHED_FRAMES: string[][] = [buildShed(0), buildShed(1), buildShed(2), buildShed(1)];

/* -------------------------------------------------------------- campfire */

export const FIRE_W = 24;
export const FIRE_H = 24;

/**
 * The campfire. The ring and logs are fixed; the flame is redrawn each frame
 * from a tapering profile with a lateral sway, which reads as fire far better
 * than swapping between hand-drawn licks.
 */
function buildFire(phase: number): string[] {
  const g = grid(FIRE_W, FIRE_H);
  const cx = 12;
  const base = 18;

  // Stone ring, an ellipse band open at the top so the fire sits inside it.
  for (let y = 12; y < FIRE_H; y++) {
    for (let x = 0; x < FIRE_W; x++) {
      const nx = (x - cx) / 11;
      const ny = (y - 18) / 5.2;
      const d = nx * nx + ny * ny;
      if (d > 1 || d < 0.42) continue;
      put(g, x, y, d > 0.86 ? "t" : (x + y) % 3 === 0 ? "u" : "s");
    }
  }

  // Two logs crossed over the embers.
  for (let i = 0; i <= 13; i++) {
    put(g, 5 + i, 17 - Math.round(i * 0.32), i < 2 || i > 11 ? "k" : "b");
    put(g, 5 + i, 18 - Math.round(i * 0.32), "k");
    put(g, 18 - i, 16 - Math.round(i * 0.18), i < 2 || i > 11 ? "k" : "b");
  }
  box(g, 9, 16, 15, 17, "e");

  // Flame: a tapering profile swayed by the phase.
  const height = 13 + (phase % 2);
  for (let step = 0; step <= height; step++) {
    const t = step / height;
    const halfWidth = 4.6 * Math.pow(1 - t, 0.55) * (t < 0.15 ? 0.4 + t / 0.25 : 1);
    const sway = Math.sin(t * 3.4 + phase * 1.6) * 2.2 * t;
    const y = base - step;
    for (let x = Math.floor(cx + sway - halfWidth); x <= Math.ceil(cx + sway + halfWidth); x++) {
      const off = Math.abs(x - (cx + sway)) / Math.max(halfWidth, 0.6);
      if (off > 1) continue;
      put(g, x, y, off > 0.72 ? "e" : off > 0.36 || t > 0.72 ? "E" : "F");
    }
  }

  // Sparks lifting off the top, each frame a little different.
  for (const [sx, sy] of [
    [cx - 3 + phase, base - height - 3],
    [cx + 2 - phase, base - height - 5],
  ] as const) {
    put(g, sx, sy, "F");
  }

  return rows(g);
}

export const FIRE_FRAMES: string[][] = [buildFire(0), buildFire(1), buildFire(2), buildFire(3)];

/* --------------------------------------------------------------- lantern */

export const LAMP_W = 10;
export const LAMP_H = 26;

function buildLamp(bright: boolean): string[] {
  const g = grid(LAMP_W, LAMP_H);
  // Post and its footing.
  for (let y = 9; y <= 23; y++) {
    put(g, 4, y, "b");
    put(g, 5, y, "k");
    put(g, 3, y, "O");
    put(g, 6, y, "O");
  }
  for (let x = 2; x <= 7; x++) {
    put(g, x, 24, "s");
    put(g, x, 25, "t");
  }
  // Head: a glazed box with a flame in it.
  box(g, 1, 3, 8, 10, "O");
  box(g, 2, 4, 7, 9, "a");
  box(g, 3, 5, 6, 8, bright ? "A" : "a");
  put(g, 4, 6, "A");
  put(g, 5, 6, "A");
  for (let x = 1; x <= 8; x++) put(g, x, 2, "i");
  put(g, 4, 1, "i");
  put(g, 5, 1, "i");
  return rows(g);
}

export const LAMP_FRAMES: string[][] = [buildLamp(true), buildLamp(false)];

/* ------------------------------------------------------------------ tent */

export const TENT_W = 28;
export const TENT_H = 21;

function buildTent(): string[] {
  const g = grid(TENT_W, TENT_H);
  const cx = 14;
  const apexY = 2;
  const baseY = 18;
  for (let y = apexY; y <= baseY; y++) {
    const half = Math.round(((y - apexY) / (baseY - apexY)) * 13);
    for (let x = cx - half; x <= cx + half; x++) {
      put(g, x, y, x > cx + 1 ? "C" : "c");
    }
    put(g, cx - half, y, "O");
    put(g, cx + half, y, "O");
  }
  // Rolled-back door flap, and the dark inside it.
  for (let y = 9; y <= baseY; y++) {
    const half = Math.round(((y - 9) / (baseY - 9)) * 5);
    for (let x = cx - half; x <= cx + half; x++) put(g, x, y, "D");
  }
  for (let x = cx - 6; x <= cx - 4; x++) put(g, x, baseY - 1, "C");
  // Ridge pole and guy lines.
  put(g, cx, 1, "k");
  put(g, cx, 0, "k");
  for (let i = 0; i <= 4; i++) {
    put(g, 1 + i, 12 + i, "k");
    put(g, 26 - i, 12 + i, "k");
  }
  for (let x = 0; x < TENT_W; x++) put(g, x, baseY + 1, x % 2 === 0 ? "O" : "k");
  return rows(g);
}

export const TENT_FRAMES: string[][] = [buildTent()];

/* ---------------------------------------------------------------- shrine */

export const SHRINE_W = 38;
export const SHRINE_H = 40;

/**
 * The grove's shrine: where a dryad goes when its work has landed. A stone arch
 * over a lit basin — somewhere for a finished turn to be *put*, which a bare
 * tree never gave it.
 */
function buildShrine(flare: number): string[] {
  const g = grid(SHRINE_W, SHRINE_H);

  // Two pillars carrying a lintel.
  for (const px0 of [4, 27]) {
    box(g, px0, 13, px0 + 6, 34, "s");
    for (let y = 13; y <= 34; y++) {
      put(g, px0, y, "u");
      put(g, px0 - 1, y, "O");
      put(g, px0 + 7, y, "O");
      // Coursing, so the stone reads as blocks rather than a slab.
      if ((y - 13) % 4 === 3) for (let x = px0; x <= px0 + 6; x++) put(g, x, y, "t");
    }
  }

  box(g, 2, 8, 35, 12, "s");
  for (let x = 2; x <= 35; x++) {
    put(g, x, 8, "u");
    put(g, x, 12, "t");
  }
  for (let y = 8; y <= 12; y++) {
    put(g, 1, y, "O");
    put(g, 36, y, "O");
  }
  for (let x = 1; x <= 36; x++) put(g, x, 7, "O");

  // A carved mark on the lintel, lit from the basin below.
  for (const [mx, my] of [
    [18, 10],
    [19, 9],
    [20, 10],
    [19, 11],
  ] as const) {
    put(g, mx, my, "a");
  }

  // The basin, and its flame.
  box(g, 14, 26, 23, 30, "t");
  box(g, 15, 27, 22, 29, "s");
  for (let y = 31; y <= 33; y++) box(g, 17, y, 20, y, "t");
  box(g, 14, 34, 23, 35, "u");

  const height = 6 + (flare % 2);
  for (let step = 0; step <= height; step++) {
    const t = step / height;
    const half = 3.4 * Math.pow(1 - t, 0.6);
    const sway = Math.sin(t * 3 + flare * 1.7) * 1.4 * t;
    const y = 26 - step;
    for (let x = Math.floor(18.5 + sway - half); x <= Math.ceil(18.5 + sway + half); x++) {
      const off = Math.abs(x - (18.5 + sway)) / Math.max(half, 0.6);
      if (off > 1) continue;
      put(g, x, y, off > 0.7 ? "e" : off > 0.34 || t > 0.7 ? "E" : "F");
    }
  }

  // Steps up to it.
  for (let y = 36; y <= 38; y++) {
    const inset = y - 36;
    for (let x = 6 + inset * 2; x <= 31 - inset * 2; x++) {
      put(g, x, y, (x + y) % 3 === 0 ? "t" : "u");
    }
  }
  for (let x = 4; x <= 33; x++) put(g, x, 39, "O");

  // Moss, because the forest is always taking it back.
  for (const [mx, my] of [
    [5, 30],
    [6, 33],
    [32, 28],
    [33, 32],
    [3, 11],
  ] as const) {
    put(g, mx, my, "m");
  }

  return rows(g);
}

export const SHRINE_FRAMES: string[][] = [
  buildShrine(0),
  buildShrine(1),
  buildShrine(2),
  buildShrine(1),
];

/* ------------------------------------------------------------------ gate */

export const GATE_W = 46;
export const GATE_H = 30;

/**
 * The checkpoint at the notice board. The bar is *down*: a dryad waiting on a
 * permission decision literally cannot get through, which is a better picture
 * of being blocked than a noticeboard on its own.
 */
function buildGate(lit: boolean): string[] {
  const g = grid(GATE_W, GATE_H);

  // Stone footings and timber posts.
  for (const px0 of [3, 38]) {
    box(g, px0, 6, px0 + 4, 25, "b");
    for (let y = 6; y <= 25; y++) {
      put(g, px0, y, "L");
      put(g, px0 + 4, y, "W");
      put(g, px0 - 1, y, "O");
      put(g, px0 + 5, y, "O");
    }
    for (let x = px0 - 2; x <= px0 + 6; x++) {
      put(g, x, 5, "O");
      put(g, x, 26, "s");
      put(g, x, 27, "t");
    }
    box(g, px0 - 2, 26, px0 + 6, 26, "u");
  }

  // The barrier across the road, striped so it reads as "stop".
  for (let y = 12; y <= 15; y++) {
    for (let x = 8; x <= 37; x++) {
      const band = Math.floor((x - 8) / 5) % 2 === 0;
      put(g, x, y, y === 12 ? "O" : y === 15 ? "O" : band ? "e" : "c");
    }
  }
  put(g, 8, 13, "O");
  put(g, 8, 14, "O");
  put(g, 37, 13, "O");
  put(g, 37, 14, "O");

  // A lamp on the left post so the gate is visible at night.
  box(g, 1, 1, 8, 8, "O");
  box(g, 2, 2, 7, 7, "a");
  box(g, 3, 3, 6, 6, lit ? "A" : "a");
  for (let x = 1; x <= 8; x++) put(g, x, 0, "i");

  return rows(g);
}

export const GATE_FRAMES: string[][] = [buildGate(true), buildGate(false)];

/* -------------------------------------------------------------- wildlife */

export const RABBIT_W = 11;
export const RABBIT_H = 9;

/** A rabbit that never gets anywhere: two frames, sat then mid-hop. */
export const RABBIT_FRAMES: string[][] = [
  [
    "...OO......",
    "..OnnO.....",
    "..OnnO.....",
    "..OnnnOOO..",
    ".OnOnnnnnO.",
    "OnnnnnnnnnO",
    "OnnnnnnnnNO",
    ".OnnnnnnnNO",
    "..OO..OO...",
  ],
  [
    "..OO.......",
    ".OnnO......",
    ".OnnO..OOO.",
    ".OnnnOOnnnO",
    "OnOnnnnnnnO",
    "OnnnnnnnnNO",
    ".OnnnnnnNO.",
    "..OOOOOO...",
    "...........",
  ],
];

export const OWL_W = 11;
export const OWL_H = 12;

/** An owl in the treeline. Blinks, which is most of what an owl does. */
export const OWL_FRAMES: string[][] = [
  [
    "..O.....O..",
    ".OLO...OLO.",
    ".OLLLLLLLO.",
    "OLLaaLaaLLO",
    "OLLaOLOaLLO",
    "OLLLLbLLLLO",
    "OLbbLLLbbLO",
    ".ObbbbbbbO.",
    ".ObWbbbWbO.",
    "..ObbbbbO..",
    "...O...O...",
    "..OO...OO..",
  ],
  [
    "..O.....O..",
    ".OLO...OLO.",
    ".OLLLLLLLO.",
    "OLLLLLLLLLO",
    "OLLOOLOOLLO",
    "OLLLLbLLLLO",
    "OLbbLLLbbLO",
    ".ObbbbbbbO.",
    ".ObWbbbWbO.",
    "..ObbbbbO..",
    "...O...O...",
    "..OO...OO..",
  ],
];

export const FROG_W = 10;
export const FROG_H = 8;

/** A frog on the bank. Two frames: sitting, and mid-croak. */
export const FROG_FRAMES: string[][] = [
  [
    "..OO..OO..",
    ".OaO..OaO.",
    ".OggggggO.",
    "OggggggggO",
    "OggggggggO",
    ".OggggggO.",
    "O.OOOOOO.O",
    "OO......OO",
  ],
  [
    "..OO..OO..",
    ".OaO..OaO.",
    ".OggggggO.",
    "OggggggggO",
    "OgggmmgggO",
    "OggggggggO",
    "O.OOOOOO.O",
    "OO......OO",
  ],
];

export const MOTH_W = 9;
export const MOTH_H = 7;

/** A moth working the lamps. Wings up, wings down. */
export const MOTH_FRAMES: string[][] = [
  [
    ".O.....O.",
    "OnO...OnO",
    "OnnO.OnnO",
    ".OnnOnnO.",
    "..OnNnO..",
    "...OnO...",
    "....O....",
  ],
  [
    ".........",
    "...OOO...",
    "OOnnnnnOO",
    "OnnnnnnnO",
    ".OOnNnOO.",
    "...OnO...",
    "....O....",
  ],
];
