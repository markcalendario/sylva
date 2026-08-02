import { describe, expect, it } from "vitest";
import { ANSI_INITIAL, parseAnsiLine, type AnsiState } from "./ansi";

/** The escape byte, by code point: a literal one in source is invisible. */
const ESC = String.fromCharCode(27);

/** Flatten a parse back to plain text, which is what must never be mangled. */
function textOf(line: string, from: AnsiState = ANSI_INITIAL): string {
  return parseAnsiLine(line, from)
    .segments.map((s) => s.text)
    .join("");
}

describe("ansi", () => {
  it("leaves plain text exactly as it found it", () => {
    expect(textOf("VITE v7.1.0  ready in 412 ms")).toBe("VITE v7.1.0  ready in 412 ms");
  });

  it("colours a segment and drops the escape codes from the text", () => {
    const { segments, styles } = parseAnsiLine(`${ESC}[32mready${ESC}[39m in 412 ms`, ANSI_INITIAL);
    expect(segments.map((s) => s.text)).toEqual(["ready", " in 412 ms"]);
    expect(styles[0]?.fg).toBe("var(--ansi-green)");
    expect(styles[1]?.fg).toBeNull();
  });

  it("handles the arrow line a Vite server actually prints", () => {
    const raw = `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ${ESC}[36mhttp://localhost:5173/${ESC}[39m`;
    expect(textOf(raw)).toBe("  ➜  Local:   http://localhost:5173/");
    const { segments } = parseAnsiLine(raw, ANSI_INITIAL);
    expect(segments.some((s) => s.className.includes("ansi-bold"))).toBe(true);
  });

  it("carries state to the next line, the way a terminal does", () => {
    const first = parseAnsiLine(`${ESC}[31merror:`, ANSI_INITIAL);
    expect(first.next.fg).toBe("var(--ansi-red)");
    // No reset was sent, so the continuation is still red.
    const second = parseAnsiLine("  at line 4", first.next);
    expect(second.styles[0]?.fg).toBe("var(--ansi-red)");
  });

  it("resets everything on ESC[0m and on a bare ESC[m", () => {
    for (const reset of [`${ESC}[0m`, `${ESC}[m`]) {
      const { next } = parseAnsiLine(`${ESC}[1;31mloud${reset}`, ANSI_INITIAL);
      expect(next).toEqual(ANSI_INITIAL);
    }
  });

  it("reads 256-colour and truecolor", () => {
    expect(parseAnsiLine(`${ESC}[38;5;208mo`, ANSI_INITIAL).styles[0]?.fg).toBe("rgb(255 135 0)");
    expect(parseAnsiLine(`${ESC}[38;2;10;20;30mo`, ANSI_INITIAL).styles[0]?.fg).toBe(
      "rgb(10 20 30)",
    );
  });

  it("maps the bright range separately from the base range", () => {
    expect(parseAnsiLine(`${ESC}[90mgrey`, ANSI_INITIAL).styles[0]?.fg).toBe(
      "var(--ansi-bright-black)",
    );
  });

  it("shows only the final draw of a redrawn line", () => {
    // A spinner rewrites the same line; the earlier frames were never meant
    // to be read as separate output.
    expect(textOf("25%\r50%\r100% done")).toBe("100% done");
  });

  it("discards cursor moves and line erases rather than printing them", () => {
    expect(textOf(`${ESC}[2K${ESC}[1Gbuilding${ESC}[0K`)).toBe("building");
    expect(textOf(`${ESC}[1A${ESC}[2Jcleared`)).toBe("cleared");
  });

  it("drops an OSC title sequence entirely", () => {
    expect(textOf(`${ESC}]0;a titleafter`)).toBe("after");
  });

  it("swaps colours on inverse video", () => {
    const { styles } = parseAnsiLine(`${ESC}[7;31mflag`, ANSI_INITIAL);
    expect(styles[0]?.bg).toBe("var(--ansi-red)");
  });

  it("survives a lone escape at the end of a chunk", () => {
    expect(textOf(`tail${ESC}`)).toBe("tail");
  });
});
