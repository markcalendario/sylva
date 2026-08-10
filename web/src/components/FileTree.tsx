import { ChevronDown, ChevronRight, File as FileIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ContentSearchResponse, FileSearchResponse, TreeEntry } from "sylva-shared";
import { api } from "../lib/api";
import { useSylva } from "../state/store";
import { useTree } from "../lib/queries";

/** Where a click in the rail wants to go: a file, sometimes at a line. */
export interface OpenRequest {
  worktreeId: string;
  path: string;
  line?: number;
}

/**
 * Browse the worktree, not just what changed in it. Directories load on
 * expansion rather than up front — a repository is far too big to walk eagerly,
 * and you only ever look at a few branches of it.
 *
 * This is the rail alone. Reading a file happens in the editor beside it, which
 * holds its own tabs — so a click here is a request to open something, not a
 * change to what is displayed.
 */
export function FileTree({
  members,
  onOpen,
  activePath,
  activeWorktreeId,
  autoFocus = false,
}: {
  members: string[];
  onOpen: (request: OpenRequest) => void;
  /** Path of the file the editor is showing, so the rail can mark it. */
  activePath: string | null;
  activeWorktreeId: string | null;
  /**
   * Take the caret on arrival. Opening the Files tab is nearly always a
   * question — "where is X" — and typing it should not cost a click first.
   */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  /** Two different questions: "where is the file called X" and "where is X written". */
  const [mode, setMode] = useState<"name" | "text">("name");
  const searchRef = useRef<HTMLInputElement>(null);
  const shared = members.length > 1;
  const results = useFileSearch(members, mode === "name" ? query : "");
  const content = useContentSearch(members, mode === "text" ? query : "");

  const selected =
    activeWorktreeId && activePath ? { worktreeId: activeWorktreeId, path: activePath } : null;

  // On arrival only. Switching between Name and Text keeps whatever you were
  // doing, and the second pane must not steal the caret from the first.
  useEffect(() => {
    if (autoFocus) searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
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
          ref={searchRef}
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
          <SearchResults
            groups={results}
            shared={shared}
            selected={selected}
            onSelect={(worktreeId, path) => onOpen({ worktreeId, path })}
          />
        ) : (
          <ContentResults
            groups={content}
            shared={shared}
            selected={selected}
            onSelect={(worktreeId, path, line) => onOpen({ worktreeId, path, line })}
          />
        )
      ) : shared ? (
        /* A root of worktrees. With one member this level is skipped
           entirely, so an ordinary worktree gains no extra click. */
        members.map((id) => (
          <WorktreeBranch
            key={id}
            worktreeId={id}
            selected={selected}
            onSelect={(request) => onOpen(request)}
          />
        ))
      ) : (
        <Directory
          worktreeId={members[0] ?? ""}
          path=""
          selected={selected?.path ?? null}
          onSelect={(path) => onOpen({ worktreeId: members[0] ?? "", path })}
        />
      )}
    </div>
  );
}

/** One worktree's share of a search. Grouped, never merged into one list. */
interface SearchGroup<T> {
  worktreeId: string;
  data: T | null;
  failed: boolean;
}

interface SearchState<T> {
  loading: boolean;
  groups: SearchGroup<T>[];
}

/**
 * Search as you type, debounced so a fast typist doesn't set a filesystem walk
 * going for every keystroke. The previous results stay on screen while the next
 * ones are fetched — blanking the list mid-typing makes it feel broken.
 *
 * Fanned out across members and kept grouped: a cap reached in one worktree
 * says nothing about the others, and merging the lists would lose that.
 */
function useSearchAcross<T>(
  members: string[],
  query: string,
  minLength: number,
  delay: number,
  fetch: (worktreeId: string, q: string) => Promise<T>,
): SearchState<T> {
  const memberKey = members.join(",");
  const [state, setState] = useState<SearchState<T>>({ loading: false, groups: [] });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      setState({ loading: false, groups: [] });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    let cancelled = false;
    const ids = memberKey ? memberKey.split(",") : [];
    const timer = window.setTimeout(() => {
      void Promise.all(
        ids.map((id) =>
          fetch(id, trimmed).then(
            (data): SearchGroup<T> => ({ worktreeId: id, data, failed: false }),
            (): SearchGroup<T> => ({ worktreeId: id, data: null, failed: true }),
          ),
        ),
      ).then((groups) => {
        // A slow response for an old query must not overwrite a newer one.
        if (!cancelled) setState({ loading: false, groups });
      });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberKey, query, minLength, delay]);

  return state;
}

function useFileSearch(members: string[], query: string): SearchState<FileSearchResponse> {
  return useSearchAcross(members, query, 1, 150, (id, q) => api.searchFiles(id, q));
}

/**
 * The same shape, with a longer debounce and a two-character floor: this reads
 * every file in the worktree rather than its directory entries, so a keystroke
 * costs more, and one character matches most of a repository.
 */
function useContentSearch(members: string[], query: string): SearchState<ContentSearchResponse> {
  return useSearchAcross(members, query, 2, 260, (id, q) => api.searchContent(id, q));
}

