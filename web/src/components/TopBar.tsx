import { api } from "../lib/api";
import { useSylva } from "../state/store";
import { AudioControls } from "./AudioControls";

export function TopBar({
  onAbout,
  onGlobalSettings,
  onHelp,
}: {
  onAbout: () => void;
  onGlobalSettings: () => void;
  onHelp: () => void;
}) {
  const connection = useSylva((s) => s.connection);
  const focused = useSylva((s) => s.focusedWorktreeId);
  // Select the map itself, never a derived array: a fresh array each call
  // changes the snapshot identity on every render and spins the loop.
  const pendingPermissions = useSylva((s) => s.pendingPermissions);

  const blocked = Object.entries(pendingPermissions)
    .filter(([, reqs]) => reqs.length > 0)
    .map(([worktreeId]) => worktreeId);

  const connTip =
    connection === "connected"
      ? "Live connection to the Sylva server is healthy"
      : connection === "connecting"
        ? "Opening the live connection to the Sylva server"
        : "Connection lost — retrying in the background";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="wordmark" onClick={onAbout} data-tip="What Sylva is, and who built it">
          <span className="wordmark-glyph">✦</span> SYLVA
        </button>
        {focused && (
          <button
            className="btn-quiet topbar-forest"
            onClick={() => void api.setFocus(null)}
            data-tip="Leave this worktree and see the whole forest"
          >
            ⌂ Forest
          </button>
        )}
      </div>
      <div className="topbar-right">
        {/* An agent waiting on a decision is the one thing that stalls silently,
            so it gets a standing seat in the chrome rather than a toast. */}
        {blocked.length > 0 && (
          <button
            className="topbar-blocked"
            onClick={() => blocked[0] && void api.setFocus(blocked[0])}
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
        <button
          className="topbar-settings"
          onClick={onHelp}
          data-tip="How Sylva works — worktrees, sessions, settings"
        >
          ? Help
        </button>
        <button
          className="topbar-settings"
          onClick={onGlobalSettings}
          data-tip="Agent defaults, sound and text size"
        >
          ⚙ Settings
        </button>
        <div className={`conn conn-${connection}`} data-tip={connTip}>
          <span className="conn-dot" />
          {connection === "connected"
            ? "connected"
            : connection === "connecting"
              ? "connecting…"
              : "reconnecting…"}
        </div>
      </div>
    </header>
  );
}
