/** Scenery for the forest clearing: the workbench a dryad walks to, and a stump. */

export const PROP_PALETTE: Record<string, string> = {
  ".": "transparent",
  O: "#2b1d11", // outline
  b: "#6b4a2c", // bark / plank
  d: "#4a321d", // shadowed wood
  l: "#8a6238", // lit edge
  r: "#7d5a36", // stump rings
  a: "#ffb454", // lamp glow
  k: "#1b2a1c",
};

export const BENCH_W = 18;
export const BENCH_H = 12;

/** A low workbench with a lamp post — where a working dryad goes. */
export const BENCH_FRAMES: string[][] = [
  [
    "................a.",
    "...............OaO",
    "................O.",
    "................b.",
    "..OOOOOOOOOOOO..b.",
    "..OllllllllllO..b.",
    "..ObbbbbbbbbbO..b.",
    "..OddddddddddO..b.",
    "..O..........O..b.",
    "..b..........b..b.",
    "..b..........b..b.",
    "..O..........O..O.",
  ],
  [
    "................a.",
    "...............OaO",
    "................O.",
    "................b.",
    "..OOOOOOOOOOOO..b.",
    "..OllllllllllO..b.",
    "..ObbbbbbbbbbO..b.",
    "..OddddddddddO..b.",
    "..O..........O..b.",
    "..b..........b..b.",
    "..b..........b..b.",
    "..O..........O..O.",
  ],
];

export const STUMP_W = 12;
export const STUMP_H = 7;

/** A cut stump the dryad curls up against to sleep. */
export const STUMP_FRAMES: string[][] = [
  [
    "..OOOOOOOO..",
    ".OllllllllO.",
    ".OlrrrrrrlO.",
    ".OlrbbbbrlO.",
    ".ObbbbbbbbO.",
    "..OddddddO..",
    "...OOOOOO...",
  ],
];
