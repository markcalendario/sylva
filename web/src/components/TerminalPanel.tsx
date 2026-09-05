import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { TerminalInfo } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { attachTerminal, disposeTerminal, fitTerminal, focusTerminal } from "../lib/terminals";
import { useSylva } from "../state/store";
import "@xterm/xterm/css/xterm.css";

/**
 * Terminals, in the worktree.
 *
 * This was the Run tab: one stored command per repository, started with a
 * button and read like a log. That answered exactly one question — is the dev
 * server up — and every other question sent you to a real terminal anyway,
 * where you then had to remember which of six directories this branch lives in.
 *
 * So it is a real terminal now, and there can be as many as the work needs: the
 * dev server in one, a test watcher in the next, and one you type in. Starting
 * the dev server is a command you type, like every other command.
 *
 * Which terminal a pane is showing is remembered outside React. Leaving the tab
 * unmounts this panel, and coming back to a different terminal than you left
 * would be the kind of small betrayal that makes a tool feel untrustworthy.
 */
const lastActive = new Map<string, string>();

/**
 * Panes whose terminals you closed on purpose.
 *
 * The tab opens a shell for you the first time you visit it, which is right —
 * and then went on doing it every time you came back, which is not: closing the
 * last terminal is a decision, and a tab that immediately spawns another has
 * overruled it. Remembered across reloads because the terminals themselves
 * survive one; if closing them all didn't, the reload would undo it.
 */
const EMPTIED_KEY = "sylva.terminalsEmptied";

/**
 * Panes already given their one automatic shell in this page session. Outside
 * React because leaving the tab unmounts this panel, and a guard that unmounts
 * with it is a guard that only holds while you stay put.
 */
const autoOpened = new Set<string>();

function loadEmptied(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMPTIED_KEY) ?? "[]") as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

const emptied = loadEmptied();

function rememberEmptied(memberKey: string, deliberate: boolean): void {
  if (deliberate === emptied.has(memberKey)) return;
  if (deliberate) emptied.add(memberKey);
  else emptied.delete(memberKey);
  try {
    localStorage.setItem(EMPTIED_KEY, JSON.stringify([...emptied]));
  } catch {
    // Private mode or a full quota; it just won't survive a reload.
  }
}

/** How many terminals a pane holds right now, asked of the store. */
function countMine(memberKey: string): number {
  const ids = new Set(memberKey ? memberKey.split(",") : []);
  return Object.values(useSylva.getState().terminals).filter((t) => ids.has(t.worktreeId)).length;
}

