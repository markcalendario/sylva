import { useEffect } from "react";
import { circleMembers, GROVE_ID } from "sylva-shared";
import { api } from "../lib/api";
import { useRepos } from "../lib/queries";
import { useSylva } from "../state/store";
import { FleetView } from "./FleetView";
import { ForestView } from "./ForestView";
import { GroveView } from "./GroveView";
import { Landing } from "./Landing";
import { SettingsPage } from "./SettingsPage";
import { ToolsView } from "./ToolsView";
import { WorktreePane } from "./WorktreePane";

/**
 * The main area: the workspace (the worktree pane, or the forest when it holds
 * nothing), the settings page, or the grove. The pane persists behind the
 * other views, so leaving settings puts you back exactly where you were.
 */
export function MainPanel({
  onRegister,
  onAbout,
}: {
  onRegister: () => void;
  onAbout: () => void;
}) {
  const repos = useRepos();
  const pane = useSylva((s) => s.pane);
  const view = useSylva((s) => s.view);

  // Tell the server which worktrees have to stay live. Without this the pane is
  // a still photograph: no file feed, no git status, no refresh.
  //
  // A circle is expanded into its members: the circle id names a session, not a
  // worktree, and the server can only watch things that exist on disk.
  const held = pane.worktreeId;
  const openIds = (held ? (circleMembers(held) ?? [held]) : [])
    .filter((id) => id !== GROVE_ID)
    .join(",");
  useEffect(() => {
    void api.setOpenWorktrees(openIds ? openIds.split(",") : []).catch(() => {});
  }, [openIds]);

  /**
   * Whatever is on screen has been seen. Runs on every change to what that is —
   * a pane loading something, the view switching — and again when the tab comes
   * back, since a dryad celebrating into a background tab hasn't been seen by
   * anyone.
   */
  useEffect(() => {
    useSylva.getState().acknowledgeVisible();
  }, [openIds, view]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) useSylva.getState().acknowledgeVisible();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (view === "settings") {
    return (
      <main className="main main-scroll">
        <SettingsPage onAbout={onAbout} onRegister={onRegister} />
      </main>
    );
  }

  if (view === "grove") {
    return (
      <main className="main">
        <GroveView />
      </main>
    );
  }

  if (view === "tools") {
    return (
      <main className="main main-scroll">
        <ToolsView />
      </main>
    );
  }

  if (view === "fleet") {
    return (
      <main className="main main-scroll">
        <FleetView />
      </main>
    );
  }

  // Nothing open: first run gets the landing page, otherwise the map.
  if (pane.worktreeId === null) {
    const hasRepos = (repos.data?.length ?? 0) > 0;
    return (
      <main className="main main-scroll">
        {hasRepos ? <ForestView /> : <Landing onRegister={onRegister} onAbout={onAbout} />}
      </main>
    );
  }

  return (
    <main className="main">
      <WorktreePane pane={pane} />
    </main>
  );
}
