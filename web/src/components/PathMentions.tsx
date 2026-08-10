import { useEffect, useRef, useState } from "react";
import { FileCode2 } from "lucide-react";
import { api } from "../lib/api";
import { useSylva } from "../state/store";

/** How many suggestions are worth showing at once. */
const MAX = 8;

/** The `@fragment` immediately before the caret, if there is one. */
export interface Mention {
  /** Offset of the `@` itself. */
  start: number;
  /** Offset just past the fragment — the caret. */
  end: number;
  /** What has been typed after the `@`. */
  query: string;
}

/**
 * Is the caret inside an `@path` being typed?
 *
 * The `@` has to start a word — an email address, a decorator and a npm scope
 * all contain one mid-token, and popping a file list over any of them would be
 * wrong far more often than right. Everything after it up to the caret is the
 * fragment, and a space ends it, because paths in prose are followed by one.
 */
export function mentionAt(text: string, caret: number): Mention | null {
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      at = i;
      break;
    }
    // A path can't contain these, so hitting one means there is no mention.
    if (ch === undefined || ch === " " || ch === "\n" || ch === "\t") return null;
  }
  if (at === -1) return null;

  const before = at === 0 ? "" : text[at - 1];
  if (before !== "" && before !== " " && before !== "\n" && before !== "\t") return null;

  return { start: at, end: caret, query: text.slice(at + 1, caret) };
}

/** Put a chosen path into the text, replacing the `@fragment` that summoned it. */
export function applyMention(text: string, mention: Mention, path: string): {
  text: string;
  caret: number;
} {
  // A trailing space, because a path is nearly always followed by more words
  // and typing it yourself every time is a small tax.
  const insert = `${path} `;
  return {
    text: `${text.slice(0, mention.start)}${insert}${text.slice(mention.end)}`,
    caret: mention.start + insert.length,
  };
}

interface Suggestion {
  worktreeId: string;
  path: string;
}

/**
 * Files matching what has been typed after an `@`, across everything this dryad
 * tends. Debounced, and the previous list stays up while the next is fetched —
 * blanking it mid-typing makes the popup flicker on every keystroke.
 */
function useSuggestions(members: string[], query: string | null): Suggestion[] {
  const memberKey = members.join(",");
  const [hits, setHits] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (query === null) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const ids = memberKey ? memberKey.split(",") : [];
    const timer = window.setTimeout(
      () => {
        void Promise.all(
          ids.map((id) =>
            api
              .searchFiles(id, query || "")
              .then((res) => res.results.map((r) => ({ worktreeId: id, path: r.path })))
              .catch((): Suggestion[] => []),
          ),
        ).then((groups) => {
          if (!cancelled) setHits(groups.flat().slice(0, MAX));
        });
      },
      // An empty fragment lists the first files immediately — you just typed
      // "@" and are waiting to see something.
      query ? 120 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberKey, query]);

  return hits;
}

/**
 * `@path` completion for the prompt box.
 *
 * Naming a file to the dryad meant typing its path from memory, exactly, or
 * attaching it — which copies it somewhere else entirely. Neither is what you
 * want when the whole point is "look at this one". So: `@`, three letters, and
 * the real path goes in.
 */
export function PathMentions({
  members,
  mention,
  onPick,
  onDismiss,
}: {
  members: string[];
  /** Null when no `@` is being typed — the popup simply isn't there. */
  mention: Mention | null;
  onPick: (path: string) => void;
  onDismiss: () => void;
}) {
  const suggestions = useSuggestions(members, mention?.query ?? null);
  const [cursor, setCursor] = useState(0);
  const index = useSylva((s) => s.worktreeIndex);
  const shared = members.length > 1;
  const listRef = useRef<HTMLDivElement>(null);

  // A new fragment is a new list; the highlight belongs at the top of it.
  useEffect(() => setCursor(0), [mention?.query]);

  useEffect(() => {
    setCursor((c) => (c >= suggestions.length ? 0 : c));
  }, [suggestions.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".mention-on")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  /**
   * The keys the popup owns while it is open, handed up to the textarea's own
   * handler — which has to ask first, because Enter means "send" when there is
   * no popup and "choose this" when there is.
   */
  useEffect(() => {
    if (!mention) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => (suggestions.length ? (c + 1) % suggestions.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => (suggestions.length ? (c - 1 + suggestions.length) % suggestions.length : 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        const chosen = suggestions[cursor];
        if (!chosen) return;
        e.preventDefault();
        e.stopPropagation();
        onPick(chosen.path);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    // Capture, so it runs before the textarea's Enter-sends handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mention, suggestions, cursor, onPick, onDismiss]);

  if (!mention || suggestions.length === 0) return null;

  return (
    <div className="mentions" role="listbox" aria-label="Files" ref={listRef}>
      {suggestions.map((hit, i) => (
        <button
          key={`${hit.worktreeId}:${hit.path}`}
          type="button"
          role="option"
          aria-selected={i === cursor}
          className={`mention ${i === cursor ? "mention-on" : ""}`}
          onMouseMove={() => setCursor(i)}
          // The textarea must not lose focus, or the caret we are about to
          // write to goes with it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(hit.path)}
        >
          <FileCode2 size={12} />
          <span className="mention-name">{leafOf(hit.path)}</span>
          <span className="mention-path">{dirOf(hit.path)}</span>
          {shared && (
            <span className="mention-where">{index[hit.worktreeId]?.branch ?? ""}</span>
          )}
        </button>
      ))}
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
