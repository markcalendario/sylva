import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, MessageSquare, Wrench } from "lucide-react";
import {
  circleMembers,
  GROVE_ID,
  type TranscriptHit,
  type TranscriptSearchMode,
} from "sylva-shared";
import { api } from "../../lib/api";
import { useWords } from "../../lib/theme";
import { useSylva } from "../../state/store";
import { Dialog } from "../Dialog";

/**
 * Who touched this file?
 *
 * Running six dryads at once means losing track of which one did what within
 * about an hour. The answer was always written down — a transcript per session
 * — but nothing could read across them, so the only way to find out was to open
 * each worktree and scroll. This asks all of them at once.
 *
 * Two questions, because they are genuinely different: which conversations
 * touched a *path*, and which said a *thing*. The first is what you want after
 * a merge conflict; the second is what you want when you remember a dryad
 * explaining something and not which one.
 */
export function TranscriptSearchDialog({
  open,
  initialQuery,
  onClose,
}: {
  open: boolean;
  /** Pre-filled when opened from a file — the usual way in. */
  initialQuery?: string;
  onClose: () => void;
}) {
  const words = useWords();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [mode, setMode] = useState<TranscriptSearchMode>("file");
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening from a file arrives with the path already in hand; opening from the
  // keyboard arrives empty. Either way the box is where the cursor goes.
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery ?? "");
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, initialQuery]);

  const search = useTranscriptSearch(open ? query : "", mode);

  return (
    <Dialog title={`Search the ${words.agentsPossessive} memory`} open={open} onClose={onClose}>
      <div className="seg tsearch-mode" role="group" aria-label="Search by">
        <button
          className={mode === "file" ? "seg-on" : ""}
          onClick={() => setMode("file")}
          data-tip="Find every step that touched a file"
        >
          A file
        </button>
        <button
          className={mode === "text" ? "seg-on" : ""}
          onClick={() => setMode("text")}
          data-tip="Find prompts and answers containing these words"
        >
          Something said
        </button>
      </div>

      <input
        ref={inputRef}
        className="tsearch-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={mode === "file" ? "src/state/store.ts" : "why did we…"}
        aria-label={mode === "file" ? "File path or fragment" : "Words to look for"}
        spellCheck={false}
      />

      <Results state={search} mode={mode} onJump={onClose} />
    </Dialog>
  );
}

interface SearchState {
  loading: boolean;
  hits: TranscriptHit[];
  sessionsSearched: number;
  truncated: boolean;
  /** Null until a search has actually run, so "no hits" isn't shown too early. */
  ran: string | null;
}

/**
 * Debounced, and never below two characters: this reads every transcript on the
 * machine, which is cheap at a handful of sessions and not free at fifty.
 */
