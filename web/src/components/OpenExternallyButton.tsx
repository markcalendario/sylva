import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Code2, FolderOpen, SquareTerminal } from "lucide-react";
import {
  EDITOR_TARGETS,
  TERMINAL_TARGETS,
  type AppPreferences,
  type OpenKind,
  type OpenTarget,
} from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { usePreferences } from "../lib/queries";
import { useSylva } from "../state/store";

/**
 * What this machine calls the thing that shows a folder.
 *
 * Read off the browser rather than configured, because there is exactly one
 * per platform and a setting with a single right answer is not a setting. The
 * fallback is the generic name, which is wrong nowhere.
 */
function fileBrowserName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac OS X|Macintosh/.test(ua)) return "Finder";
  if (/Windows/.test(ua)) return "File Explorer";
  return "your file manager";
}

/**
 * What this machine calls its own terminal.
 *
 * Same reasoning as the file browser: the platform decides, so nobody should
 * have to type it. A terminal chosen by name in Settings answers for itself.
 */
function systemTerminalName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac OS X|Macintosh/.test(ua)) return "Terminal";
  if (/Windows/.test(ua)) return "Windows Terminal";
  return "your terminal";
}

/**
 * Hands a worktree directory to your editor, your terminal, or the desktop.
 *
 * The Terminal tab covers nearly every shell you want — already in the right
 * worktree, already beside the diff — so the editor is what this button is
 * mostly for. The other two are for when a tab isn't the thing: your own
 * terminal, in its own window, for a full-screen TUI or a build you want to
 * keep watching after Sylva is closed; and the folder itself, for dropping a
 * file in or attaching something to a message.
 *
 * Which editor is chosen here rather than in Settings. It used to be a select
 * on a page you visit once and then never think about again, three screens away
 * from the button it governs — and "open this somewhere else" is a thing you
 * decide at the moment of opening, not in advance.
 *
 * The editor is still the click; everything else is behind the caret, because
 * the editor is what you want nine times in ten and a menu in front of it would
 * be a tax on all nine.
 *
 * A shared dryad tends several worktrees and "open the worktree" needs exactly
 * one — so with several the actions ask which. It stays in the header either
 * way: this is something you do to a worktree, not to its git.
 */
