import { CircleHelp, Flower2, Settings, Trees } from "lucide-react";
import { GROVE_ID } from "sylva-shared";
import { api } from "../lib/api";
import { useSylva, type View } from "../state/store";
import { AudioControls } from "./AudioControls";
import { BrandMark } from "./BrandMark";

interface Destination {
  key: View | "help";
  label: string;
  icon: typeof Trees;
  tip: string;
}

const DESTINATIONS: Destination[] = [
  { key: "workspace", label: "Forest", icon: Trees, tip: "Every worktree across every repository" },
  {
    key: "grove",
    label: "Grove",
    icon: Flower2,
    tip: "A dryad that belongs to no worktree, and can read every repository",
  },
  { key: "settings", label: "Settings", icon: Settings, tip: "Appearance, sound, the run command and agent defaults" },
  { key: "help", label: "Help", icon: CircleHelp, tip: "How Sylva works" },
];

/**
 * The header.
 *
 * Everything used to be a pill of the same weight — four destinations, the
 * blocked-agent count and the connection state all shouting equally, which is
 * how a header turns into a toolbar. Now there is one loud thing: an agent
 * waiting on you. Destinations are quiet icons that underline where you are,
 * and the connection is a dot you only look at when something is wrong.
 */
export function TopBar({ onHelp }: { onHelp: () => void }) {
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
  const where = useWhere(view === "workspace" ? activeWorktreeId : null);
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

  const goForest = () => {
    store.setView("workspace");
    void api.setFocus(null);
    for (const pane of store.panes) store.setPaneWorktree(pane.id, null);
  };

  const go = (key: Destination["key"]) => {
    if (key === "help") onHelp();
    else if (key === "workspace") goForest();
    else store.setView(key);
  };

  const currentKey: Destination["key"] | null =
    view === "settings" ? "settings" : view === "grove" ? "grove" : where ? null : "workspace";

  return (
    <header className="topbar">
      {/* The wordmark goes home. Credits live at the bottom of the window,
          where a signature belongs. */}
      <button className="brand" onClick={goForest} data-tip="Back to the forest">
        <BrandMark size={19} />
        <span className="brand-word">sylva</span>
      </button>

      {where && (
        <nav className="crumbs" aria-label="Where you are">
          <span className="crumb-repo" data-tip="Repository this worktree belongs to">
            {where.repo}
          </span>
          <span className="crumb-sep" aria-hidden>
            /
          </span>
          <span className="crumb-branch" data-tip="Branch in the active pane">
            {where.branch}
          </span>
        </nav>
      )}

      <div className="topbar-gap" />

      <nav className="dests" aria-label="Go to">
        {DESTINATIONS.map(({ key, label, icon: Icon, tip }) => (
          <button
            key={key}
            className={`dest ${currentKey === key ? "dest-on" : ""}`}
            onClick={() => go(key)}
            aria-current={currentKey === key ? "page" : undefined}
            data-tip={tip}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span className="dest-label">{label}</span>
          </button>
        ))}
      </nav>

      {/* The one loud thing in the bar. An agent waiting on a decision is the
          only failure that is completely silent otherwise. */}
      {blocked.length > 0 && (
        <button
          className="waiting"
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

      <span
        className={`conn-pip conn-${connection}`}
        data-tip={connTip}
        role="status"
        aria-label={connTip}
      />
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
