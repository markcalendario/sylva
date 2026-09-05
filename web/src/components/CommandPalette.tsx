import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  FileCode2,
  Flower2,
  GitBranch,
  Layers,
  LayoutGrid,
  PanelLeft,
  PanelsTopLeft,
  Search,
  Settings,
  SquareTerminal,
  Trees,
  Wrench,
} from "lucide-react";
import { circleMembers, GROVE_ID } from "sylva-shared";
import { api } from "../lib/api";
import { worktreeLabel } from "../lib/branch";
import { useHasForest, useWords } from "../lib/theme";
import { attentionQueue, fileKey, TABS, useSylva, type Tab } from "../state/store";

/** One thing the palette can do. */
interface Command {
  id: string;
  group: string;
  label: string;
  /** The quieter half of the row — a path, a repository, a branch. */
  hint?: string;
  /** Words that should match this row without being shown on it. */
  keywords?: string;
  icon?: React.ReactNode;
  run: () => void;
}

/** Groups appear in this order, whatever order their rows were built in. */
const GROUP_ORDER = ["Files", "Worktrees", "Go to", "This pane", "Actions"];

/**
 * One box that gets you anywhere.
 *
 * Sylva grew a sidebar, a pane with four tabs, terminals within terminals
 * and files within those — and every one of them could only be reached by
 * pointing at it. That is fine at three worktrees and unbearable at ten, which
 * is exactly the number Sylva exists to make possible.
 *
 * Files are searched live against whatever the active pane holds, so ⌘K is also
 * the quick-open; everything else is built from state already in the store.
 */
