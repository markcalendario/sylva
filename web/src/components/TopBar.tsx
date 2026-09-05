import {
  Bot,
  CircleHelp,
  Flower2,
  Layers,
  LayoutGrid,
  Settings,
  Trees,
  Wrench,
} from "lucide-react";
import { circleMembers, GROVE_ID } from "sylva-shared";
import { api } from "../lib/api";
import { worktreeLabel } from "../lib/branch";
import { useHasForest, useWords } from "../lib/theme";
import type { Words } from "../lib/words";
import { useSylva, type View } from "../state/store";
import { AudioControls } from "./AudioControls";
import { BrandMark } from "./BrandMark";

interface Destination {
  key: View | "help";
  label: string;
  icon: typeof Trees;
  tip: string;
}

/*
 * The header's destinations.
 *
 * Built per theme rather than declared once, because the first two are the two
 * places the metaphor actually lives: a conifer labelled "Forest" and a flower
 * labelled "Grove" are a promise about what the page will look like, and in a
 * theme with no wood in it that promise is broken before the click lands.
 * Everything after them is the same in both.
 */
function destinations(words: Words, hasForest: boolean): Destination[] {
  return [
    {
      key: "workspace",
      label: words.workspace,
      icon: hasForest ? Trees : LayoutGrid,
      tip: "Every worktree across every repository",
    },
    {
      key: "fleet",
      label: "Fleet",
      icon: Layers,
      tip: "Every worktree's uncommitted changes, on one screen",
    },
    {
      key: "grove",
      label: words.grove,
      icon: hasForest ? Flower2 : Bot,
      tip: `A ${words.agent} that belongs to no worktree, and can read every repository`,
    },
    {
      key: "tools",
      label: "Tools",
      icon: Wrench,
      tip: "Odd jobs that aren't about a worktree — freeing a port, reading a timestamp",
    },
    {
      key: "settings",
      label: "Settings",
      icon: Settings,
      tip: "Appearance, sound, the run command and agent defaults",
    },
    { key: "help", label: "Help", icon: CircleHelp, tip: "How Sylva works" },
  ];
}
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
  const words = useWords();
  const hasForest = useHasForest();
  const connection = useSylva((s) => s.connection);
  const view = useSylva((s) => s.view);
  const paneWorktreeId = useSylva((s) => s.pane.worktreeId);
  // Select the map itself, never a derived array: a fresh array each call
  // changes the snapshot identity on every render and spins the loop.
  const pendingPermissions = useSylva((s) => s.pendingPermissions);

  const blocked = Object.entries(pendingPermissions)
    .filter(([, reqs]) => reqs.length > 0)
    .map(([worktreeId]) => worktreeId);

  const where = useWhere(view === "workspace" ? paneWorktreeId : null);
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

  const goHome = () => {
    store.setView("workspace");
    void api.setFocus(null);
    store.setPaneWorktree(null);
  };

  const go = (key: Destination["key"]) => {
    if (key === "help") onHelp();
    else if (key === "workspace") goHome();
    else store.setView(key);
  };

  const currentKey: Destination["key"] | null =
    view === "settings"
      ? "settings"
      : view === "grove"
        ? "grove"
        : view === "fleet"
          ? "fleet"
          : view === "tools"
            ? "tools"
            : where
              ? null
              : "workspace";

  return (
    <header className="topbar">
      {/* The wordmark goes home. Credits live at the bottom of the window,
          where a signature belongs. */}
      <button
        className="brand"
        onClick={goHome}
        data-tip={`Back to the ${words.workspace.toLowerCase()}`}
      >
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
          <span className="crumb-branch" data-tip={`Branch in the active pane: ${where.branch}`}>
            {worktreeLabel(where.branch, where.branch)}
          </span>
        </nav>
      )}

      <div className="topbar-gap" />

      <nav className="dests" aria-label="Go to">
        {destinations(words, hasForest).map(({ key, label, icon: Icon, tip }) => (
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
              ? `A ${words.agent} is waiting for a permission decision — click to answer`
              : `${blocked.length} ${words.agents} are waiting for permission decisions — click to answer the first`
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
 *
 * A circle is neither: its id is in no index and has no status of its own, so
 * asking those two questions about it returned "… / …", which is how the header
 * ended up showing an ellipsis exactly when you were in a shared worktree.
 */
function useWhere(worktreeId: string | null): { repo: string; branch: string } | null {
  const index = useSylva((s) => s.worktreeIndex);
  const statuses = useSylva((s) => s.statuses);
  if (!worktreeId) return null;

  const members = circleMembers(worktreeId);
  if (members) {
    const names = members.map((id) => statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7));
    return { repo: "shared", branch: names.join(" + ") };
  }

  return {
    repo: index[worktreeId]?.repoName ?? "…",
    branch: statuses[worktreeId]?.branch ?? index[worktreeId]?.branch ?? "…",
  };
}
