import { useState } from "react";
import type { TreeEntry } from "sylva-shared";
import { useFileContent, useTree } from "../lib/queries";

/**
 * Browse the worktree, not just what changed in it. Directories load on
 * expansion rather than up front — a repository is far too big to walk eagerly,
 * and you only ever look at a few branches of it.
 */
export function FileTree({ worktreeId }: { worktreeId: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="tree-panel">
      <div className="tree-side">
        <Directory worktreeId={worktreeId} path="" selected={selected} onSelect={setSelected} />
      </div>
      <div className="tree-view">
        {selected ? (
          <FilePreview worktreeId={worktreeId} path={selected} />
        ) : (
          <div className="tree-empty">Pick a file to read it.</div>
        )}
      </div>
    </div>
  );
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
          {isDir ? (open ? "▾" : "▸") : "·"}
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

function FilePreview({ worktreeId, path }: { worktreeId: string; path: string }) {
  const file = useFileContent(worktreeId, path);

  if (file.isLoading) return <div className="tree-note">Loading {path}…</div>;
  if (file.isError || !file.data) return <div className="tree-note">Couldn't read {path}.</div>;
  if (file.data.binary) {
    return (
      <div className="tree-note">
        {path} is a binary file ({bytes(file.data.size)}).
      </div>
    );
  }

  return (
    <div className="tree-file">
      <header className="tree-file-head">
        <code>{path}</code>
        <span className="tree-file-size">{bytes(file.data.size)}</span>
      </header>
      <pre className="tree-file-body">{file.data.content}</pre>
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
