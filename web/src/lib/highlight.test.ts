import { describe, expect, it } from "vitest";
import { chunkClass, highlightLines, languageFor, languageForFence } from "./highlight";

/** The text of a highlighted line, to check nothing was lost or reordered. */
function text(line: { text: string }[]): string {
  return line.map((chunk) => chunk.text).join("");
}

describe("languageFor", () => {
  it("reads the extension", () => {
    expect(languageFor("src/index.ts")).toBe("typescript");
    expect(languageFor("web/src/App.tsx")).toBe("tsx");
    expect(languageFor("package.json")).toBe("json");
  });

  it("takes the last extension, not the first", () => {
    expect(languageFor("vite.config.ts")).toBe("typescript");
    expect(languageFor("styles.module.css")).toBe("css");
  });

  it("knows files whose whole name says what they are", () => {
    expect(languageFor("Dockerfile")).toBe("bash");
    expect(languageFor("deploy/Makefile")).toBe("bash");
  });

  it("has no opinion about the rest", () => {
    expect(languageFor("LICENSE")).toBeNull();
    expect(languageFor("data.parquet")).toBeNull();
  });
});

describe("highlightLines", () => {
  it("keeps every character, in order", () => {
    const code = 'const a = "one";\nconst b = 2; // two\n';
    const lines = highlightLines(code, "typescript");
    expect(lines.map(text).join("\n")).toBe(code);
  });

  it("splits into one entry per line", () => {
    // Three newlines, so four lines — the last of them empty.
    const lines = highlightLines("a\nb\nc\n", "typescript");
    expect(lines).toHaveLength(4);
    expect(text(lines[3] ?? [])).toBe("");
  });

  it("colours a token that spans several lines", () => {
    // The whole point of tokenising before splitting: a line-by-line
    // highlighter would treat lines two and three as code.
    const lines = highlightLines(
      "const a = 1;\n/* still\na comment */\nconst b = 2;",
      "typescript",
    );
    expect(lines[1]?.every((c) => c.type?.includes("comment"))).toBe(true);
    expect(lines[2]?.some((c) => c.type?.includes("comment"))).toBe(true);
    expect(lines[3]?.some((c) => c.type?.includes("keyword"))).toBe(true);
  });

  it("passes text through untouched when there is no grammar", () => {
    const lines = highlightLines("plain\ntext", null);
    expect(lines.map(text)).toEqual(["plain", "text"]);
    expect(lines.flat().every((c) => c.type === undefined)).toBe(true);
  });

  it("survives an unknown language name", () => {
    const lines = highlightLines("a\nb", "klingon");
    expect(lines.map(text)).toEqual(["a", "b"]);
  });
});

describe("chunkClass", () => {
  it("namespaces every token name", () => {
    expect(chunkClass("string")).toBe("tok-string");
    expect(chunkClass("keyword control-flow")).toBe("tok-keyword tok-control-flow");
  });

  it("says nothing about plain text", () => {
    expect(chunkClass(undefined)).toBeUndefined();
  });
});

describe("fence languages", () => {
  it("takes the names people actually type", () => {
    expect(languageForFence("ts")).toBe("typescript");
    expect(languageForFence("TSX")).toBe("tsx");
    expect(languageForFence("console")).toBe("bash");
    expect(languageForFence("sh")).toBe("bash");
    expect(languageForFence("python")).toBe("python");
  });

  it("returns null rather than guessing", () => {
    // Plain text is named, not unknown — but both must render uncoloured, or a
    // fence gets a grammar it was never written in.
    expect(languageForFence("text")).toBeNull();
    expect(languageForFence("")).toBeNull();
    expect(languageForFence("brainfuck")).toBeNull();
  });
});
