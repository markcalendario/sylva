import { useEffect, useRef, useState } from "react";
import { Code2, SquareTerminal } from "lucide-react";
import type { OpenKind } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { usePreferences } from "../lib/queries";
import { useSylva } from "../state/store";

const LABEL: Record<OpenKind, string> = { editor: "Code", terminal: "Shell" };
const ICON: Record<OpenKind, typeof Code2> = { editor: Code2, terminal: SquareTerminal };
const TIP: Record<OpenKind, string> = {
  editor: "Open this worktree in your editor — pick which one in Settings",
  terminal: "Open a terminal in this worktree — pick which one in Settings",
};
const TIP_MANY: Record<OpenKind, string> = {
  editor: "Open one of these worktrees in your editor",
  terminal: "Open a terminal in one of these worktrees",
};

/**
 * Hands a worktree directory to an external application. Two buttons rather
 * than one: opening the code and opening a shell are different intentions, and
 * having to visit Settings to switch between them made both worse.
 *
 * A shared dryad tends several worktrees and "open the worktree" needs exactly
 * one — so with several the button asks which, rather than vanishing or picking
 * for you. It stays in the header either way: this is something you do to a
 * worktree, not something you do to its git.
 */
export function OpenExternallyButtons({ members }: { members: string[] }) {
  const prefs = usePreferences();
  const index = useSylva((s) => s.worktreeIndex);
  const statuses = useSylva((s) => s.statuses);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<OpenKind | null>(null);
  const [menu, setMenu] = useState<OpenKind | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  // A menu that outlives the click which opened it is a menu you have to fight.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!groupRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const open = async (kind: OpenKind, worktreeId: string) => {
    setBusy(kind);
    setError(null);
    setMenu(null);
    try {
      await api.openExternally(worktreeId, kind);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open this worktree");
    } finally {
      setBusy(null);
    }
  };

  const kinds: OpenKind[] = [];
  if ((prefs.data?.editorTarget ?? "vscode") !== "none") kinds.push("editor");
  if ((prefs.data?.terminalTarget ?? "terminal") !== "none") kinds.push("terminal");
  if (kinds.length === 0 || members.length === 0) return null;

  const many = members.length > 1;
  const nameOf = (id: string) => statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7);

  return (
    <div className="wt-launch-group" ref={groupRef}>
      {kinds.map((kind) => {
        const Icon = ICON[kind];
        return (
          <div key={kind} className="wt-launch-slot">
            <button
              className="btn-quiet wt-launch"
              onClick={() => {
                if (many) setMenu(menu === kind ? null : kind);
                else if (members[0]) void open(kind, members[0]);
              }}
              disabled={busy !== null}
              aria-haspopup={many ? "menu" : undefined}
              aria-expanded={many ? menu === kind : undefined}
              data-tip={many ? TIP_MANY[kind] : TIP[kind]}
            >
              <Icon size={13} />
              {LABEL[kind]}
              {many && (
                <span className="wt-launch-caret" aria-hidden>
                  ▾
                </span>
              )}
            </button>

            {many && menu === kind && (
              <div className="wt-launch-menu" role="menu">
                {members.map((id) => (
                  <button
                    key={id}
                    role="menuitem"
                    className="wt-launch-item"
                    onClick={() => void open(kind, id)}
                    data-tip={index[id]?.repoName ?? id}
                  >
                    <span className="wt-launch-repo">{index[id]?.repoName ?? "worktree"}</span>
                    <code className="wt-launch-branch">{nameOf(id)}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <span className="wt-launch-error" role="alert" data-tip="Check the Open targets in Settings">
          {error}
        </span>
      )}
    </div>
  );
}
