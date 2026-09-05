import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, X } from "lucide-react";
import { api, ApiFailure } from "../lib/api";
import { confirm } from "../lib/confirm";
import { chunkClass, highlightLines, languageFor, type Chunk } from "../lib/highlight";
import { useChangedLines, useFileContent, useInvalidate, useLineBlame } from "../lib/queries";
import { useWords } from "../lib/theme";
import type { LineBlame } from "sylva-shared";
import { fileKey, useSylva, type OpenFile, type Pane } from "../state/store";
import { bytes } from "./FileTree";

/**
 * Above this, the editor stops re-colouring as you type.
 *
 * The coloured layer is rebuilt from the draft on every keystroke, and
 * tokenising tens of thousands of characters between one and the next is felt
 * immediately. Reading is unaffected — that highlight is computed once.
 */
const EDIT_HIGHLIGHT_LIMIT = 60_000;

/** How long the caret must sit still before its line is worth a `git blame`. */
const BLAME_SETTLE_MS = 250;

/** Two tokenisations of a line that would draw identically. */
function sameChunks(a: Chunk[], b: Chunk[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((chunk, i) => {
    const there = b[i];
    return !!there && chunk.text === there.text && chunk.type === there.type;
  });
}

/**
 * One line of the file, drawn only when that line changes.
 *
 * Typing re-tokenises the whole draft — a block comment opened on line four
 * colours line four hundred, so there is no honest way to tokenise less — which
 * hands React a brand-new chunk array for every line on every keystroke. Left
 * alone it then rebuilds a span per token for the entire file to show one
 * character being typed, and a two-thousand-line file types like treacle.
 * Comparing the chunks is far cheaper than re-rendering them.
 */
const CodeLine = memo(
  function CodeLine({
    chunks,
    className,
    lineRef,
  }: {
    chunks: Chunk[];
    className: string;
    /** Set on the one line a jump is aiming at, so it can be scrolled to. */
    lineRef?: React.RefObject<HTMLSpanElement | null>;
  }) {
    return (
      <span className={className} ref={lineRef}>
        {chunks.length === 0
          ? " "
          : chunks.map((chunk, c) => (
              <span key={c} className={chunkClass(chunk.type)}>
                {chunk.text}
              </span>
            ))}
        {"\n"}
      </span>
    );
  },
  // The ref rides on the class: a line that gains or loses the jump target
  // gains or loses `tree-file-line-hit` with it, so comparing the class is
  // enough to be sure the ref lands where it now belongs.
  (prev, next) => prev.className === next.className && sameChunks(prev.chunks, next.chunks),
);

/**
 * A value once it has stopped changing.
 *
 * For questions whose answers cost a process. Every intermediate value is
 * skipped rather than queued, so a caret dragged down two hundred lines asks
 * one question rather than two hundred.
 */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}

/**
 * The Files tab's editor: a bar of open files, and whichever one is being read.
 *
 * A single selected file was enough while the tab was a viewer — you clicked a
 * path, you read it, you clicked another. It stops being enough the moment the
 * work is real: following a dryad's edit across four files meant losing your
 * place in each one as you opened the next, and any half-typed change with it.
 * Tabs are what an editor has for exactly that reason, so the tab has them.
 */
