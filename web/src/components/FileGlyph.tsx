import {
  Braces,
  Database,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Palette,
  type LucideIcon,
} from "lucide-react";

/**
 * What a file is, drawn rather than spelled.
 *
 * A change list is read by scanning it, and an extension is the one thing about
 * a path that a scan can use: it says whether a row is code, a stylesheet, a
 * picture or a lockfile before the name has been read at all. The mark that
 * used to sit here said which *kind of change* the row was — and that is still
 * said, in the colour the icon is drawn in, so nothing was traded away for it.
 */
const BY_EXTENSION: Record<string, LucideIcon> = {
  // Code. One icon rather than a language each: the row already carries the
  // extension, and twenty near-identical glyphs distinguish nothing.
  ts: FileCode2,
  tsx: FileCode2,
  js: FileCode2,
  jsx: FileCode2,
  mjs: FileCode2,
  cjs: FileCode2,
  mts: FileCode2,
  cts: FileCode2,
  vue: FileCode2,
  svelte: FileCode2,
  astro: FileCode2,
  py: FileCode2,
  rb: FileCode2,
  go: FileCode2,
  rs: FileCode2,
  java: FileCode2,
  kt: FileCode2,
  kts: FileCode2,
  swift: FileCode2,
  c: FileCode2,
  h: FileCode2,
  cc: FileCode2,
  cpp: FileCode2,
  hpp: FileCode2,
  cs: FileCode2,
  php: FileCode2,
  dart: FileCode2,
  ex: FileCode2,
  exs: FileCode2,
  lua: FileCode2,
  hs: FileCode2,
  html: FileCode2,
  htm: FileCode2,
  xml: FileCode2,

  // Data you hand to a program rather than run.
  json: Braces,
  jsonc: Braces,
  json5: Braces,
  yaml: FileCog,
  yml: FileCog,
  toml: FileCog,
  ini: FileCog,
  conf: FileCog,
  cfg: FileCog,
  env: FileCog,
  properties: FileCog,

  css: Palette,
  scss: Palette,
  sass: Palette,
  less: Palette,
  styl: Palette,

  md: FileText,
  mdx: FileText,
  markdown: FileText,
  txt: FileText,
  rst: FileText,
  adoc: FileText,
  pdf: FileText,

  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  avif: FileImage,
  bmp: FileImage,
  ico: FileImage,
  svg: FileImage,

  mp3: FileAudio,
  wav: FileAudio,
  ogg: FileAudio,
  flac: FileAudio,
  m4a: FileAudio,

  mp4: FileVideo,
  mov: FileVideo,
  webm: FileVideo,
  mkv: FileVideo,
  avi: FileVideo,

  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  tgz: FileArchive,
  bz2: FileArchive,
  xz: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,

  csv: FileSpreadsheet,
  tsv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,

  sql: Database,
  db: Database,
  sqlite: Database,

  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  fish: FileTerminal,
  ps1: FileTerminal,
  bat: FileTerminal,
  cmd: FileTerminal,

  lock: FileLock,

  woff: FileType,
  woff2: FileType,
  ttf: FileType,
  otf: FileType,
  eot: FileType,
};

/**
 * Files whose name is their type.
 *
 * Some have no extension to read at all, and some have one that lies —
 * `package-lock.json` is a lockfile you never open, not the JSON you edit, and
 * a change list is easier to skim when it says so. Matched case-insensitively,
 * so `Dockerfile` and `dockerfile` are the same file to us.
 */
const BY_NAME: Record<string, LucideIcon> = {
  dockerfile: FileTerminal,
  makefile: FileTerminal,
  procfile: FileTerminal,
  "package-lock.json": FileLock,
  "pnpm-lock.yaml": FileLock,
  "bun.lockb": FileLock,
  ".gitignore": FileCog,
  ".gitattributes": FileCog,
  ".gitmodules": FileCog,
  ".dockerignore": FileCog,
  ".npmrc": FileCog,
  ".nvmrc": FileCog,
  ".editorconfig": FileCog,
  ".prettierrc": FileCog,
  license: FileText,
  notice: FileText,
};

/** The last segment of a path, whichever separator got it there. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The icon for a path.
 *
 * Exported alongside the component so what it decides can be checked without
 * rendering anything — the mapping is the part with an answer, and the drawing
 * is the part that has none.
 */
export function iconFor(path: string): LucideIcon {
  const name = baseName(path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;

  // A leading dot names the file rather than starting an extension, and what
  // comes after it can qualify the name without changing what the file is:
  // `.env.local` is an env file and `.env.production` is another. So a dotfile
  // is read from the segment just after its dot, and everything else from its
  // last one, which is where an ordinary extension lives.
  if (name.startsWith(".")) {
    const head = name.slice(1).split(".")[0] ?? "";
    return BY_NAME[`.${head}`] ?? BY_EXTENSION[head] ?? FileIcon;
  }
  const dot = name.lastIndexOf(".");
  if (dot === -1) return FileIcon;
  return BY_EXTENSION[name.slice(dot + 1)] ?? FileIcon;
}

/**
 * A path split where it can be cut.
 *
 * The row is narrower than most paths, and something has to go. The name is
 * what identifies the file and the directories are what merely place it, so
 * the directories are the half that shrinks — `lead` takes the ellipsis, `tail`
 * is pinned and always readable, extension and all.
 *
 * The separator travels with the tail so the cut still reads as a path:
 * `web/…/GitSection.tsx` rather than `web/…GitSection.tsx`.
 */
export function splitPath(path: string): { lead: string; tail: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut === -1) return { lead: "", tail: path };
  return { lead: path.slice(0, cut), tail: path.slice(cut) };
}

/** The icon for a path, at the size the change list draws it. */
export function FileGlyph({ path, size = 13 }: { path: string; size?: number }) {
  const Icon = iconFor(path);
  return <Icon size={size} />;
}
