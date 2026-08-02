/**
 * Just enough of a terminal to read a dev server's output.
 *
 * Tools colour their output through SGR escape codes, and piping their stdout
 * makes most of them assume nobody is watching and strip it. The runner asks
 * for colour anyway (FORCE_COLOR), which means the codes arrive here as literal
 * escape sequences — so something has to turn them back into colour, or the log
 * reads as line noise wrapped around the actual message.
 *
 * This is not an emulator. There is no cursor, no scrollback addressing, no
 * alternate screen. It handles the codes that appear in build output and
 * discards the rest.
 */

export interface AnsiSegment {
  text: string;
  /** Class names for the span, or "" for unstyled text. */
  className: string;
}

/** SGR state that carries from one line to the next, as it does in a terminal. */
export interface AnsiState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

export const ANSI_INITIAL: AnsiState = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

const BASE_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

/**
 * Every escape sequence, not only the ones we act on: a progress spinner emits
 * cursor moves and line erases, and leaving those in the text shows them as
 * stray letters.
 */
const ESCAPE = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
const SGR = /\u001b\[([0-9;]*)m/g;

/** 256-colour cube and greyscale ramp, resolved to a hex string. */
function xterm256(index: number): string | null {
  if (index < 0 || index > 255) return null;
  if (index < 8) return `var(--ansi-${BASE_NAMES[index]})`;
  if (index < 16) return `var(--ansi-bright-${BASE_NAMES[index - 8]})`;
  if (index < 232) {
    const n = index - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    const r = level(Math.floor(n / 36));
    const g = level(Math.floor((n % 36) / 6));
    const b = level(n % 6);
    return `rgb(${r} ${g} ${b})`;
  }
  const grey = 8 + (index - 232) * 10;
  return `rgb(${grey} ${grey} ${grey})`;
}

/** Apply one SGR parameter run to the state. */
function applySgr(state: AnsiState, params: number[]): void {
  for (let i = 0; i < params.length; i++) {
    const code = params[i] ?? 0;

    if (code === 0) Object.assign(state, ANSI_INITIAL);
    else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 7) state.inverse = true;
    else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code === 27) state.inverse = false;
    else if (code >= 30 && code <= 37) state.fg = `var(--ansi-${BASE_NAMES[code - 30]})`;
    else if (code === 39) state.fg = null;
    else if (code >= 40 && code <= 47) state.bg = `var(--ansi-${BASE_NAMES[code - 40]})`;
    else if (code === 49) state.bg = null;
    else if (code >= 90 && code <= 97) {
      state.fg = `var(--ansi-bright-${BASE_NAMES[code - 90]})`;
    } else if (code >= 100 && code <= 107) {
      state.bg = `var(--ansi-bright-${BASE_NAMES[code - 100]})`;
    } else if (code === 38 || code === 48) {
      // Extended colour: 5;<n> for the 256 palette, 2;<r>;<g>;<b> for truecolor.
      const mode = params[i + 1];
      let colour: string | null = null;
      if (mode === 5) {
        colour = xterm256(params[i + 2] ?? -1);
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0];
        colour = `rgb(${r} ${g} ${b})`;
        i += 4;
      }
      if (code === 38) state.fg = colour;
      else state.bg = colour;
    }
  }
}

function classesFor(state: AnsiState): string {
  const classes: string[] = [];
  if (state.bold) classes.push("ansi-bold");
  if (state.dim) classes.push("ansi-dim");
  if (state.italic) classes.push("ansi-italic");
  if (state.underline) classes.push("ansi-underline");
  return classes.join(" ");
}

export interface ParsedLine {
  segments: AnsiSegment[];
  /** Inline colours, kept off the class list so 256-colour output works. */
  styles: { fg: string | null; bg: string | null }[];
  next: AnsiState;
}

/**
 * Parse one line, continuing from the previous line's state and returning the
 * state the next line should start from.
 */
export function parseAnsiLine(raw: string, from: AnsiState): ParsedLine {
  // A carriage return means the writer redrew the line in place — a progress
  // bar or a spinner. Only the final draw was ever meant to be seen.
  const line = raw.includes("\r") ? (raw.split("\r").pop() ?? "") : raw;

  const state: AnsiState = { ...from };
  const segments: AnsiSegment[] = [];
  const styles: { fg: string | null; bg: string | null }[] = [];

  let cursor = 0;
  SGR.lastIndex = 0;
  let match: RegExpExecArray | null;

  const push = (text: string) => {
    if (!text) return;
    // Strip anything left that isn't an SGR run — cursor moves, erases — and
    // then any bare escape byte the pattern couldn't match, which is what a
    // sequence truncated at the end of a line leaves behind.
    const clean = text.replace(ESCAPE, "").replace(/\u001b/g, "");
    if (!clean) return;
    const { fg, bg } = state.inverse
      ? { fg: state.bg ?? "var(--pine-0)", bg: state.fg ?? "var(--moon)" }
      : { fg: state.fg, bg: state.bg };
    segments.push({ text: clean, className: classesFor(state) });
    styles.push({ fg, bg });
  };

  while ((match = SGR.exec(line)) !== null) {
    push(line.slice(cursor, match.index));
    const body = match[1] ?? "";
    // A bare ESC[m is ESC[0m.
    const params = body === "" ? [0] : body.split(";").map((p) => Number(p) || 0);
    applySgr(state, params);
    cursor = match.index + match[0].length;
  }
  push(line.slice(cursor));

  return { segments, styles, next: state };
}

/** True when a line carries no escape sequences at all — the common case. */
export function isPlain(line: string): boolean {
  return !line.includes("\u001b") && !line.includes("\r");
}
