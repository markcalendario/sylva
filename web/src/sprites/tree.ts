/**
 * The trees of Sylva. Generated rather than hand-drawn: an ellipse canopy over
 * a trunk, dithered so the silhouette doesn't read as a flat blob, with the
 * canopy nudged sideways per frame for a slow sway.
 */

export const TREE_W = 26;
export const TREE_H = 34;

export const TREE_PALETTE: Record<string, string> = {
  ".": "transparent",
  O: "#1b3520", // canopy edge
  d: "#2f6136", // canopy shadow
  g: "#3f8244", // canopy body
  l: "#5aa557", // canopy highlight
  b: "#5b3f27", // bark
  B: "#3a2717", // bark shadow
  r: "#26401f", // root shadow
  f: "#ffb454", // fruit / firefly rest
};

const CANOPY_CX = 12.5;
const CANOPY_CY = 11;
const CANOPY_RX = 12.5;
const CANOPY_RY = 10.5;

const TRUNK_LEFT = 11;
const TRUNK_RIGHT = 14;
const TRUNK_TOP = 19;
const TRUNK_BOTTOM = 31;

function buildTree(sway: number, withFruit: boolean): string[] {
  const grid: string[][] = Array.from({ length: TREE_H }, () => Array(TREE_W).fill("."));

  // Trunk first so the canopy overlaps its top.
  for (let y = TRUNK_TOP; y <= TRUNK_BOTTOM; y++) {
    const flare = y >= TRUNK_BOTTOM - 1 ? 1 : 0;
    for (let x = TRUNK_LEFT - flare; x <= TRUNK_RIGHT + flare; x++) {
      const row = grid[y];
      if (!row || x < 0 || x >= TREE_W) continue;
      row[x] = x >= TRUNK_RIGHT + flare - 1 ? "B" : "b";
    }
  }
  // Roots spreading at the base.
  const rootRow = grid[TRUNK_BOTTOM + 1];
  if (rootRow) {
    for (let x = TRUNK_LEFT - 3; x <= TRUNK_RIGHT + 3; x++) {
      if (x >= 0 && x < TREE_W) rootRow[x] = "r";
    }
  }

  for (let y = 0; y < TRUNK_TOP + 2; y++) {
    for (let x = 0; x < TREE_W; x++) {
      const nx = (x - (CANOPY_CX + sway)) / CANOPY_RX;
      const ny = (y - CANOPY_CY) / CANOPY_RY;
      // Deterministic wobble on the radius: a clean ellipse reads as a ball,
      // a lumpy one reads as foliage. No randomness, so frames stay stable.
      const angle = Math.atan2(ny, nx);
      const wobble = Math.sin(angle * 5) * 0.07 + Math.sin(angle * 3 + 1.2) * 0.05;
      const d = (nx * nx + ny * ny) / (1 + wobble);
      if (d > 1) continue;

      const row = grid[y];
      if (!row) continue;
      // Light falls from the upper left, same as on the dryads. Boundaries are
      // dithered on a checker so the bands don't read as hard paint edges.
      const checker = (x + y) % 2 === 0;
      const shade = nx + ny;
      if (d > 0.84) row[x] = "O";
      else if (shade < -0.62 || (shade < -0.42 && checker)) row[x] = "l";
      else if (shade > 0.58 || (shade > 0.38 && checker)) row[x] = "d";
      else row[x] = "g";
    }
  }

  if (withFruit) {
    for (const [fy, fx] of [
      [7, 8],
      [12, 17],
      [16, 11],
    ] as const) {
      const row = grid[fy];
      if (row) row[fx + sway] = "f";
    }
  }

  return grid.map((row) => row.join(""));
}

/** Two frames of sway; the third repeats the middle so the loop eases. */
export const TREE_FRAMES: string[][] = [buildTree(0, false), buildTree(1, false), buildTree(0, false), buildTree(-1, false)];

/** A tree bearing fruit — used when a worktree's last turn finished cleanly. */
export const TREE_FRAMES_FRUITING: string[][] = [
  buildTree(0, true),
  buildTree(1, true),
  buildTree(0, true),
  buildTree(-1, true),
];
