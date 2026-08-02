import { ChevronDown, ChevronRight, File as FileIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ContentSearchResponse, FileSearchResponse, TreeEntry } from "sylva-shared";
import { api } from "../lib/api";
import { useFileContent, useTree } from "../lib/queries";

/**
 * Browse the worktree, not just what changed in it. Directories load on
 * expansion rather than up front — a repository is far too big to walk eagerly,
 * and you only ever look at a few branches of it.
 */
export function FileTree({ worktreeId }: { worktreeId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Two different questions: "where is the file called X" and "where is X written". */
  const [mode, setMode] = useState<"name" | "text">("name");
  const [highlight, setHighlight] = useState<number | null>(null);
  const results = useFileSearch(worktreeId, mode === "name" ? query : "");
  const content = useContentSearch(worktreeId, mode === "text" ? query : "");

  return (
    <div className="tree-panel">
      <div className="tree-side">
        <div className="tree-search">
          <div className="seg tree-search-mode" role="group" aria-label="Search by">
            <button
              className={mode === "name" ? "seg-on" : ""}
              onClick={() => setMode("name")}
              data-tip="Find files by their name or path"
            >
              Name
            </button>
            <button
              className={mode === "text" ? "seg-on" : ""}
              onClick={() => setMode("text")}
              data-tip="Find files by what's written inside them"
            >
              Text
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "name" ? "Find a file…" : "Find text in files…"}
            aria-label={mode === "name" ? "Find a file by name" : "Find text inside files"}
            data-tip={
              mode === "name"
                ? "Search this worktree by file name or path fragment"
                : "Search the contents of every file in this worktree"
            }
          />
          {query && (
            <button
              className="ghost"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              data-tip="Clear the search and go back to the folder tree"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Searching replaces the tree rather than filtering it in place, so
            clearing the box returns every folder you had expanded. */}
        {query.trim() ? (
          mode === "name" ? (
            <SearchResults state={results} selected={selected} onSelect={setSelected} />
          ) : (
            <ContentResults
              state={content}
              selected={selected}
              onSelect={(path, line) => {
                setSelected(path);
                setHighlight(line);
              }}
            />
          )
        ) : (
          <Directory worktreeId={worktreeId} path="" selected={selected} onSelect={setSelected} />
        )}
      </div>
      <div className="tree-view">
        {selected ? (
          <FilePreview worktreeId={worktreeId} path={selected} highlight={highlight} />
        ) : (
          <div className="tree-empty">Pick a file to read it.</div>
        )}
      </div>
    </div>
  );
}

interface SearchState {
  loading: boolean;
  data: FileSearchResponse | null;
  failed: boolean;
}

/**
 * Search as you type, debounced so a fast typist doesn't set a filesystem walk
 * going for every keystroke. The previous results stay on screen while the next
 * ones are fetched — blanking the list mid-typing makes it feel broken.
 */
function useFileSearch(worktreeId: string, query: string): SearchState {
  const [state, setState] = useState<SearchState>({ loading: false, data: null, failed: false });

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ loading: false, data: null, failed: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, failed: false }));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchFiles(worktreeId, trimmed)
        .then((data) => {
          // A slow response for an old query must not overwrite a newer one.
          if (!cancelled) setState({ loading: false, data, failed: false });
        })
        .catch(() => {
          if (!cancelled) setState({ loading: false, data: null, failed: true });
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [worktreeId, query]);

  return state;
}