function useTranscriptSearch(query: string, mode: TranscriptSearchMode): SearchState {
  const [state, setState] = useState<SearchState>({
    loading: false,
    hits: [],
    sessionsSearched: 0,
    truncated: false,
    ran: null,
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setState({ loading: false, hits: [], sessionsSearched: 0, truncated: false, ran: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .searchTranscripts(trimmed, mode)
        .then((res) => {
          // A slow answer for an old query must not replace a newer one.
          if (cancelled) return;
          setState({
            loading: false,
            hits: res.hits,
            sessionsSearched: res.sessionsSearched,
            truncated: res.truncated,
            ran: trimmed,
          });
        })
        .catch(() => {
          if (!cancelled) {
            setState({
              loading: false,
              hits: [],
              sessionsSearched: 0,
              truncated: false,
              ran: trimmed,
            });
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, mode]);

  return state;
}

function Results({
  state,
  mode,
  onJump,
}: {
  state: SearchState;
  mode: TranscriptSearchMode;
  onJump: () => void;
}) {
  const words = useWords();
  const index = useSylva((s) => s.worktreeIndex);
  const statuses = useSylva((s) => s.statuses);

  /** Hits grouped by the conversation they came from, newest group first. */
  const groups = useMemo(() => {
    const by = new Map<string, TranscriptHit[]>();
    for (const hit of state.hits) {
      by.set(hit.worktreeId, [...(by.get(hit.worktreeId) ?? []), hit]);
    }
    return [...by.entries()];
  }, [state.hits]);

  if (state.ran === null) {
    return (
      <p className="dialog-hint">
        {mode === "file"
          ? `Type a path, or any part of one — every ${words.agent}'s conversation is searched, not just the ones you have open.`
          : "Type a couple of words. Prompts, answers and steps are all searched."}
      </p>
    );
  }

  if (state.loading && state.hits.length === 0) {
    return <p className="dialog-hint">Reading the transcripts…</p>;
  }

  if (state.hits.length === 0) {
    return (
      <p className="dialog-hint">
        Nothing in {state.sessionsSearched} conversation
        {state.sessionsSearched === 1 ? "" : "s"} matched that.
      </p>
    );
  }

  /** What to call a session: its branch, its circle, the grove, or nothing. */
  const label = (worktreeId: string): string => {
    // A transcript whose session the registry has forgotten — its repo was
    // removed, or its worktree was. It still holds what happened.
    if (!worktreeId) return "a conversation Sylva no longer tracks";
    if (worktreeId === GROVE_ID) return "the grove";
    const members = circleMembers(worktreeId);
    if (members) {
      return members
        .map((m) => statuses[m]?.branch ?? index[m]?.branch ?? m.slice(0, 7))
        .join(" + ");
    }
    return statuses[worktreeId]?.branch ?? index[worktreeId]?.branch ?? worktreeId.slice(0, 7);
  };

  /** There is somewhere to go only when the session still belongs to something. */
  const canGo = (hit: TranscriptHit) => hit.worktreeId !== "";

  const go = (hit: TranscriptHit) => {
    if (!canGo(hit)) return;
    const store = useSylva.getState();
    if (hit.worktreeId === GROVE_ID) store.setView("grove");
    else store.openWorktree(hit.worktreeId);
    onJump();
  };

  return (
    <>
      <p className="dialog-hint tsearch-count">
        {state.hits.length} match{state.hits.length === 1 ? "" : "es"} across {groups.length}{" "}
        {groups.length === 1 ? words.agent : words.agents}
        {state.truncated && " · showing the most recent"}
      </p>

      <div className="tsearch-results">
        {groups.map(([worktreeId, hits]) => {
          const reachable = worktreeId !== "";
          return (
            <section
              key={worktreeId || "forgotten"}
              className={`tsearch-group ${reachable ? "" : "tsearch-group-gone"}`}
            >
              <header className="tsearch-group-head">
                <code className="tsearch-where">{label(worktreeId)}</code>
                <span className="tsearch-group-count">{hits.length}</span>
                {reachable && (
                  <button
                    className="btn-quiet tsearch-open"
                    onClick={() => hits[0] && go(hits[0])}
                    data-tip={`Open this ${words.agent} and read the conversation`}
                  >
                    Open
                  </button>
                )}
              </header>

              {hits.map((hit, i) => (
                <button
                  key={`${hit.sessionId}-${hit.at}-${i}`}
                  className="tsearch-hit"
                  onClick={() => go(hit)}
                  {...(reachable ? {} : { disabled: true })}
                  data-tip={
                    reachable
                      ? `Open the ${words.agent} this happened in`
                      : "This conversation's worktree is gone — there's nowhere to open"
                  }
                >
                  <span className="tsearch-icon">
                    {hit.kind === "tool-use" ? (
                      <Wrench size={11} />
                    ) : hit.kind === "user-prompt" ? (
                      <MessageSquare size={11} />
                    ) : (
                      <FileCode2 size={11} />
                    )}
                  </span>
                  {hit.tool && <span className="tsearch-tool">{hit.tool}</span>}
                  <span className="tsearch-summary">{hit.summary}</span>
                  <span className="tsearch-when">{when(hit.at)}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** How long ago, said the way you'd say it out loud. */
function when(at: string): string {
  if (!at) return "";
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";

  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}
