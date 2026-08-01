import { NO_EVENTS, useSylva } from "../state/store";

const CHANGE_GLYPH: Record<string, { glyph: string; cls: string }> = {
  added: { glyph: "+", cls: "chg-add" },
  changed: { glyph: "~", cls: "chg-mod" },
  deleted: { glyph: "−", cls: "chg-del" },
};

export function FilesPanel({
  worktreeId,
  onOpenDiff,
}: {
  worktreeId: string;
  onOpenDiff: (path: string) => void;
}) {
  const feed = useSylva((s) => s.fileFeed[worktreeId] ?? NO_EVENTS);

  if (feed.length === 0) {
    return (
      <div className="files-empty">
        Nothing has stirred yet. When files change here — by dryad, editor, or terminal — they
        appear in this feed, newest first.
      </div>
    );
  }

  return (
    <div className="files-panel">
      {feed.map((event, i) => {
        const meta = CHANGE_GLYPH[event.change] ?? CHANGE_GLYPH.changed;
        return (
          <button
            key={`${event.path}-${event.at}-${i}`}
            className="file-row"
            onClick={() => onOpenDiff(event.path)}
            title="Open diff"
          >
            <span className={`chg ${meta.cls}`}>{meta.glyph}</span>
            <span className="file-path">{event.path}</span>
            <span className="file-time">
              {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