export function TerminalPanel({ members }: { members: string[] }) {
  const terminals = useSylva((s) => s.terminals);
  const index = useSylva((s) => s.worktreeIndex);
  const memberKey = members.join(",");
  const shared = members.length > 1;

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(() => lastActive.get(memberKey) ?? null);
  /**
   * The pane whose terminals the server has answered about.
   *
   * Auto-opening waits for this. Without it, a pane that loads straight onto
   * the Terminal tab decides it is empty in the moment before the list arrives,
   * and opens a second shell alongside the one that was already there.
   */
  const [listed, setListed] = useState<string | null>(null);

  /** This pane's terminals, oldest first — the order they were opened in. */
  const mine = useMemo(() => {
    const ids = new Set(memberKey ? memberKey.split(",") : []);
    return Object.values(terminals)
      .filter((t) => ids.has(t.worktreeId))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  }, [terminals, memberKey]);

  // The server is the authority on what exists: it holds the ptys, and they
  // outlive this tab, this pane and this page.
  useEffect(() => {
    let live = true;
    setListed(null);
    const ids = memberKey ? memberKey.split(",") : [];
    void Promise.all(
      ids.map((id) =>
        api
          .terminals(id)
          .then((infos) => {
            for (const info of infos) useSylva.getState().setTerminal(info);
          })
          // A member we couldn't ask about still counts as answered: the pane
          // would otherwise wait forever for a worktree that has gone.
          .catch(() => {}),
      ),
    ).then(() => {
      if (live) setListed(memberKey);
    });
    return () => {
      live = false;
    };
  }, [memberKey]);

  const open = async (worktreeId: string) => {
    setBusy(true);
    setError(null);
    setMenu(false);
    try {
      const info = await api.openTerminal(worktreeId);
      useSylva.getState().setTerminal(info);
      // Asking for a terminal here takes back "I want this pane empty".
      rememberEmptied(memberKey, false);
      select(info.id);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const select = (terminalId: string) => {
    lastActive.set(memberKey, terminalId);
    setActiveId(terminalId);
  };

  const close = async (terminalId: string) => {
    setError(null);
    try {
      await api.closeTerminal(terminalId);
    } catch {
      // Already gone on the server; the local teardown below is what matters.
    }
    useSylva.getState().removeTerminal(terminalId);
    // The scrollback goes with it: closing a terminal is closing what it said,
    // and the server has already dropped its copy.
    disposeTerminal(terminalId);
    // Whether the pane is now empty is a question about what is left, so it is
    // asked afterwards and of the store — not of a count this render captured
    // before two close buttons were clicked in a row.
    rememberEmptied(memberKey, countMine(memberKey) === 0);
  };

  // Arriving at an empty worktree, open one — once, ever. A tab called Terminal
  // that shows no terminal until you ask for one is a tab that makes you ask
  // twice; a tab that opens another every time you come back is worse, because
  // it overrules the last thing you did here.
  useEffect(() => {
    if (shared || busy || !members[0]) return;
    // Not yet told what exists here. Deciding now would be guessing.
    if (listed !== memberKey) return;
    if (mine.length > 0) {
      autoOpened.add(memberKey);
      return;
    }
    // Either this pane has already been given its one free shell, or you closed
    // the last one — which was itself the answer to this question.
    if (autoOpened.has(memberKey) || emptied.has(memberKey)) return;
    autoOpened.add(memberKey);
    void open(members[0]);
  }, [mine.length, members, memberKey, listed, shared, busy]);

  // Keep the selection pointing at something that exists — a terminal closed
  // from another window, or one that was never here, must not leave a blank.
  useEffect(() => {
    if (activeId && mine.some((t) => t.id === activeId)) return;
    const next = mine[mine.length - 1]?.id ?? null;
    if (next) lastActive.set(memberKey, next);
    setActiveId(next);
  }, [activeId, mine, memberKey]);

  const active = mine.find((t) => t.id === activeId) ?? null;

  return (
    <div className="term-panel" onMouseDown={() => menu && setMenu(false)}>
      <div className="term-tabs" role="tablist" aria-label="Terminals">
        {mine.map((info) => (
          <TerminalTab
            key={info.id}
            info={info}
            shared={shared}
            active={info.id === activeId}
            label={shared ? (index[info.worktreeId]?.repoName ?? "worktree") : null}
            onSelect={() => select(info.id)}
            onClose={() => void close(info.id)}
          />
        ))}

        <span className="term-tabs-gap" />

        {/* With several worktrees this asks which, because a terminal is in a
            directory and "this dryad's directory" isn't a thing. */}
        <Launcher
          label="New"
          tip="Open another shell in this worktree"
          icon={<Plus size={13} />}
          members={members}
          menu={menu}
          setMenu={setMenu}
          busy={busy}
          onPick={(id) => void open(id)}
        />
      </div>

      {error && <div className="term-error">{error}</div>}

      {active ? (
        <TerminalView
          key={active.id}
          info={active}
          onOpenAnother={() => void open(active.worktreeId)}
        />
      ) : (
        <div className="term-empty">
          <p>No terminal open here.</p>
          <p className="term-empty-hint">
            New opens a shell in {shared ? "one of these worktrees" : "this worktree"}. It keeps
            running when you leave the tab.
          </p>
        </div>
      )}
    </div>
  );
}

/** One tab: which shell, where it is, and whether it is still alive. */
function TerminalTab({
  info,
  active,
  shared,
  label,
  onSelect,
  onClose,
}: {
  info: TerminalInfo;
  active: boolean;
  shared: boolean;
  label: string | null;
  onSelect: () => void;
  onClose: () => void;
}) {
  const exited = info.status === "exited";
  return (
    <div className={`term-tab ${active ? "term-tab-on" : ""} ${exited ? "term-tab-dead" : ""}`}>
      <button
        role="tab"
        aria-selected={active}
        className="term-tab-name"
        onClick={onSelect}
        data-tip={`${info.shell} in ${info.cwd}`}
      >
        {shared && label && <span className="term-tab-where">{label}</span>}
        <span className="term-tab-title">{info.title}</span>
        {exited ? (
          <span className="term-tab-exit">
            {info.exitCode === null ? "exited" : `exit ${info.exitCode}`}
          </span>
        ) : (
          <span className="term-tab-live" aria-hidden />
        )}
      </button>
      <button
        className="ghost term-tab-close"
        onClick={onClose}
        aria-label={`Close ${info.title}`}
        data-tip="Close this terminal and whatever is running in it"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** A button that opens a terminal, asking which worktree when there are several. */
function Launcher({
  label,
  tip,
  icon,
  members,
  menu,
  setMenu,
  busy,
  onPick,
}: {
  label: string;
  tip: string;
  icon: React.ReactNode;
  members: string[];
  menu: boolean;
  setMenu: (next: boolean) => void;
  busy: boolean;
  onPick: (worktreeId: string) => void;
}) {
  const index = useSylva((s) => s.worktreeIndex);
  const statuses = useSylva((s) => s.statuses);
  const many = members.length > 1;

  return (
    <div className="term-launch">
      <button
        className="btn-quiet term-launch-btn"
        disabled={busy || members.length === 0}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (many) setMenu(!menu);
          else if (members[0]) onPick(members[0]);
        }}
        aria-haspopup={many ? "menu" : undefined}
        aria-expanded={many ? menu : undefined}
        data-tip={tip}
      >
        {icon}
        <span className="term-launch-label">{label}</span>
        {many && <ChevronDown size={11} />}
      </button>

      {many && menu && (
        <div className="term-launch-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
          {members.map((id) => (
            <button
              key={id}
              role="menuitem"
              className="term-launch-item"
              onClick={() => onPick(id)}
            >
              <span className="term-launch-repo">{index[id]?.repoName ?? "worktree"}</span>
              <code className="term-launch-branch">
                {statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7)}
              </code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The emulator, in the pane.
 *
 * It borrows the element the terminal was already drawing into rather than
 * building a new one, so scrollback, selection and cursor position survive
 * every tab switch. Resizing tells the pty its new size — a shell that thinks
 * it has eighty columns in a pane that has forty wraps everything wrongly.
 */
function TerminalView({ info, onOpenAnother }: { info: TerminalInfo; onOpenAnother: () => void }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const detach = attachTerminal(info.id, node);
    focusTerminal(info.id);

    const observer = new ResizeObserver(() => fitTerminal(info.id));
    observer.observe(node);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [info.id]);

  return (
    <div className="term-stage">
      <div className="term-surface" ref={holder} onMouseDown={() => focusTerminal(info.id)} />
      {info.status === "exited" && (
        <div className="term-dead-bar">
          <span>
            {info.shell} exited{info.exitCode === null ? "" : ` · ${info.exitCode}`}. What it said
            is still here.
          </span>
          <button className="btn-quiet" onClick={onOpenAnother} data-tip="Open a fresh shell here">
            New terminal
          </button>
        </div>
      )}
    </div>
  );
}
