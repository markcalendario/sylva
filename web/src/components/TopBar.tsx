import { useSylva } from "../state/store";

export function TopBar() {
  const connection = useSylva((s) => s.connection);
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="wordmark-glyph">✦</span> SYLVA
      </div>
      <div className={`conn conn-${connection}`}>
        <span className="conn-dot" />
        {connection === "connected"
          ? "connected"
          : connection === "connecting"
            ? "connecting…"
            : "reconnecting…"}
      </div>
    </header>
  );
}
