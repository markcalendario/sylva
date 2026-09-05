// The dryads of Sylva — 24x24 sprouts, one per worktree.
//
// Frames are composed rather than hand-drawn per state: one rounded body holds
// placeholders for the eyes (E/F) and mouth (M), and each expression fills them
// in. That keeps the silhouette identical across states, so a worktree's
// character reads as the same creature whether it's resting or panicking.

/**
 * Five, because "waiting for you" and "it broke" are not the same news.
 *
 * They used to share the error state, and so shared its red — which said
 * something had gone wrong every time an agent politely asked whether it could
 * run a command. The forest map has always known the difference: that dryad
 * stands at the notice board, and the board is where you go to *ask*.
 */
export type SpriteState = "idle" | "working" | "success" | "blocked" | "error";

export const GRID = 24;

export const PALETTE: Record<string, string> = {
  ".": "transparent",
  O: "#22402a", // outline
  l: "#a9e6a4", // body highlight (upper left)
  g: "#7cc47f", // body
  d: "#5da367", // body shadow (lower)
  k: "#1b2a1c", // eyes, mouth
  w: "#f4fff0", // eye shine
  p: "#ff9db0", // blush
  s: "#a8813f", // stem
  e: "#9bd645", // leaf
  a: "#ffb454", // firefly
  y: "#fff0b8", // sparkle
  r: "#ff6b5b", // fluster
};

/**
 * The shared body. `E`/`F` mark the 3x4 eye wells, `M` the mouth.
 * Every row is exactly GRID characters wide.
 */
const BODY = [
  "........................", // 0
  "........................", // 1
  ".........ee..ee.........", // 2
  "..........esse..........", // 3
  "...........ss...........", // 4
  "...........ss...........", // 5
  ".........OllllO.........", // 6
  ".......OllllllllO.......", // 7
  "......OllllllllllO......", // 8
  ".....OllllllggggggO.....", // 9
  "....OlllllgggggggggO....", // 10
  "....OllEEEggggFFFggO....", // 11
  "...OlllEEEggggFFFgggO...", // 12
  "...OlggEEEggggFFFgggO...", // 13
  "...OppgEEEggggFFFgppO...", // 14
  "...OppggggggggggggppO...", // 15
  "....OggggggMMgggggO.....", // 16
  "....OggggggggggggO......", // 17
  ".....OddddddddddddO.....", // 18
  "......OddddddddddO......", // 19
  ".......OOOOOOOOOO.......", // 20
  "........OO....OO........", // 21
  "........................", // 22
  "........................", // 23
];

const EYE_ROWS = [11, 12, 13, 14];
const MOUTH_ROW = 16;

/** 3 wide x 4 tall, top row first. */
type EyePattern = [string, string, string, string];

const EYES: Record<string, EyePattern> = {
  // Big and round, shine in the upper left.
  open: ["wkk", "kkk", "kkk", "gkg"],
  // Mid-blink.
  blink: ["ggg", "ggg", "kkk", "ggg"],
  // Narrowed in concentration.
  focused: ["ggg", "wkk", "kkk", "gkg"],
  // Happy arcs.
  happy: ["ggg", "gkg", "kgk", "ggg"],
  // Startled: wide with a small pupil.
  wide: ["kkk", "kwk", "kkk", "kkk"],
};

const MOUTHS: Record<string, string> = {
  smile: "kk",
  small: "gk",
  open: "kk",
  flat: "kk",
};

interface FrameSpec {
  eyes: keyof typeof EYES;
  mouth: keyof typeof MOUTHS;
  /** Extra pixels painted on top: [row, col, paletteKey]. */
  extras?: Array<[number, number, string]>;
  /** Shift the whole creature down by a row for a breathing/bobbing beat. */
  bob?: boolean;
}

function replaceAt(row: string, index: number, text: string): string {
  return row.slice(0, index) + text + row.slice(index + text.length);
}

function buildFrame(spec: FrameSpec): string[] {
  const rows = [...BODY];
  const eye = EYES[spec.eyes];
  const mouth = MOUTHS[spec.mouth];

  EYE_ROWS.forEach((rowIndex, i) => {
    let row = rows[rowIndex] as string;
    row = row.replace("EEE", (eye?.[i] ?? "kkk") as string);
    row = row.replace("FFF", (eye?.[i] ?? "kkk") as string);
    rows[rowIndex] = row;
  });

  const mouthRow = rows[MOUTH_ROW] as string;
  rows[MOUTH_ROW] = mouthRow.replace("MM", mouth ?? "kk");

  for (const [r, c, key] of spec.extras ?? []) {
    const row = rows[r];
    if (row === undefined || c < 0 || c >= GRID) continue;
    rows[r] = replaceAt(row, c, key);
  }

  if (spec.bob) {
    rows.pop();
    rows.unshift(".".repeat(GRID));
  }
  return rows;
}

export const SPRITE_FRAMES: Record<SpriteState, string[][]> = {
  // Resting: a slow breath, then a blink.
  idle: [
    buildFrame({ eyes: "open", mouth: "smile" }),
    buildFrame({ eyes: "open", mouth: "smile", bob: true }),
    buildFrame({ eyes: "blink", mouth: "smile", bob: true }),
  ],
  // Working: heads-down, with a firefly circling.
  working: [
    buildFrame({ eyes: "focused", mouth: "small", extras: [[5, 19, "a"]] }),
    buildFrame({ eyes: "focused", mouth: "flat", bob: true, extras: [[8, 21, "a"]] }),
    buildFrame({ eyes: "focused", mouth: "small", extras: [[12, 22, "a"]] }),
    buildFrame({ eyes: "focused", mouth: "flat", bob: true, extras: [[8, 2, "a"]] }),
  ],
  // Finished: eyes closed happily, sparkles.
  success: [
    buildFrame({
      eyes: "happy",
      mouth: "open",
      extras: [
        [3, 3, "y"],
        [6, 20, "y"],
        [10, 1, "y"],
      ],
    }),
    buildFrame({
      eyes: "happy",
      mouth: "open",
      bob: true,
      extras: [
        [2, 19, "y"],
        [7, 2, "y"],
        [11, 22, "y"],
      ],
    }),
  ],
  // Waiting on you: attentive rather than flustered, and the mark is the
  // firefly's amber — the colour this app uses for "something wants you".
  blocked: [
    buildFrame({ eyes: "open", mouth: "small", extras: [[6, 20, "a"]] }),
    buildFrame({ eyes: "open", mouth: "small", bob: true, extras: [[5, 21, "a"]] }),
  ],
  // Trouble: wide eyes and a fluster mark.
  error: [
    buildFrame({ eyes: "wide", mouth: "open", extras: [[6, 20, "r"]] }),
    buildFrame({ eyes: "wide", mouth: "open", bob: true, extras: [[5, 21, "r"]] }),
  ],
};

/** Frame duration per state, ms. Working types fast; idling breathes slow. */
export const SPRITE_SPEED: Record<SpriteState, number> = {
  idle: 700,
  working: 180,
  success: 260,
  // Slower than a fluster: it is waiting, not panicking.
  blocked: 420,
  error: 220,
};
