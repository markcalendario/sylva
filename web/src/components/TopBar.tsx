import { GROVE_ID } from "sylva-shared";
import { api } from "../lib/api";
import { useSylva } from "../state/store";
import { AudioControls } from "./AudioControls";

/**
 * The nav bar, in three zones: who and where you are, where you can go, and
 * what is happening right now. Controls used to sit in the order they were
 * added, which put "connection status" and "settings" next to each other and
 * left no room to say which worktree you were even looking at.
 */
export function TopBar({ onAbout, onHelp }: { onAbout: () => void; onHelp: () => void }) {
  const connection = useSylva((s) => s.connection);
  const view = useSylva((s) => s.view);
  const panes = useSylva((s) => s.panes);
  const activePaneId = useSylva((s) => s.activePaneId);
  // Select the map itself, never a derived array: a fresh array each call
  // changes the snapshot identity on every render and spins the loop.
  const pendingPermissions = useSylva((s) => s.pendingPermissions);

  const blocked = Object.entries(pendingPermissions)
    .filter(([, reqs]) => reqs.length > 0)
    .map(([worktreeId]) => worktreeId);

  const activeWorktreeId =
    panes.find((p) => p.id === activePaneId)?.worktreeId ?? panes[0]?.worktreeId ?? null;
  const where = useWhere(activeWorktreeId);
  const store = useSylva.getState();

  const connTip =
    connection === "connected"
      ? "Live connection to the Sylva server is healthy"
      : connection === "connecting"
        ? "Opening the live connection to the Sylva server"
        : "Connection lost — retrying in the background";

  const goBlocked = (worktreeId: string) => {
    if (worktreeId === GROVE_ID) store.setView("grove");
    else store.openWorktree(worktreeId);
  };

  return (
    <header className="topbar">
      {/* Who, and where. */}
      <div className="topbar-zone topbar-identity">
        <button className="wordmark" onClick={onAbout} data-tip="What Sylva is, and who built it">
          <span className="wordmark-glyph">✦</span> SYLVA
        </button>
        {view === "workspace" && where && (
          <span className="topbar-where">
            <span className="topbar-where-repo" data-tip="Repository this worktree belongs to">
              {where.repo}
            </span>
            <span className="topbar-where-sep">/</span>
            <span className="topbar-where-branch" data-tip="Branch checked out in the active pane">
              {where.branch}
            </span>
          </span>
        )}
        {view === "settings" && <span className="topbar-where">Settings</span>}
        {view === "grove" && <span className="topbar-where">The grove</span>}
      </div>

      {/* Where you can go. */}
      <nav className="topbar-zone topbar-destinations">
        <button
          className={`topbar-dest ${view === "workspace" && !where ? "topbar-dest-on" : ""}`}
          onClick={() => {
            store.setView("workspace");
            void api.setFocus(null);
            for (const pane of store.panes) store.setPaneWorktree(pane.id, null);
          }}
          data-tip="Leave your worktrees and see the whole forest"
        >
          <span className="topbar-dest-glyph">⌂</span>
          <span className="topbar-dest-label">Forest</span>
        </button>
        <button
          className={`topbar-dest ${view === "grove" ? "topbar-dest-on" : ""}`}
          onClick={() => store.setView("grove")}
          data-tip="Talk to a dryad that belongs to no worktree, and can read every repository"
        >
          <span className="topbar-dest-glyph">✿</span>
          <span className="topbar-dest-label">Grove</span>
        </button>
        <button
          className={`topbar-dest ${view === "settings" ? "topbar-dest-on" : ""}`}
          onClick={() => store.setView("settings")}
          data-tip="Appearance, sound, the run command and agent defaults"
        >
          <span className="topbar-dest-glyph">⚙</span>
          <span className="topbar-dest-label">Settings</span>
        </button>
        <button className="topbar-dest" onClick={onHelp} data-tip="How Sylva works">
          <span className="topbar-dest-glyph">?</span>
          <span className="topbar-dest-label">Help</span>
        </button>
      </nav>

      {/* What is happening. */}
      <div className="topbar-zone topbar-state">
        {/* An agent waiting on a decision is the one thing that stalls silently,
            so it gets a standing seat in the chrome rather than a toast. */}
        {blocked.length > 0 && (
          <button
            className="topbar-blocked"
            onClick={() => blocked[0] && goBlocked(blocked[0])}
            data-tip={
              blocked.length === 1
                ? "A dryad is waiting for a permission decision — click to answer"
                : `${blocked.length} dryads are waiting for permission decisions — click to answer the first`
            }
          >
            <span className="blocked-dot" />
            {blocked.length} waiting
          </button>
        )}
        <AudioControls compact />
        <div className={`conn conn-${connection}`} data-tip={connTip}>
          <span className="conn-dot" />
          <span className="conn-label">
            {connection === "connected"
              ? "connected"
              : connection === "connecting"
                ? "connecting…"
                : "reconnecting…"}
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * Repository and branch for the active pane. The live git status is preferred
 * for the branch — it follows a checkout immediately — with the sidebar's index
 * as the fallback that also knows which repository it came from.
 */
function useWhere(worktreeId: string | null): { repo: string; branch: string } | null {
  const place = useSylva((s) => (worktreeId ? s.worktreeIndex[worktreeId] : undefined));
  const status = useSylva((s) => (worktreeId ? s.statuses[worktreeId] : undefined));
  if (!worktreeId) return null;
  return {
    repo: place?.repoName ?? "…",
    branch: status?.branch ?? place?.branch ?? "…",
  };
}
