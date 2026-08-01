// The dryads of Sylva — 16x16 pixel creatures, one per worktree.
// Each state is a list of frames; each frame is 16 rows of glyphs.
// Rows shorter than 16 are right-padded with transparency.

export type SpriteState = "idle" | "working" | "success" | "error";

export const PALETTE: Record<string, string> = {
  ".": "transparent",
  G: "#2e5b31", // dark green outline
  g: "#4e8b44", // body
  l: "#7fd068", // highlight
  d: "#1c3a20", // deep shadow / mouth
  k: "#10180f", // eyes
  w: "#e9f0e4", // eye shine
  a: "#ffb454", // firefly amber
  r: "#ff6b5b", // ember
  b: "#7a5537", // stem
};

const IDLE_A = [
  "................",
  "......b.........",
  ".....lb.........",
  "....Glllg.......",
  "...GglllggG.....",
  "..Glgggggggl....",
  "..GgwkggwkgG....",
  ".GggkkggkkggG...",
  ".GgggggggggglG..",
  ".GggddddggggG...",
  "..Gggggggggl....",
  "...GgllllggG....",
  "....G.G..G.G....",
  "................",
];

const IDLE_B = [
  "................",
  "................",
  "......b.........",
  ".....lb.........",
  "....Glllg.......",
  "...GglllggG.....",
  "..Glgggggggl....",
  "..GgkkggkkgG....",
  ".GggggggggggG...",
  ".GgggggggggglG..",
  ".GggddddggggG...",
  "...GgllllggG....",
  "....G.G..G.G....",
  "................",
];

const WORK_A = [
  "................",
  "......b....a....",
  ".....lb.........",
  "....Glllg.......",
  "...GglllggG.....",
  "..Glgggggggl....",
  "..GgkwggkwgG....",
  ".GggkkggkkggG...",
  ".GgggggggggglG..",
  ".Gggddddggggl...",
  "..Ggggggggga....",
  "...GgllllgaaG...",
  "....G.G.aaaa....",
  "........aaaa....",
];

const WORK_B = [
  "................",
  "......b.........",
  ".....lb....a....",
  "....Glllg.......",
  "...GglllggG.....",
  "..Glgggggggl....",
  "..GgwkggwkgG....",
  ".GggkkggkkggG...",
  ".GggggggggggG...",
  ".Ggggddddgggl...",
  "..Gggggggga.....",
  "...GgllllgaaG...",
  "....G.G.aaaa....",
  "........aaaa....",
];

const SUCCESS_A = [
  "....a...........",
  "......b......a..",
  ".....lb.........",
  "....Glllg.......",
  "l..GglllggG..l..",
  "GlGlggggggglGlG.",
  ".GGgwkggwkgGG...",
  "..GgkkggkkgG....",
  ".GggggggggggG...",
  ".GggdddddgggG...",
  "..Ggggggggga....",
  "...GgllllggG....",
  "....G.G..G.G....",
  "................",
];

const SUCCESS_B = [
  "................",
  "..a...b.....a...",
  ".....lb.........",
  "....Glllg....a..",
  "l..GglllggG..l..",
  "GlGlggggggglGlG.",
  ".GGgwkggwkgGG...",
  "..GgkkggkkgG....",
  ".GggggggggggG...",
  ".GggdddddgggG...",
  "..Gggggggggl....",
  "...GgllllggG....",
  "...G.G....G.G...",
  "................",
];

const ERROR_A = [
  ".......r........",
  ".......r........",
  "......b.........",
  ".....lb.........",
  "....Glllg.......",
  "...GglllggG.....",
  "..Glgggggggl....",
  "..GgkgkgkgkG....",
  ".GgggkgggkggG...",
  ".GgggggggggglG..",
  ".GgdgggggdggG...",
  "..Ggdddddggl....",
  "...GgllllggG....",
  "....G.G..G.G....",
];

const ERROR_B = [
  ".......r........",
  "................",
  ".......b........",
  "......bl........",
  ".....Glllg......",
  "....GglllggG....",
  "...Glgggggggl...",
  "...GgkgkgkgkG...",
  "..GggkgggkgggG..",
  "..GgggggggggglG.",
  "..GgdgggggdggG..",
  "...GgdddddggG...",
  "....GgllllggG...",
  ".....G.G..G.G...",
];

export const SPRITE_FRAMES: Record<SpriteState, string[][]> = {
  idle: [IDLE_A, IDLE_B],
  working: [WORK_A, WORK_B],
  success: [SUCCESS_A, SUCCESS_B],
  error: [ERROR_A, ERROR_B],
};

/** Frame duration per state, ms. Working types fast; idling breathes slow. */
export const SPRITE_SPEED: Record<SpriteState, number> = {
  idle: 900,
  working: 220,
  success: 320,
  error: 260,
};
