import { useMemo } from "react";
import { GitCompare } from "lucide-react";
import type { FileChangeKind } from "sylva-shared";
import { useWords } from "../lib/theme";
import { fileKey, NO_EVENTS, useSylva, type DiffSelection, type Pane } from "../state/store";
import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";

const CHANGE_GLYPH: Record<FileChangeKind, { glyph: string; cls: string; tip: string }> = {
  added: { glyph: "+", cls: "chg-add", tip: "New file, staged for commit" },
  untracked: {
    glyph: "+",
    cls: "chg-add",
    tip: "New file git isn't tracking yet",
  },
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
 * What is changing, what is here, and whatever you are reading — across every
 * worktree the agent tends.
 *
 * The rail on the left answers two questions the other can't: git says what
 * changed, a tree says what exists. Both of them only ever *open* something;
 * the editor beside them is where files are actually read, and it keeps its own
 * tabs so following a change across four files doesn't cost you your place in
 * the first three.
 *
 * The change list is git's answer, not the filesystem's. The watcher sees every
 * write under the worktree, which means build output, editor swap files and
 * anything else `.gitignore` exists to keep quiet; asking git instead means the
 * list is exactly what you would commit, and nothing else. The watcher still
 * drives the feed's timestamps, so rows stay ordered by what moved last.
 */
export function FilesPanel({
  pane,
  members,
  onOpenDiff,
}: {
  pane: Pane;
  members: string[];
  onOpenDiff: (selection: DiffSelection) => void;
}) {
  const words = useWords();
  const statuses = useSylva((s) => s.statuses);
  const feeds = useSylva((s) => s.fileFeed);
  const index = useSylva((s) => s.worktreeIndex);
  const store = useSylva.getState();
  const mode = pane.filesMode;
  const shared = members.length > 1;

  const active = pane.files.find((f) => fileKey(f) === pane.activeFile) ?? null;

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

      const push = (entries: typeof status.staged, staged: boolean) => {
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
        className={mode === "browse" ? "seg-on" : ""}
        onClick={() => store.setFilesMode("browse")}
        data-tip={
          shared
            ? `Browse every worktree this ${words.agent} tends`
            : "Browse everything in this worktree"
        }
      >
        Browse
      </button>
      <button
        className={mode === "changes" ? "seg-on" : ""}
        onClick={() => store.setFilesMode("changes")}
        data-tip="Files git reports as changed, newest first"
      >
        Changes
        {rows.length > 0 && <span className="seg-count">{rows.length}</span>}
      </button>
    </div>
  );

  return (
    <div className="files-panel">
      <div className="files-rail">
        {switcher}
        {mode === "browse" ? (
          <FileTree
            members={members}
            activePath={active?.path ?? null}
            activeWorktreeId={active?.worktreeId ?? null}
            autoFocus
            onOpen={(request) => store.openFile(request)}
          />
        ) : (
          <ChangeList
            rows={rows}
            shared={shared}
            index={index}
            activeKey={pane.activeFile}
            onOpenFile={(row) => store.openFile({ worktreeId: row.worktreeId, path: row.path })}
            onOpenDiff={onOpenDiff}
          />
        )}
      </div>
      <FileEditor pane={pane} />
    </div>
  );
}

/**
 * What git says has changed, newest first.
 *
 * A row opens the *file*, not its diff — reading and editing is what the Files
 * tab is for, and sending you to the Git tab to look at a path you clicked here
 * was a detour every time. The patch is still one click away, on its own
 * control, for when comparing is genuinely the question.
 */
function ChangeList({
  rows,
  shared,
  index,
  activeKey,
  onOpenFile,
  onOpenDiff,
}: {
  rows: ChangeRow[];
  shared: boolean;
  index: Record<string, { repoName: string; branch: string } | undefined>;
  activeKey: string | null;
  onOpenFile: (row: ChangeRow) => void;
  onOpenDiff: (selection: DiffSelection) => void;
}) {
  const words = useWords();
  if (rows.length === 0) {
    return (
      <div className="files-empty">
        Nothing has changed here yet. Edits git would report — by {words.agent}, editor, or terminal
        — appear in this list, newest first.
      </div>
    );
  }

  return (
    <div className="files-list">
      {rows.map((row) => {
        const meta = CHANGE_GLYPH[row.kind];
        const on = activeKey === fileKey(row);
        return (
          <div
            key={`${row.worktreeId}-${row.staged ? "s" : "u"}-${row.path}`}
            className={`file-row ${on ? "file-row-on" : ""}`}
          >
            <button
              className="file-row-open"
              onClick={() => onOpenFile(row)}
              data-tip="Open this file in the editor"
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
            <button
              className="ghost file-row-diff"
              onClick={() =>
                onOpenDiff({
                  worktreeId: row.worktreeId,
                  path: row.path,
                  staged: row.staged,
                })
              }
              aria-label={`Show the diff for ${row.path}`}
              data-tip="Show this file's diff in the Git tab"
            >
              <GitCompare size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
