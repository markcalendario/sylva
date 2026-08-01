import { useSylva } from "../state/store";
import { AudioControls } from "./AudioControls";
import { TextSize } from "./TextSize";

export function TopBar() {
  const connection = useSylva((s) => s.connection);
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="wordmark-glyph">✦</span> SYLVA
      </div>
      <div className="topbar-right">
        <AudioControls />
        <TextSize />
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