export function CommandPalette({ onHelp }: { onHelp: () => void }) {
  const open = useSylva((s) => s.paletteOpen);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pane = useSylva((s) => s.pane);
  const index = useSylva((s) => s.worktreeIndex);
  const statuses = useSylva((s) => s.statuses);
  const knownCircles = useSylva((s) => s.knownCircles);
  const sidebarCollapsed = useSylva((s) => s.sidebarCollapsed);

  const targetId = pane.worktreeId;
  const members = useMemo(
    () => (targetId ? (circleMembers(targetId) ?? [targetId]) : []),
    [targetId],
  );

  const files = useFileSearch(members, open ? query : "");
  const words = useWords();
  const hasForest = useHasForest();

  // Every opening starts clean. A palette that remembers last time's query is
  // one you have to clear before you can use it.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // The dialog has to exist before it can take focus.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const store = useSylva.getState();
    const close = () => store.setPalette(false);
    const out: Command[] = [];

    // ---- Files, from the live search and from what's already open ----
    for (const hit of files) {
      out.push({
        id: `file:${hit.worktreeId}:${hit.path}`,
        group: "Files",
        label: leafOf(hit.path),
        hint: hit.path,
        icon: <FileCode2 size={13} />,
        run: () => {
          store.openFile({ worktreeId: hit.worktreeId, path: hit.path });
          close();
        },
      });
    }

    // ---- Worktrees ----
    for (const [id, place] of Object.entries(index)) {
      if (!place) continue;
      out.push({
        id: `wt:${id}`,
        group: "Worktrees",
        label: worktreeLabel(statuses[id]?.branch ?? place.branch, id.slice(0, 7)),
        hint: place.repoName,
        keywords: `${place.repoName} ${place.branch} worktree branch`,
        icon: <GitBranch size={13} />,
        run: () => {
          store.openWorktree(id);
          close();
        },
      });
    }

    for (const id of knownCircles) {
      const names = (circleMembers(id) ?? []).map((m) =>
        worktreeLabel(statuses[m]?.branch ?? index[m]?.branch, m.slice(0, 7)),
      );
      if (names.length === 0) continue;
      out.push({
        id: `circle:${id}`,
        group: "Worktrees",
        label: names.join(" + "),
        hint: `one ${words.agent}, several worktrees`,
        keywords: "shared circle dryad agent",
        icon: <PanelsTopLeft size={13} />,
        run: () => {
          store.openCircle(circleMembers(id) ?? []);
          close();
        },
      });
    }

    // ---- Destinations ----
    out.push(
      {
        id: "go:forest",
        group: "Go to",
        label: words.workspace,
        hint: hasForest ? "every worktree on one map" : "every worktree in one table",
        icon: hasForest ? <Trees size={13} /> : <LayoutGrid size={13} />,
        run: () => {
          store.setView("workspace");
          void api.setFocus(null);
          store.setPaneWorktree(null);
          close();
        },
      },
      {
        id: "go:fleet",
        group: "Go to",
        label: "Fleet",
        hint: "every worktree's changes at once",
        icon: <Layers size={13} />,
        keywords: "digest changes review all uncommitted",
        run: () => {
          store.setView("fleet");
          close();
        },
      },
      {
        id: "go:grove",
        group: "Go to",
        label: words.grove,
        hint: `the ${words.agent} that belongs to no worktree`,
        icon: hasForest ? <Flower2 size={13} /> : <Bot size={13} />,
        run: () => {
          store.setView("grove");
          close();
        },
      },
      {
        id: "go:tools",
        group: "Go to",
        label: "Tools",
        hint: "free a port, read a timestamp",
        icon: <Wrench size={13} />,
        keywords: "kill port lsof listening timestamp epoch convert utility",
        run: () => {
          store.setView("tools");
          close();
        },
      },
      {
        id: "go:settings",
        group: "Go to",
        label: "Settings",
        icon: <Settings size={13} />,
        keywords: "preferences model effort sound shell",
        run: () => {
          store.setView("settings");
          close();
        },
      },
      {
        id: "go:help",
        group: "Go to",
        label: "Help",
        keywords: "how does shortcuts about",
        run: () => {
          onHelp();
          close();
        },
      },
    );

    // ---- The pane you're in ----
    if (pane && targetId) {
      for (const tab of TABS) {
        out.push({
          id: `tab:${tab}`,
          group: "This pane",
          label: `Go to ${TAB_LABEL[tab]}`,
          icon: tab === "terminal" ? <SquareTerminal size={13} /> : undefined,
          keywords: tab,
          run: () => {
            store.setPaneTab(tab);
            close();
          },
        });
      }

      for (const file of pane.files) {
        out.push({
          id: `open:${file.worktreeId}:${file.path}`,
          group: "This pane",
          label: `Switch to ${leafOf(file.path)}`,
          hint: file.path,
          keywords: "open file tab",
          icon: <FileCode2 size={13} />,
          run: () => {
            store.setActiveFile(fileKey(file));
            store.setPaneTab("files");
            close();
          },
        });
      }
    }

    // ---- Actions ----
    if (targetId && targetId !== GROVE_ID && members.length > 0) {
      out.push(
        {
          id: "act:pull",
          group: "Actions",
          label: "Pull",
          hint: members.length > 1 ? "every worktree here" : undefined,
          icon: <ArrowDown size={13} />,
          keywords: "git fetch merge",
          run: () => {
            for (const id of members) void api.pull(id).catch(() => {});
            close();
          },
        },
        {
          id: "act:push",
          group: "Actions",
          label: "Push",
          hint: members.length > 1 ? "every worktree here" : undefined,
          icon: <ArrowUp size={13} />,
          keywords: "git send remote",
          run: () => {
            for (const id of members) void api.push(id, false).catch(() => {});
            close();
          },
        },
        {
          id: "act:stage-all",
          group: "Actions",
          label: "Stage everything",
          icon: <GitBranch size={13} />,
          keywords: "git add index",
          run: () => {
            for (const id of members) void api.stage(id, "all").catch(() => {});
            close();
          },
        },
        {
          id: "act:terminal",
          group: "Actions",
          label: "New terminal",
          icon: <SquareTerminal size={13} />,
          keywords: "shell open",
          run: () => {
            const first = members[0];
            if (first) {
              void api.openTerminal(first).then((info) => {
                useSylva.getState().setTerminal(info);
                store.setPaneTab("terminal");
              });
            }
            close();
          },
        },
      );
    }

    out.push(
      {
        id: "act:sidebar",
        group: "Actions",
        label: sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar",
        icon: <PanelLeft size={13} />,
        keywords: "rail collapse expand",
        run: () => {
          store.toggleSidebar();
          close();
        },
      },
      {
        id: "act:memory",
        group: "Actions",
        label: `Search the ${words.agentsPossessive} memory`,
        hint: "who touched a file, or said a thing",
        icon: <Search size={13} />,
        keywords: "transcript history who touched find said",
        run: () => {
          // Pre-filled with the file being read, when there is one: that is
          // nearly always what the question is about.
          const file = pane.files.find((f) => fileKey(f) === pane.activeFile);
          store.openTranscriptSearch(pane.tab === "files" && file ? file.path : "");
        },
      },
    );

    const waiting = attentionQueue(store);
    if (waiting[0]) {
      const next = waiting[0];
      out.push({
        id: "act:attention",
        group: "Actions",
        label: `Go to the next ${words.agent} needing you (${waiting.length})`,
        hint:
          next.reason === "blocked"
            ? "waiting on a permission"
            : next.reason === "errored"
              ? "ended in an error"
              : "finished a turn",
        keywords: "blocked permission waiting attention next",
        run: () => {
          if (next.worktreeId === GROVE_ID) store.setView("grove");
          else store.openWorktree(next.worktreeId);
          close();
        },
      });
    }

    return out;
  }, [
    files,
    index,
    statuses,
    knownCircles,
    pane,
    targetId,
    members,
    sidebarCollapsed,
    onHelp,
    words,
    hasForest,
  ]);

  const results = useMemo(() => rank(commands, query), [commands, query]);

  // A shrinking result list must not leave the highlight past the end of it.
  useEffect(() => {
    setCursor((c) => (c >= results.length ? 0 : c));
  }, [results.length]);

  // Keep the highlighted row in view as the arrows walk past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".cmd-row-on")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const close = () => useSylva.getState().setPalette(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      results[cursor]?.run();
    }
  };

  return (
    <div
      className="cmd-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmd-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to a worktree, a file, a tab — or do something"
          aria-label="Search commands and files"
          spellCheck={false}
        />

        <div className="cmd-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmd-empty">Nothing matches that.</div>
          ) : (
            renderGrouped(results, cursor, setCursor)
          )}
        </div>

        <div className="cmd-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