function SearchResults({
  state,
  selected,
  onSelect,
}: {
  state: SearchState;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  if (state.failed) return <div className="tree-note">Couldn't search this worktree.</div>;
  if (!state.data) return <div className="tree-note">Searching…</div>;
  if (state.data.results.length === 0) {
    return (
      <div className="tree-note">
        {state.loading ? "Searching…" : `Nothing matches “${state.data.query}”.`}
      </div>
    );
  }

  return (
    <>
      <ul className="tree-list">
        {state.data.results.map((result) => (
          <li key={result.path} className="tree-node">
            <button
              className={`tree-row ${selected === result.path ? "tree-row-on" : ""}`}
              onClick={() => onSelect(result.path)}
              data-tip={result.path}
            >
              <span className="tree-glyph">
                <FileIcon size={12} />
              </span>
              <span className="tree-name">{result.name}</span>
              <span className="tree-result-path">{dirOf(result.path)}</span>
            </button>
          </li>
        ))}
      </ul>
      {state.data.truncated && (
        <div className="tree-note">Showing the closest matches only.</div>
      )}
    </>
  );
}

interface ContentState {
  loading: boolean;
  data: ContentSearchResponse | null;
  failed: boolean;
}

/**
 * The same debounce as name search, but a longer one: this reads every file in
 * the worktree rather than its directory entries, so a keystroke costs more.
 */
function useContentSearch(worktreeId: string, query: string): ContentState {
  const [state, setState] = useState<ContentState>({ loading: false, data: null, failed: false });

  useEffect(() => {
    const trimmed = query.trim();
    // One or two characters matches most of the repository and helps nobody.
    if (trimmed.length < 2) {
      setState({ loading: false, data: null, failed: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, failed: false }));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchContent(worktreeId, trimmed)
        .then((data) => {
          if (!cancelled) setState({ loading: false, data, failed: false });
        })
        .catch(() => {
          if (!cancelled) setState({ loading: false, data: null, failed: true });
        });
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [worktreeId, query]);

  return state;
}

/** Matches grouped by file, because ten hits in one file is one answer. */
function ContentResults({
  state,
  selected,
  onSelect,
}: {
  state: ContentState;
  selected: string | null;
  onSelect: (path: string, line: number) => void;
}) {
  if (state.failed) return <div className="tree-note">Couldn't search this worktree.</div>;
  if (!state.data) {
    return <div className="tree-note">{state.loading ? "Searching…" : "Type at least two characters."}</div>;
  }
  if (state.data.matches.length === 0) {
    return (
      <div className="tree-note">
        {state.loading ? "Searching…" : `Nothing contains “${state.data.query}”.`}
      </div>
    );
  }

  const byFile = new Map<string, typeof state.data.matches>();
  for (const match of state.data.matches) {
    byFile.set(match.path, [...(byFile.get(match.path) ?? []), match]);
  }

  return (
    <>
      <div className="tree-note">
        {state.data.matches.length} match{state.data.matches.length === 1 ? "" : "es"} in{" "}
        {state.data.fileCount} file{state.data.fileCount === 1 ? "" : "s"}
      </div>
      <ul className="tree-list">
        {[...byFile].map(([path, matches]) => (
          <li key={path} className="hit-group">
            <div className="hit-file" data-tip={path}>
              {path}
            </div>
            {matches.map((match) => (
              <button
                key={`${path}:${match.line}`}
                className={`hit-row ${selected === path ? "hit-row-on" : ""}`}
                onClick={() => onSelect(path, match.line)}
                data-tip={`Open ${path} at line ${match.line}`}
              >
                <span className="hit-line">{match.line}</span>
                <span className="hit-text">{match.text}</span>
              </button>
            ))}
          </li>
        ))}
      </ul>
      {state.data.truncated && <div className="tree-note">Showing the first matches only.</div>}
    </>
  );
}

/** The folder a result sits in, shown beside its name to tell duplicates apart. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function Directory({
  worktreeId,
  path,
  selected,
  onSelect,
  depth = 0,
}: {
  worktreeId: string;
  path: string;
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const tree = useTree(worktreeId, path);

  if (tree.isLoading) return <div className="tree-note">Reading…</div>;
  if (tree.isError) return <div className="tree-note">Couldn't read this folder.</div>;
  if (!tree.data || tree.data.entries.length === 0) {
    return <div className="tree-note">Empty.</div>;
  }

  return (
    <ul className="tree-list">
      {tree.data.entries.map((entry) => (
        <Node
          key={entry.path}
          worktreeId={worktreeId}
          entry={entry}
          selected={selected}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function Node({
  worktreeId,
  entry,
  selected,
  onSelect,
  depth,
}: {
  worktreeId: string;
  entry: TreeEntry;
  selected: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  const isDir = entry.kind === "dir";
  const isSelected = selected === entry.path;

  return (
    <li className="tree-node">
      <button
        className={`tree-row ${isSelected ? "tree-row-on" : ""}`}
        style={{ paddingLeft: `calc(${depth} * var(--pad-3) + var(--pad-2))` }}
        onClick={() => (isDir ? setOpen((o) => !o) : onSelect(entry.path))}
        data-tip={isDir ? entry.path : `${entry.path}${entry.size ? ` · ${bytes(entry.size)}` : ""}`}
      >
        <span className={`tree-glyph ${isDir ? "tree-glyph-dir" : ""}`}>
          {isDir ? (
            open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <FileIcon size={12} />
          )}
        </span>
        <span className="tree-name">{entry.name}</span>
      </button>
      {isDir && open && (
        <Directory
          worktreeId={worktreeId}
          path={entry.path}
          selected={selected}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

function FilePreview({
  worktreeId,
  path,
  highlight,
}: {
  worktreeId: string;
  path: string;
  highlight?: number | null;
}) {
  const file = useFileContent(worktreeId, path);
  const lineRef = useRef<HTMLSpanElement>(null);

  // Arriving from a text match should land on the line that matched, not at
  // the top of a two-thousand-line file.
  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: "center" });
  }, [path, highlight, file.data]);

  if (file.isLoading) return <div className="tree-note">Loading {path}…</div>;
  if (file.isError || !file.data) return <div className="tree-note">Couldn't read {path}.</div>;
  if (file.data.binary) {
    return (
      <div className="tree-note">
        {path} is a binary file ({bytes(file.data.size)}).
      </div>
    );
  }

  const lines = file.data.content.split("\n");

  return (
    <div className="tree-file">
      <header className="tree-file-head">
        <code>{path}</code>
        <span className="tree-file-size">{bytes(file.data.size)}</span>
      </header>
      <pre className="tree-file-body">
        {lines.map((text, i) => {
          const number = i + 1;
          const hit = highlight === number;
          return (
            <span
              key={number}
              {...(hit ? { ref: lineRef } : {})}
              className={`tree-file-line ${hit ? "tree-file-line-hit" : ""}`}
            >
              {text || " "}
              {"\n"}
            </span>
          );
        })}
      </pre>
      {file.data.truncated && (
        <p className="tree-note">Cut off at 256 KB — open it in your editor to see the rest.</p>
      )}
    </div>
  );
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