export function FileEditor({ pane }: { pane: Pane }) {
  const words = useWords();
  const drafts = useSylva((s) => s.fileDrafts);
  const store = useSylva.getState();
  const active = pane.files.find((f) => fileKey(f) === pane.activeFile) ?? null;

  if (pane.files.length === 0) {
    return (
      <div className="editor">
        <div className="editor-empty">
          <FileCode2 size={22} strokeWidth={1.5} />
          <p>No file open.</p>
          <p className="editor-empty-hint">
            Pick one from the tree, a changed file, or anything the {words.agent} touched in its
            transcript — they all open here, and stay open as tabs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <EditorTabs pane={pane} drafts={drafts} />
      {active ? (
        <FileBody
          key={fileKey(active)}
          file={active}
          dirtyKey={fileKey(active)}
          onClose={() => store.closeFile(fileKey(active))}
        />
      ) : (
        <div className="editor-empty">
          <p>Pick one of the open files above.</p>
        </div>
      )}
    </div>
  );
}

/** Where a right-click landed, and on which tab. */
interface MenuAt {
  key: string;
  x: number;
  y: number;
}

/** The strip of open files. Reorderable, closable, and it says which are dirty. */
function EditorTabs({ pane, drafts }: { pane: Pane; drafts: Record<string, string> }) {
  const store = useSylva.getState();
  const index = useSylva((s) => s.worktreeIndex);
  const stripRef = useRef<HTMLDivElement>(null);
  /** The tab being dragged, by index, while a reorder is in progress. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);

  // Choosing a file from somewhere else — the palette, a tool row — can select
  // a tab that is scrolled out of sight. Bring it back rather than leaving the
  // strip looking as though nothing happened.
  useEffect(() => {
    const strip = stripRef.current;
    const on = strip?.querySelector<HTMLElement>(".etab-on");
    on?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pane.activeFile]);

  /** Two worktrees can both have a `store.ts`; say which when they might. */
  const ambiguous = useMemo(() => {
    const byName = new Map<string, number>();
    for (const file of pane.files) {
      const name = leafOf(file.path);
      byName.set(name, (byName.get(name) ?? 0) + 1);
    }
    return byName;
  }, [pane.files]);

  return (
    <div className="etabs" ref={stripRef} role="tablist" aria-label="Open files">
      {pane.files.map((file, i) => {
        const key = fileKey(file);
        const on = key === pane.activeFile;
        const dirty = drafts[key] !== undefined;
        const name = leafOf(file.path);
        const duplicated = (ambiguous.get(name) ?? 0) > 1;

        return (
          <div
            key={key}
            className={`etab ${on ? "etab-on" : ""} ${dragOver === i ? "etab-drop" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = "move";
              // Firefox refuses to start a drag without payload of some kind.
              e.dataTransfer.setData("text/plain", key);
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((at) => (at === i ? null : at))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) store.moveFile(dragging, i);
              setDragging(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDragOver(null);
            }}
            // Middle-click closes, as it does in every editor and browser.
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              store.closeFile(key);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ key, x: e.clientX, y: e.clientY });
            }}
          >
            <button
              role="tab"
              aria-selected={on}
              className="etab-name"
              onClick={() => store.setActiveFile(key)}
              data-tip={`${file.path}${
                dirty ? " · unsaved changes" : ""
              }\n${index[file.worktreeId]?.repoName ?? ""}`}
            >
              <span className="etab-title">{name}</span>
              {/* Only when the leaf alone would be a lie about which file this is. */}
              {duplicated && <span className="etab-where">{dirOf(file.path) || "/"}</span>}
            </button>
            <button
              className={`ghost etab-close ${dirty ? "etab-close-dirty" : ""}`}
              onClick={() => store.closeFile(key)}
              aria-label={`Close ${name}`}
              data-tip={dirty ? "Unsaved changes — closing discards them" : "Close this file"}
            >
              {dirty ? <span className="etab-dot" aria-hidden /> : <X size={11} />}
            </button>
          </div>
        );
      })}

      <span className="etabs-gap" />

      {pane.files.length > 1 && (
        <button
          className="ghost etabs-closeall"
          onClick={() => void closeSet(pane.files.map(fileKey), drafts)}
          data-tip="Close every open file · right-click a tab for more"
        >
          Close all
        </button>
      )}

      {menu && <TabMenu at={menu} pane={pane} drafts={drafts} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Close a set of tabs, asking first when that would throw away typing.
 *
 * The confirmation is the whole reason this isn't just a store call: "close
 * all" said with three unsaved files open means something different from "close
 * all" with none, and only the caller knows which one you meant.
 */
async function closeSet(keys: string[], drafts: Record<string, string>): Promise<void> {
  if (keys.length === 0) return;
  const unsaved = keys.filter((key) => drafts[key] !== undefined);

  if (unsaved.length > 0) {
    const ok = await confirm({
      title:
        unsaved.length === 1
          ? "Close a file with unsaved changes?"
          : `Close ${unsaved.length} files with unsaved changes?`,
      body:
        unsaved.length === 1
          ? "The edits you haven't saved are discarded. The file on disk is untouched."
          : "Their unsaved edits are discarded. The files on disk are untouched.",
      confirmLabel: "Discard and close",
      tone: "danger",
    });
    if (!ok) return;
  }
  useSylva.getState().closeFiles(keys);
}

/**
 * The tab menu, as every editor has one.
 *
 * "Close all" and its cousins are the reason it exists: after following a dryad
 * through a dozen files you want the strip back, and closing them one ✕ at a
 * time is the sort of small tax that makes a tool feel unfinished.
 */
function TabMenu({
  at,
  pane,
  drafts,
  onClose,
}: {
  at: MenuAt;
  pane: Pane;
  drafts: Record<string, string>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const store = useSylva.getState();
  const keys = pane.files.map(fileKey);
  const at_ = keys.indexOf(at.key);
  const file = pane.files[at_];

  const left = keys.slice(0, Math.max(0, at_));
  const right = keys.slice(at_ + 1);
  const others = keys.filter((k) => k !== at.key);
  const saved = keys.filter((k) => drafts[k] === undefined);

  // Dismiss on anything that means "I'm done here": a click elsewhere, Escape,
  // or the window changing size under it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Opened near the right or bottom edge, it would otherwise hang off screen.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) {
      node.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
    }
    if (box.bottom > window.innerHeight - 8) {
      node.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;
    }
  }, []);

  const run = (fn: () => void | Promise<void>) => () => {
    onClose();
    void fn();
  };

  return (
    <div
      className="tabmenu"
      role="menu"
      ref={ref}
      style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button role="menuitem" onClick={run(() => store.closeFile(at.key))}>
        Close
        <span className="tabmenu-key">⌘W</span>
      </button>
      <button
        role="menuitem"
        disabled={others.length === 0}
        onClick={run(() => closeSet(others, drafts))}
      >
        Close others
      </button>
      <button
        role="menuitem"
        disabled={left.length === 0}
        onClick={run(() => closeSet(left, drafts))}
      >
        Close all to the left
      </button>
      <button
        role="menuitem"
        disabled={right.length === 0}
        onClick={run(() => closeSet(right, drafts))}
      >
        Close all to the right
      </button>

      <div className="tabmenu-rule" role="separator" />

      {/* The one close that can never lose anything, so it never asks. */}
      <button
        role="menuitem"
        disabled={saved.length === 0}
        onClick={run(() => store.closeFiles(saved))}
      >
        Close saved
        {saved.length > 0 && <span className="tabmenu-key">{saved.length}</span>}
      </button>
      <button
        role="menuitem"
        disabled={keys.length === 0}
        onClick={run(() => closeSet(keys, drafts))}
      >
        Close all
      </button>

      <div className="tabmenu-rule" role="separator" />

      <button
        role="menuitem"
        onClick={run(() => {
          if (file) void navigator.clipboard?.writeText(file.path).catch(() => {});
        })}
      >
        Copy path
      </button>
      <button
        role="menuitem"
        onClick={run(() => {
          // Show it where it lives — the tree, not the change list, since the
          // file may not have changed at all.
          store.setFilesMode("browse");
          store.setActiveFile(at.key);
        })}
      >
        Reveal in tree
      </button>
      <button
        role="menuitem"
        onClick={run(() => {
          if (file) {
            store.setPaneDiff(
              { worktreeId: file.worktreeId, path: file.path, staged: false },
              "git",
            );
          }
        })}
      >
        Show diff in Git
      </button>
      {/* The question you ask after a surprising diff: which of the six dryads
          did this, and when. */}
      <button role="menuitem" onClick={run(() => file && store.openTranscriptSearch(file.path))}>
        Who touched this?
        <span className="tabmenu-key">⌘⇧F</span>
      </button>
    </div>
  );
}

function leafOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Turn a position in the rendered text into an offset into the file.
 *
 * The coloured view is the file's own characters split across a span per token,
 * so summing the text nodes that precede a point counts exactly the characters
 * that precede it in the file — no font metrics, no assumptions about tabs.
 */
function offsetOfNode(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node) || node.nodeType !== Node.TEXT_NODE) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return total + offset;
    total += (walker.currentNode as Text).data.length;
  }
  return null;
}

/** Where in the file a click landed. */
function caretOffsetFromPoint(root: HTMLElement, x: number, y: number): number | null {
  // Two spellings of the same API: the standard one, and WebKit's older one.
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const hit = doc.caretPositionFromPoint?.(x, y);
  if (hit) return offsetOfNode(root, hit.offsetNode, hit.offset);
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? offsetOfNode(root, range.startContainer, range.startOffset) : null;
}

function FileBody({
  file,
  dirtyKey,
  onClose,
}: {
  file: OpenFile;
  dirtyKey: string;
  onClose: () => void;
}) {
  const { worktreeId, path } = file;
  const content = useFileContent(worktreeId, path);
  const invalidate = useInvalidate();
  const lineRef = useRef<HTMLSpanElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const place = useSylva((s) => s.worktreeIndex[worktreeId]);

  /** The line the caret is on, which the blame bar follows. */
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const changed = useChangedLines(worktreeId, path);
  /**
   * Blame is a `git blame` process per line, so it is asked about the line you
   * came to rest on rather than every line you passed through. Holding an arrow
   * key down a file used to spawn one per row, which the machine felt.
   */
  const blameLine = useSettled(caretLine, BLAME_SETTLE_MS);
  const blame = useLineBlame(worktreeId, path, blameLine);

  /**
   * Lines that differ from the last commit, as two sets the gutter can ask.
   * Built once per answer rather than searched per rendered line — a
   * three-thousand-line file would otherwise scan the array three thousand
   * times on every keystroke.
   */
  const marks = useMemo(() => {
    const added = new Set(changed.data?.added ?? []);
    const modified = new Set(changed.data?.modified ?? []);
    return { added, modified, untracked: changed.data?.tracked === false };
  }, [changed.data]);

  /**
   * The draft lives in the store, keyed by file, so it survives switching to
   * another tab, leaving the Files tab, and coming back — none of which should
   * cost you what you had typed.
   */
  const draft = useSylva((s) => s.fileDrafts[dirtyKey]);
  const setDraft = (text: string) => useSylva.getState().setFileDraft(dirtyKey, text);
  const dropDraft = () => useSylva.getState().clearFileDraft(dirtyKey);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Where to put the caret once the editor exists, from where you clicked. */
  const [pendingCaret, setPendingCaret] = useState<[number, number] | null>(null);

  const text = content.data?.binary ? "" : (content.data?.content ?? "");
  const language = languageFor(path);
  // Reading: tokenised once, since neither the text nor the grammar changes
  // while you scroll. Editing: rebuilt per keystroke, hence the size limit.
  const readLines = useMemo(() => highlightLines(text, language), [text, language]);
  const editLines = useMemo(
    () =>
      draft === undefined
        ? []
        : highlightLines(draft, draft.length <= EDIT_HIGHLIGHT_LIMIT ? language : null),
    [draft, language],
  );

  // Arriving from a text match should land on the line that matched, not at
  // the top of a two-thousand-line file.
  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: "center" });
  }, [path, file.line, content.data]);

  /**
   * Put the caret where the click was. The editor covers the whole file rather
   * than scrolling inside itself, so focusing it can't jump the view — which is
   * what makes clicking line 400 land on line 400 instead of the top.
   */
  useEffect(() => {
    if (!pendingCaret) return;
    const node = editorRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(pendingCaret[0], pendingCaret[1]);
    setPendingCaret(null);
  }, [pendingCaret]);

  if (content.isLoading) return <div className="tree-note">Loading {path}…</div>;
  if (content.isError || !content.data) {
    return (
      <div className="editor-gone">
        <p>Couldn't read {path}.</p>
        <p className="editor-empty-hint">
          It may have been deleted or renamed since this tab was opened.
        </p>
        <button className="btn-quiet" onClick={onClose} data-tip="Close this tab">
          Close tab
        </button>
      </div>
    );
  }
  if (content.data.binary) {
    return (
      <div className="tree-note">
        {path} is a binary file ({bytes(content.data.size)}).
      </div>
    );
  }

  const editable = !content.data.truncated;
  const editing = draft !== undefined;
  const dirty = editing && draft !== text;

  /**
   * A click on the text: note which line it landed on, and start editing.
   *
   * The line is recorded whether or not editing begins — a file too large to
   * edit is still a file you want to ask "who wrote this" about, and reading is
   * exactly when you ask.
   */
  const onCodeClick = (event: React.MouseEvent<HTMLPreElement>) => {
    const pre = codeRef.current;
    if (pre) {
      const at = caretOffsetFromPoint(pre, event.clientX, event.clientY);
      if (at !== null) setCaretLine(lineOfOffset(text, at));
    }
    beginEdit(event);
  };

  /**
   * Start editing from a click on the text.
   *
   * A selection dragged out before the click is kept — you highlighted that
   * span for a reason, and the usual reason is that you are about to replace
   * it. Anything else starts a caret where the pointer was.
   */
  const beginEdit = (event: React.MouseEvent<HTMLPreElement>) => {
    if (!editable || editing) return;
    const pre = codeRef.current;
    // Clicking past the end of the text is a click at the end of the text.
    let caret: [number, number] = [text.length, text.length];

    if (pre) {
      const selection = window.getSelection();
      const dragged =
        selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
          ? ([
              offsetOfNode(pre, selection.anchorNode, selection.anchorOffset),
              offsetOfNode(pre, selection.focusNode, selection.focusOffset),
            ] as const)
          : null;

      if (dragged && dragged[0] !== null && dragged[1] !== null) {
        // Selections run backwards as readily as forwards.
        caret = dragged[0] <= dragged[1] ? [dragged[0], dragged[1]] : [dragged[1], dragged[0]];
      } else {
        const at = caretOffsetFromPoint(pre, event.clientX, event.clientY);
        if (at !== null) caret = [at, at];
      }
    }

    setDraft(text);
    setPendingCaret(caret);
  };

  const save = async () => {
    if (draft === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveFile(worktreeId, path, draft);
      invalidate.file(worktreeId, path);
      // The patch on the Git tab is about to be wrong, and so is the file's
      // place in the change list; both are cheap to re-ask for.
      invalidate.diffs();
      invalidate.status(worktreeId);
      dropDraft();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : `Couldn't save ${path}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tree-file">
      <header className="tree-file-head">
        <span className="editor-crumbs" data-tip={path}>
          {place && <span className="editor-crumb-repo">{place.repoName}</span>}
          <code>{path}</code>
        </span>
        <span className="tree-file-size">{bytes(content.data.size)}</span>
        {editing ? (
          <span className="tree-file-actions">
            <button
              className="btn-quiet"
              disabled={saving}
              onClick={() => {
                dropDraft();
                setError(null);
              }}
              data-tip="Discard these edits and go back to reading"
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={saving || !dirty}
              onClick={() => void save()}
              data-tip={dirty ? "Write this back to the worktree" : "Nothing has changed yet"}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </span>
        ) : (
          editable && (
            /* No button: the text itself is the control. This says so once,
               quietly, because an affordance nobody can see isn't one. */
            <span className="tree-file-hint" data-tip="Click anywhere in the file to edit it">
              click to edit
            </span>
          )
        )}
      </header>

      {error && (
        <div className="form-error" data-tip="The file wasn't written">
          {error}
        </div>
      )}

      {/* One scrolling box holding two layers that always agree: the coloured
          text, and — while editing — a transparent textarea laid exactly over
          it. The textarea is as tall as the whole file rather than a window
          onto it, so there is no second scrollbar to keep in step and no jump
          when it takes focus. */}
      <div className="tree-code">
        <div className="tree-code-inner">
          <pre
            className={`tree-file-body ${editable && !editing ? "tree-file-body-editable" : ""}`}
            ref={codeRef}
            aria-hidden={editing}
            {...(editing ? {} : { onClick: onCodeClick })}
          >
            {(editing ? editLines : readLines).map((chunks, i) => {
              const number = i + 1;
              const hit = !editing && file.line === number;
              // Untracked files are new in their entirety, so every line is.
              const mark = marks.untracked
                ? "add"
                : marks.added.has(number)
                  ? "add"
                  : marks.modified.has(number)
                    ? "mod"
                    : "";
              return (
                <CodeLine
                  key={number}
                  {...(hit ? { lineRef } : {})}
                  chunks={chunks}
                  className={[
                    "tree-file-line",
                    hit ? "tree-file-line-hit" : "",
                    mark ? `line-${mark}` : "",
                    caretLine === number ? "line-caret" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              );
            })}
          </pre>

          {editing && (
            <textarea
              ref={editorRef}
              className="tree-file-editor"
              value={draft}
              spellCheck={false}
              wrap="off"
              onChange={(e) => setDraft(e.target.value)}
              // Every way a caret can move: typing, clicking, arrowing, and
              // the browser's own selection changes.
              onSelect={(e) => setCaretLine(lineOfOffset(draft, e.currentTarget.selectionStart))}
              onKeyDown={(e) => {
                // The one shortcut worth having here; everything else is a
                // normal textarea, including Tab, which still moves focus out.
                if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                  e.preventDefault();
                  if (dirty && !saving) void save();
                }
              }}
              data-tip="⌘S saves · Cancel discards"
            />
          )}
        </div>
      </div>

      {content.data.truncated && (
        <p className="tree-note">
          Cut off at 256 KB — open it in your editor to read the rest, and to change it.
        </p>
      )}

      <BlameBar
        line={caretLine}
        blame={blame.data ?? null}
        // Still moving counts as still reading: the answer on screen is about
        // the line you were on a moment ago, and showing it under the new
        // number would be a quiet lie.
        loading={blame.isLoading || blameLine !== caretLine}
        failed={blame.isError}
      />
    </div>
  );
}

/** Which line an offset into the text falls on, counting from one. */
function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  const stop = Math.min(offset, text.length);
  for (let i = 0; i < stop; i++) if (text[i] === "\n") line++;
  return line;
}

/**
 * Who last touched the line under the caret.
 *
 * A footer rather than an inline annotation: blame beside every line is a
 * column of noise you stop seeing within a day, and the question is only ever
 * asked about the one line you are looking at.
 */
function BlameBar({
  line,
  blame,
  loading,
  failed,
}: {
  line: number | null;
  blame: LineBlame | null;
  loading: boolean;
  failed: boolean;
}) {
  if (line === null) {
    return (
      <footer className="blamebar blamebar-idle">
        <span data-tip="Click a line to see who last changed it">
          Click a line to see who last changed it
        </span>
      </footer>
    );
  }

  return (
    <footer className="blamebar">
      <span className="blame-line" data-tip="Line the caret is on">
        L{line}
      </span>

      {loading && <span className="blame-quiet">reading blame…</span>}

      {/* A file git has never seen has no blame to fail at — say so plainly
          rather than reporting an error for an ordinary state. */}
      {!loading && failed && (
        <span className="blame-quiet" data-tip="git blame couldn't answer for this file">
          not tracked by git
        </span>
      )}

      {!loading && !failed && blame && !blame.committed && (
        <span className="blame-uncommitted" data-tip="This line isn't in any commit yet">
          uncommitted — yours, not yet recorded
        </span>
      )}

      {!loading && !failed && blame?.committed && (
        <>
          <span className="blame-author" data-tip={blame.authorEmail || blame.author}>
            {blame.author}
          </span>
          <span className="blame-when" data-tip={blame.authoredAt}>
            {ago(blame.authoredAt)}
          </span>
          <code className="blame-sha" data-tip="Commit that last changed this line">
            {blame.shortSha}
          </code>
          <span className="blame-summary" data-tip={blame.summary}>
            {blame.summary}
          </span>
        </>
      )}
    </footer>
  );
}

/** How long ago, said the way you'd say it out loud. */
function ago(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
