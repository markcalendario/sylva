import { useMemo, useState } from "react";
import type { FileChangeKind } from "sylva-shared";
import { NO_EVENTS, useSylva, type DiffSelection } from "../state/store";
import { FileTree } from "./FileTree";

const CHANGE_GLYPH: Record<FileChangeKind, { glyph: string; cls: string; tip: string }> = {
  added: { glyph: "+", cls: "chg-add", tip: "New file, staged for commit" },
  untracked: { glyph: "+", cls: "chg-add", tip: "New file git isn't tracking yet" },
  modified: { glyph: "~", cls: "chg-mod", tip: "This file was edited" },
  renamed: { glyph: "→", cls: "chg-mod", tip: "This file was renamed" },
  deleted: { glyph: "−", cls: "chg-del", tip: "This file was deleted" },
};

/** One changed file, as git sees it. */
interface ChangeRow {
  worktreeId: string;
  path: string;
  kind: FileChangeKind;
  /** Which side of the index this row is about — it decides which diff opens. */
  staged: boolean;
  renamedFrom?: string;
  /** When the file was last touched, when the feed happens to know. */
  at?: string;
}

/**
 * What is changing, and what is here — across every worktree the dryad tends.
 *
 * The change list is git's answer, not the filesystem's. The watcher sees every
 * write under the worktree, which means build output, editor swap files and
 * anything else `.gitignore` exists to keep quiet; asking git instead means the
 * list is exactly what you would commit, and nothing else. The watcher still
 * drives the feed's timestamps, so rows stay ordered by what moved last.
 */
export function FilesPanel({
  members,
  onOpenDiff,
}: {
  members: string[];
  onOpenDiff: (selection: DiffSelection) => void;
}) {
  const statuses = useSylva((s) => s.statuses);
  const feeds = useSylva((s) => s.fileFeed);
  const index = useSylva((s) => s.worktreeIndex);
  // Two different questions: "what changed" and "what's in here". Git can't
  // answer the second, and a tree can't answer the first.
  const [mode, setMode] = useState<"changes" | "browse">("changes");
  const shared = members.length > 1;

  const memberKey = members.join(",");
  const rows = useMemo(() => {
    const ids = memberKey ? memberKey.split(",") : [];
    const out: ChangeRow[] = [];

    for (const worktreeId of ids) {
      const status = statuses[worktreeId];
      if (!status) continue;

      // The feed only ever says when — git says what. A path the watcher never
      // saw move still belongs in the list; it just sorts by name instead.
      const seenAt = new Map<string, string>();
      for (const event of feeds[worktreeId] ?? NO_EVENTS) {
        if (!seenAt.has(event.path)) seenAt.set(event.path, event.at);
      }

      const push = (
        entries: typeof status.staged,
        staged: boolean,
      ) => {
        for (const entry of entries) {
          const at = seenAt.get(entry.path);
          out.push({
            worktreeId,
            path: entry.path,
            kind: entry.kind,
            staged,
            ...(entry.renamedFrom ? { renamedFrom: entry.renamedFrom } : {}),
            ...(at ? { at } : {}),
          });
        }
      };

      // A partially staged file legitimately appears twice: the two rows open
      // two different diffs, and collapsing them would hide half the change.
      push(status.staged, true);
      push(status.unstaged, false);
      push(status.untracked, false);
    }

    return out.sort((a, b) => {
      if (a.at && b.at) return b.at.localeCompare(a.at);
      // Anything the watcher has seen is more interesting than anything it
      // hasn't, so dated rows lead and the rest fall back to alphabetical.
      if (a.at) return -1;
      if (b.at) return 1;
      return a.path.localeCompare(b.path);
    });
  }, [memberKey, statuses, feeds]);

  const switcher = (
    <div className="seg files-seg" role="group" aria-label="Files view">
      <button
        className={mode === "changes" ? "seg-on" : ""}
        onClick={() => setMode("changes")}
        data-tip="Files git reports as changed, newest first"
      >
        Changes
      </button>
      <button
        className={mode === "browse" ? "seg-on" : ""}
        onClick={() => setMode("browse")}
        data-tip={
          shared ? "Browse every worktree this dryad tends" : "Browse everything in this worktree"
        }
      >
        Browse
      </button>
    </div>
  );

  if (mode === "browse") {
    return (
      <div className="files-panel">
        {switcher}
        <FileTree members={members} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="files-panel">
        {switcher}
        <div className="files-empty">
          Nothing has changed here yet. Edits git would report — by dryad, editor, or terminal —
          appear in this list, newest first.
        </div>
      </div>
    );
  }

  return (
    <div className="files-panel">
      {switcher}
      {rows.map((row) => {
        const meta = CHANGE_GLYPH[row.kind];
        return (
          <button
            key={`${row.worktreeId}-${row.staged ? "s" : "u"}-${row.path}`}
            className="file-row"
            onClick={() =>
              onOpenDiff({ worktreeId: row.worktreeId, path: row.path, staged: row.staged })
            }
            data-tip="Open this file's diff in the Git tab"
          >
            <span className={`chg ${meta.cls}`} data-tip={meta.tip}>
              {meta.glyph}
            </span>
            {/* Which worktree, only when there is more than one to confuse. */}
            {shared && (
              <span
                className="file-where"
                data-tip={index[row.worktreeId]?.repoName ?? row.worktreeId}
              >
                {index[row.worktreeId]?.branch ?? row.worktreeId.slice(0, 7)}
              </span>
            )}
            <span className="file-path">
              {row.renamedFrom ? `${row.renamedFrom} → ${row.path}` : row.path}
            </span>
            {row.staged && (
              <span className="file-staged" data-tip="Already staged for the next commit">
                staged
              </span>
            )}
            {row.at && (
              <span className="file-time" data-tip="When Sylva last saw this file move">
                {new Date(row.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
