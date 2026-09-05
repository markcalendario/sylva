import Prism from "prismjs";
// Core ships markup, css, clike and javascript. Everything else has to be
// asked for, and each one costs bundle — so this is the set a worktree in this
// app actually contains, not every grammar Prism knows.
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-java";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-diff";

/** A run of characters that share one token type. */
export interface Chunk {
  text: string;
  /** Prism's token type plus aliases, space separated; absent for plain text. */
  type?: string;
}

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  sql: "sql",
  diff: "diff",
  patch: "diff",
};

/** Files whose whole name says what they are, extension or not. */
const BY_NAME: Record<string, string> = {
  dockerfile: "bash",
  makefile: "bash",
  ".gitignore": "bash",
  ".env": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
};

/** The grammar to read a path with, or null when we have no opinion. */
export function languageFor(path: string): string | null {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  // ".env.local" and "vite.config.ts" both want the *last* segment.
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/**
 * The language named on a markdown fence.
 *
 * A fence carries a name rather than a path — ```ts, ```sh, ```console — so the
 * extension table above answers most of it, and the rest are the aliases people
 * actually type. Unknown names return null, which renders the block plain
 * rather than guessing a grammar and colouring it wrong.
 */
const FENCE_ALIASES: Record<string, string> = {
  console: "bash",
  shell: "bash",
  sh: "bash",
  shellsession: "bash",
  jsonc: "json",
  text: "",
  txt: "",
  plaintext: "",
};

export function languageForFence(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const alias = FENCE_ALIASES[key];
  if (alias !== undefined) return alias || null;
  // The extension table first: Prism answers to "ts" as an alias, but the
  // canonical name is what the editor uses for the same file, and one language
  // reaching the tokeniser under two names is how the two drift apart.
  return BY_EXTENSION[key] ?? (Prism.languages[key] ? key : null);
}

function flatten(tokens: (string | Prism.Token)[], parent: string | undefined, out: Chunk[]): void {
  for (const token of tokens) {
    if (typeof token === "string") {
      out.push(parent ? { text: token, type: parent } : { text: token });
      continue;
    }
    const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
    const type = [parent, token.type, ...aliases].filter(Boolean).join(" ");
    if (typeof token.content === "string") out.push({ text: token.content, type });
    else if (Array.isArray(token.content)) flatten(token.content, type, out);
    else flatten([token.content], type, out);
  }
}

/**
 * Colour a file, one array of chunks per line.
 *
 * Tokenising and *then* splitting is the whole point: a block comment or a
 * template literal spans lines, so highlighting line by line would reopen the
 * grammar on every one and mis-colour everything after the first. Prism's own
 * HTML output has the same problem in reverse — it can't be split on newlines
 * without cutting a `<span>` in half — which is why this walks tokens instead.
 */
export function highlightLines(code: string, language: string | null): Chunk[][] {
  const grammar = language ? Prism.languages[language] : undefined;
  if (!grammar) return code.split("\n").map((text) => (text ? [{ text }] : []));

  const chunks: Chunk[] = [];
  flatten(Prism.tokenize(code, grammar), undefined, chunks);

  const lines: Chunk[][] = [[]];
  for (const chunk of chunks) {
    const parts = chunk.text.split("\n");
    for (const [i, part] of parts.entries()) {
      if (i > 0) lines.push([]);
      if (!part) continue;
      const line = lines[lines.length - 1];
      line?.push(chunk.type ? { text: part, type: chunk.type } : { text: part });
    }
  }
  return lines;
}

/** Prism's token names, namespaced so they can't collide with app classes. */
export function chunkClass(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return type
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => `tok-${name}`)
    .join(" ");
}
