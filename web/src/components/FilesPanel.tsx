import { useMemo, useState } from "react";
import { NO_EVENTS, useSylva, type DiffSelection } from "../state/store";
import { FileTree } from "./FileTree";

const CHANGE_GLYPH: Record<string, { glyph: string; cls: string; tip: string }> = {
  added: { glyph: "+", cls: "chg-add", tip: "This file was created" },
  changed: { glyph: "~", cls: "chg-mod", tip: "This file was edited" },
  deleted: { glyph: "−", cls: "chg-del", tip: "This file was deleted" },
};

/**
 * What is changing, and what is here — across every worktree the dryad tends.
 *
 * The feed is merged rather than switched between: "what just changed" during a
 * migration is one question, and answering it by asking you to flip between two
 * worktrees is answering a different one.
 */
export function FilesPanel({
  members,
  onOpenDiff,
}: {
  members: string[];
  onOpenDiff: (selection: DiffSelection) => void;
}) {
  const feeds = useSylva((s) => s.fileFeed);
  const index = useSylva((s) => s.worktreeIndex);
  // Two different questions: "what just changed" and "what's in here". The feed
  // can't answer the second, and a tree can't answer the first.
  const [mode, setMode] = useState<"changes" | "browse">("changes");
  const shared = members.length > 1;

  const memberKey = members.join(",");
  const feed = useMemo(() => {
    const ids = memberKey ? memberKey.split(",") : [];
    return ids
      .flatMap((id) => (feeds[id] ?? NO_EVENTS).map((event) => ({ event, worktreeId: id })))
      .sort((a, b) => b.event.at.localeCompare(a.event.at));
  }, [memberKey, feeds]);

  const switcher = (
    <div className="seg files-seg" role="group" aria-label="Files view">
      <button
        className={mode === "changes" ? "seg-on" : ""}
        onClick={() => setMode("changes")}
        data-tip="Files that changed, newest first"
      >
        Changes
      </button>
      <button
        className={mode === "browse" ? "seg-on" : ""}
        onClick={() => setMode("browse")}
        data-tip={shared ? "Browse every worktree this dryad tends" : "Browse everything in this worktree"}
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

  if (feed.length === 0) {
    return (
      <div className="files-panel">
        {switcher}
        <div className="files-empty">
          Nothing has stirred yet. When files change here — by dryad, editor, or terminal — they
          appear in this feed, newest first.
        </div>
      </div>
    );
  }

  return (
    <div className="files-panel">
      {switcher}
      {feed.map(({ event, worktreeId }, i) => {
        const meta = CHANGE_GLYPH[event.change] ?? CHANGE_GLYPH.changed;
        return (
          <button
            key={`${worktreeId}-${event.path}-${event.at}-${i}`}
            className="file-row"
            onClick={() => onOpenDiff({ worktreeId, path: event.path, staged: false })}
            data-tip="Open this file's diff in the Git tab"
          >
            <span className={`chg ${meta.cls}`} data-tip={meta.tip}>
              {meta.glyph}
            </span>
            {/* Which worktree, only when there is more than one to confuse. */}
            {shared && (
              <span className="file-where" data-tip={index[worktreeId]?.repoName ?? worktreeId}>
                {index[worktreeId]?.branch ?? worktreeId.slice(0, 7)}
              </span>
            )}
            <span className="file-path">{event.path}</span>
            <span className="file-time" data-tip="When Sylva saw the change">
              {new Date(event.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