const TAB_LABEL: Record<Tab, string> = {
  agent: "Agent",
  files: "Files",
  git: "Git",
  terminal: "Terminal",
};

/** Rows under their group headings, with one running index for the cursor. */
function renderGrouped(
  results: Command[],
  cursor: number,
  setCursor: (n: number) => void,
): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last: string | null = null;

  results.forEach((command, i) => {
    if (command.group !== last) {
      last = command.group;
      out.push(
        <div className="cmd-group" key={`g:${command.group}:${i}`}>
          {command.group}
        </div>,
      );
    }
    out.push(
      <button
        key={command.id}
        className={`cmd-row ${i === cursor ? "cmd-row-on" : ""}`}
        onMouseMove={() => setCursor(i)}
        onClick={() => command.run()}
      >
        <span className="cmd-icon">{command.icon}</span>
        <span className="cmd-label">{command.label}</span>
        {command.hint && <span className="cmd-hint">{command.hint}</span>}
      </button>,
    );
  });

  return out;
}

function leafOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Rank by subsequence match, the way every quick-open you have used works:
 * "wtp" finds "WorktreePane". Matches that are contiguous, that start a word,
 * or that start the label at all score higher, because those are the ones you
 * meant — a scattered match across a long path is technically a match and
 * almost never the answer.
 */
export function score(text: string, query: string): number {
  if (!query) return 1;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let at = 0;
  let points = 0;
  let previous = -2;

  for (const char of needle) {
    const found = haystack.indexOf(char, at);
    if (found === -1) return 0;
    if (found === previous + 1) points += 3; // running on from the last hit
    const before = found === 0 ? "" : haystack[found - 1];
    if (found === 0) points += 5;
    else if (before === "/" || before === "-" || before === "_" || before === " ") points += 4;
    points += 1;
    previous = found;
    at = found + 1;
  }

  // Shorter haystacks win ties: "api.ts" beats "some/deep/path/api.test.ts".
  return points + Math.max(0, 40 - haystack.length) / 40;
}

function rank(commands: Command[], query: string): Command[] {
  const trimmed = query.trim();
  const scored = commands
    .map((command) => ({
      command,
      // The hint is searchable but weighted below the label — you type what you
      // can see, and the label is the part you were reading.
      score: Math.max(
        score(command.label, trimmed),
        score(command.hint ?? "", trimmed) * 0.6,
        score(command.keywords ?? "", trimmed) * 0.5,
      ),
    }))
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return GROUP_ORDER.indexOf(a.command.group) - GROUP_ORDER.indexOf(b.command.group);
  });

  // With no query there is nothing to rank by, so the natural grouping stands.
  if (!trimmed) {
    return commands
      .slice()
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
      .slice(0, 40);
  }
  return scored.slice(0, 40).map((entry) => entry.command);
}

/** A file hit from the server, with the worktree it came from. */
interface FileHit {
  worktreeId: string;
  path: string;
}

/**
 * Files matching what has been typed, across everything the pane holds.
 *
 * Debounced, and only once there is something to search for: an empty palette
 * should not set a filesystem walk going in every open worktree.
 */
function useFileSearch(members: string[], query: string): FileHit[] {
  const memberKey = members.join(",");
  const [hits, setHits] = useState<FileHit[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const ids = memberKey ? memberKey.split(",") : [];
    const timer = window.setTimeout(() => {
      void Promise.all(
        ids.map((id) =>
          api
            .searchFiles(id, trimmed)
            .then((res) => res.results.map((r) => ({ worktreeId: id, path: r.path })))
            .catch((): FileHit[] => []),
        ),
      ).then((groups) => {
        // A slow answer for an old query must not replace a newer one.
        if (!cancelled) setHits(groups.flat().slice(0, 12));
      });
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberKey, query]);

  return hits;
}
