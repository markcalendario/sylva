import { useEffect } from "react";
import { api } from "../lib/api";
import { useRepos } from "../lib/queries";
import { useSylva } from "../state/store";
import { ForestView } from "./ForestView";
import { GroveView } from "./GroveView";
import { Landing } from "./Landing";
import { SettingsPage } from "./SettingsPage";
import { WorktreePane } from "./WorktreePane";

/**
 * The main area: the workspace (one or two worktree panes, or the forest when
 * no pane holds anything), the settings page, or the grove. Panes persist
 * behind the other two views, so leaving settings puts you back exactly where
 * you were.
 */
export function MainPanel({
  onRegister,
  onAbout,
}: {
  onRegister: () => void;
  onAbout: () => void;
}) {
  const repos = useRepos();
  const panes = useSylva((s) => s.panes);
  const view = useSylva((s) => s.view);

  // Tell the server which worktrees have to stay live. Without this the second
  // pane is a still photograph: no file feed, no git status, no refresh.
  const openIds = panes
    .map((p) => p.worktreeId)
    .filter((id): id is string => id !== null)
    .join(",");
  useEffect(() => {
    void api.setOpenWorktrees(openIds ? openIds.split(",") : []).catch(() => {});
  }, [openIds]);

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

  // Nothing open anywhere: first run gets the landing page, otherwise the map.
  const anyOpen = panes.some((p) => p.worktreeId !== null);
  if (!anyOpen) {
    const hasRepos = (repos.data?.length ?? 0) > 0;
    return (
      <main className="main main-scroll">
        {hasRepos ? <ForestView /> : <Landing onRegister={onRegister} onAbout={onAbout} />}
      </main>
    );
  }

  const split = panes.length > 1;
  return (
    <main className={`main ${split ? "main-split" : ""}`}>
      {panes.map((pane) => (
        <WorktreePane key={pane.id} pane={pane} split={split} />
      ))}
    </main>
  );
}
