import { useEffect, useRef, useState } from "react";
import { Code2 } from "lucide-react";
import { api, ApiFailure } from "../lib/api";
import { usePreferences } from "../lib/queries";
import { useSylva } from "../state/store";

/**
 * Hands a worktree directory to your editor.
 *
 * There used to be a second button beside it that opened a terminal somewhere
 * else. The Terminal tab is that terminal now — already in the right worktree,
 * already beside the diff — so the only thing left worth leaving for is the
 * editor.
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
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
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

  const open = async (worktreeId: string) => {
    setBusy(true);
    setError(null);
    setMenu(false);
    try {
      await api.openExternally(worktreeId, "editor");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open this worktree");
    } finally {
      setBusy(false);
    }
  };

  if ((prefs.data?.editorTarget ?? "vscode") === "none" || members.length === 0) return null;

  const many = members.length > 1;
  const nameOf = (id: string) => statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7);

  return (
    <div className="wt-launch-group" ref={groupRef}>
      <div className="wt-launch-slot">
        <button
          className="btn-quiet wt-launch"
          onClick={() => {
            if (many) setMenu(!menu);
            else if (members[0]) void open(members[0]);
          }}
          disabled={busy}
          aria-haspopup={many ? "menu" : undefined}
          aria-expanded={many ? menu : undefined}
          data-tip={
            many
              ? "Open one of these worktrees in your editor"
              : "Open this worktree in your editor — pick which one in Settings"
          }
        >
          <Code2 size={13} />
          Code
          {many && (
            <span className="wt-launch-caret" aria-hidden>
              ▾
            </span>
          )}
        </button>

        {many && menu && (
          <div className="wt-launch-menu" role="menu">
            {members.map((id) => (
              <button
                key={id}
                role="menuitem"
                className="wt-launch-item"
                onClick={() => void open(id)}
                data-tip={index[id]?.repoName ?? id}
              >
                <span className="wt-launch-repo">{index[id]?.repoName ?? "worktree"}</span>
                <code className="wt-launch-branch">{nameOf(id)}</code>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <span className="wt-launch-error" role="alert" data-tip="Check the editor in Settings">
          {error}
        </span>
      )}
    </div>
  );
}
