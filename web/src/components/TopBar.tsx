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

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="wordmark" onClick={onAbout} title="About Sylva">
          <span className="wordmark-glyph">✦</span> SYLVA
        </button>
        {focused && (
          <button
            className="btn-quiet topbar-forest"
            onClick={() => void api.setFocus(null)}
            title="Show every worktree"
          >
            ⌂ Forest
          </button>
        )}
      </div>
      <div className="topbar-right">
        <AudioControls compact />
        <button className="topbar-settings" onClick={onGlobalSettings} title="Settings">
          ⚙ Settings
        </button>
        <div className={`conn conn-${connection}`}>
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
