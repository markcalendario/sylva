import { api } from "../lib/api";
import { useSylva } from "../state/store";
import { AudioControls } from "./AudioControls";

export function TopBar({
  onAbout,
  onGlobalSettings,
}: {
  onAbout: () => void;
  onGlobalSettings: () => void;
}) {
  const connection = useSylva((s) => s.connection);
  const focused = useSylva((s) => s.focusedWorktreeId);

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
        <AudioControls compact />
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