export function OpenExternallyButtons({ members }: { members: string[] }) {
  const prefs = usePreferences();
  const qc = useQueryClient();
  const index = useSylva((s) => s.worktreeIndex);
  const statuses = useSylva((s) => s.statuses);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  /** The custom command while it is being typed, before it is committed. */
  const [draftCommand, setDraftCommand] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  // A menu that outlives the click which opened it is a menu you have to fight.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!groupRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const open = async (worktreeId: string, kind: OpenKind) => {
    setBusy(true);
    setError(null);
    setMenu(false);
    try {
      await api.openExternally(worktreeId, kind);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open this worktree");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Write one preference back.
   *
   * The whole object goes up because that is the shape the endpoint takes, so
   * this reads the current one first rather than assembling a partial and
   * quietly resetting whatever it left out.
   */
  const savePrefs = async (patch: Partial<AppPreferences>) => {
    const current = prefs.data;
    if (!current) return;
    setError(null);
    try {
      await api.setPreferences({ ...current, ...patch });
      void qc.invalidateQueries({ queryKey: ["preferences"] });
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't save that");
    }
  };

  const editorTarget = prefs.data?.editorTarget ?? "vscode";
  const editorCommand = prefs.data?.editorCommand ?? "";
  // With the editor switched off there is still a folder to show, so the
  // button stays — it just has one thing left to do.
  const editorOn = editorTarget !== "none";
  if (members.length === 0) return null;

  const many = members.length > 1;
  const nameOf = (id: string) => statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7);
  const editorName =
    editorTarget === "custom"
      ? "your editor"
      : (EDITOR_TARGETS.find((t) => t.id === editorTarget)?.label ?? "your editor");
  const browser = fileBrowserName();
  const terminalTarget = prefs.data?.terminalApp ?? "system";
  const terminalOn = terminalTarget !== "none";
  const terminalName =
    terminalTarget === "system"
      ? systemTerminalName()
      : terminalTarget === "custom"
        ? "your terminal"
        : (TERMINAL_TARGETS.find((t) => t.id === terminalTarget)?.label ?? "your terminal");

  const chooseEditor = (target: OpenTarget) => {
    setDraftCommand(target === "custom" ? editorCommand : null);
    void savePrefs({ editorTarget: target });
  };

  /** One action, as one row per worktree when a dryad tends several. */
  const rows = (kind: OpenKind, label: string, icon: React.ReactNode) =>
    many ? (
      <div className="wt-launch-section" key={kind}>
        <span className="wt-launch-section-head">{label}</span>
        {members.map((id) => (
          <button
            key={`${kind}:${id}`}
            role="menuitem"
            className="wt-launch-item"
            onClick={() => void open(id, kind)}
            data-tip={index[id]?.repoName ?? id}
          >
            {icon}
            <span className="wt-launch-repo">{index[id]?.repoName ?? "worktree"}</span>
            <code className="wt-launch-branch">{nameOf(id)}</code>
          </button>
        ))}
      </div>
    ) : (
      <button
        key={kind}
        role="menuitem"
        className="wt-launch-item"
        onClick={() => members[0] && void open(members[0], kind)}
        data-tip={
          kind === "editor"
            ? `Open this worktree in ${editorName}`
            : kind === "terminal"
              ? `Open this worktree in ${terminalName}`
              : `Show the worktree folder in ${browser}`
        }
      >
        {icon}
        <span className="wt-launch-item-label">{label}</span>
      </button>
    );

  return (
    <div className="wt-launch-group" ref={groupRef}>
      <div className="wt-launch-slot">
        <div className="wt-launch-split">
          {editorOn && (
            <button
              className="btn-quiet wt-launch wt-launch-main"
              onClick={() => {
                if (many) setMenu(!menu);
                else if (members[0]) void open(members[0], "editor");
              }}
              disabled={busy}
              aria-haspopup={many ? "menu" : undefined}
              aria-expanded={many ? menu : undefined}
              data-tip={
                many
                  ? `Open one of these worktrees in ${editorName}`
                  : `Open this worktree in ${editorName}`
              }
            >
              <Code2 size={15} />
              Code
            </button>
          )}
          <button
            className={`btn-quiet wt-launch wt-launch-toggle ${editorOn ? "" : "wt-launch-alone"}`}
            onClick={() => setMenu(!menu)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label="Choose an editor, or open this worktree another way"
            data-tip={
              terminalOn
                ? `Pick an editor, or open this worktree in ${terminalName} or ${browser}`
                : `Pick an editor, or show the folder in ${browser}`
            }
          >
            {!editorOn && <FolderOpen size={15} />}
            {!editorOn && "Open"}
            <span className="wt-launch-caret" aria-hidden>
              ▾
            </span>
          </button>
        </div>

        {menu && (
          <div className="wt-launch-menu" role="menu">
            <div className="wt-launch-section">
              <span className="wt-launch-section-head">editor</span>
              {EDITOR_TARGETS.map((choice) => (
                <button
                  key={choice.id}
                  role="menuitemradio"
                  aria-checked={choice.id === editorTarget}
                  className={`wt-launch-item wt-launch-choice ${
                    choice.id === editorTarget ? "wt-launch-choice-on" : ""
                  }`}
                  onClick={() => chooseEditor(choice.id)}
                  data-tip={choice.note}
                >
                  <span className="wt-launch-tick" aria-hidden>
                    {choice.id === editorTarget && <Check size={12} />}
                  </span>
                  <span className="wt-launch-item-label">{choice.label}</span>
                </button>
              ))}

              {editorTarget === "custom" && (
                <form
                  className="wt-launch-command"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void savePrefs({ editorCommand: draftCommand ?? editorCommand });
                    setDraftCommand(null);
                  }}
                >
                  <input
                    className="mono-input"
                    value={draftCommand ?? editorCommand}
                    placeholder="code {path}"
                    autoFocus
                    onChange={(e) => setDraftCommand(e.target.value)}
                    data-tip="{path} is replaced with the worktree directory. Run directly, never through a shell."
                  />
                  <button type="submit" className="btn-quiet" data-tip="Use this command">
                    Set
                  </button>
                </form>
              )}
            </div>

            {editorOn && rows("editor", `Open in ${editorName}`, <Code2 size={13} />)}
            {terminalOn &&
              rows("terminal", `Open in ${terminalName}`, <SquareTerminal size={13} />)}
            {rows("reveal", `Show in ${browser}`, <FolderOpen size={13} />)}
          </div>
        )}
      </div>

      {error && (
        <span className="wt-launch-error" role="alert" data-tip="Check the command you set">
          {error}
        </span>
      )}
    </div>
  );
}