/** A worktree as a top level in the tree, expanded by default. */
function WorktreeBranch({
  worktreeId,
  selected,
  onSelect,
}: {
  worktreeId: string;
  selected: { worktreeId: string; path: string } | null;
  onSelect: (selection: { worktreeId: string; path: string }) => void;
}) {
  const [open, setOpen] = useState(true);
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);
  const status = useSylva((s) => s.statuses[worktreeId]);

  return (
    <div className="tree-worktree">
      <button
        className="tree-worktree-head"
        onClick={() => setOpen((o) => !o)}
        data-tip={place?.repoName ?? worktreeId}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="tree-worktree-repo">{place?.repoName ?? "worktree"}</span>
        <code className="tree-worktree-branch">
          {status?.branch ?? place?.branch ?? worktreeId.slice(0, 7)}
        </code>
      </button>
      {open && (
        <Directory
          worktreeId={worktreeId}
          path=""
          selected={selected?.worktreeId === worktreeId ? selected.path : null}
          onSelect={(path) => onSelect({ worktreeId, path })}
        />
      )}
    </div>
  );
}

function SearchResults({
  groups,
  shared,
  selected,
  onSelect,
}: {
  groups: SearchState<FileSearchResponse>;
  shared: boolean;
  selected: { worktreeId: string; path: string } | null;
  onSelect: (worktreeId: string, path: string) => void;
}) {
  const total = groups.groups.reduce((n, g) => n + (g.data?.results.length ?? 0), 0);
  if (groups.groups.length === 0) return <div className="tree-note">Searching…</div>;
  if (total === 0) {
    return <div className="tree-note">{groups.loading ? "Searching…" : "Nothing matches."}</div>;
  }

  return (
    <>
      {groups.groups.map((group) => {
        if (group.failed) {
          return (
            <div key={group.worktreeId} className="tree-note">
              Couldn't search this worktree.
            </div>
          );
        }
        if (!group.data || group.data.results.length === 0) return null;
        return (
          <div key={group.worktreeId}>
            {shared && (
              <GroupLabel worktreeId={group.worktreeId} count={group.data.results.length} />
            )}
            <ul className="tree-list">
              {group.data.results.map((result) => (
                <li key={result.path} className="tree-node">
                  <button
                    className={`tree-row ${
                      selected?.worktreeId === group.worktreeId && selected.path === result.path
                        ? "tree-row-on"
                        : ""
                    }`}
                    onClick={() => onSelect(group.worktreeId, result.path)}
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
            {/* Per group: a cap reached here says nothing about the other worktree. */}
            {group.data.truncated && (
              <div className="tree-note">Showing the closest matches only.</div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Which worktree a run of results came from. */
function GroupLabel({ worktreeId, count }: { worktreeId: string; count: number }) {
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);
  const status = useSylva((s) => s.statuses[worktreeId]);
  return (
    <div className="tree-group-label">
      <span className="tree-worktree-repo">{place?.repoName ?? "worktree"}</span>
      <code className="tree-worktree-branch">{status?.branch ?? place?.branch ?? ""}</code>
      <span className="tree-group-count">{count}</span>
    </div>
  );
}

/** Matches grouped by worktree, then by file: ten hits in one file is one answer. */
function ContentResults({
  groups,
  shared,
  selected,
  onSelect,
}: {
  groups: SearchState<ContentSearchResponse>;
  shared: boolean;
  selected: { worktreeId: string; path: string } | null;
  onSelect: (worktreeId: string, path: string, line: number) => void;
}) {
  const total = groups.groups.reduce((n, g) => n + (g.data?.matches.length ?? 0), 0);
  if (groups.groups.length === 0) {
    return (
      <div className="tree-note">
        {groups.loading ? "Searching…" : "Type at least two characters."}
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="tree-note">{groups.loading ? "Searching…" : "Nothing contains that."}</div>
    );
  }

  return (
    <>
      {groups.groups.map((group) => {
        if (!group.data || group.data.matches.length === 0) return null;
        const byFile = new Map<string, typeof group.data.matches>();
        for (const match of group.data.matches) {
          byFile.set(match.path, [...(byFile.get(match.path) ?? []), match]);
        }
        return (
          <div key={group.worktreeId}>
            {shared && (
              <GroupLabel worktreeId={group.worktreeId} count={group.data.matches.length} />
            )}
            <ul className="tree-list">
              {[...byFile].map(([path, matches]) => (
                <li key={path} className="hit-group">
                  <div className="hit-file" data-tip={path}>
                    {path}
                  </div>
                  {matches.map((match) => (
                    <button
                      key={`${path}:${match.line}`}
                      className={`hit-row ${
                        selected?.worktreeId === group.worktreeId && selected.path === path
                          ? "hit-row-on"
                          : ""
                      }`}
                      onClick={() => onSelect(group.worktreeId, path, match.line)}
                      data-tip={`Open ${path} at line ${match.line}`}
                    >
                      <span className="hit-line">{match.line}</span>
                      <span className="hit-text">{match.text}</span>
                    </button>
                  ))}
                </li>
              ))}
            </ul>
            {group.data.truncated && (
              <div className="tree-note">Showing the first matches only.</div>
            )}
          </div>
        );
      })}
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
        <TreeNode
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

/** Named for the tree, not the DOM: plain `Node` shadows the global one. */
function TreeNode({
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

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
