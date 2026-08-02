import { useEffect } from "react";
import { api } from "../lib/api";
import { spriteStateFor, useSylva, type Pane, type Tab } from "../state/store";
import { Sprite } from "../sprites/Sprite";
import { AgentPanel } from "./AgentPanel";
import { FilesPanel } from "./FilesPanel";
import { GitPanel } from "./GitPanel";
import { RunPanel } from "./RunPanel";
import { AgentSettingsButton } from "./AgentSettingsButton";
import { OpenExternallyButtons } from "./OpenExternallyButton";

const TAB_LABEL: Record<Tab, string> = {
  agent: "Agent",
  files: "Files",
  git: "Git",
  run: "Run",
};

const TAB_TIP: Record<Tab, string> = {
  agent: "Prompt the dryad and watch it work",
  files: "Live feed of files changing in this worktree",
  git: "Stage, diff, commit, push and pull",
  run: "Start this project and watch its output",
};

/**
 * One worktree, with its header and its tabs. Extracted from MainPanel so that
 * two of them can sit side by side — everything below here already took a
 * worktreeId and needed no changes at all.
 */
export function WorktreePane({ pane, split }: { pane: Pane; split: boolean }) {
  const worktreeId = pane.worktreeId;
  const active = useSylva((s) => s.activePaneId) === pane.id;
  const spriteState = useSylva((s) => (worktreeId ? spriteStateFor(s, worktreeId) : "idle"));
  const status = useSylva((s) => (worktreeId ? s.statuses[worktreeId] : undefined));
  const session = useSylva((s) => (worktreeId ? s.sessions[worktreeId] : undefined));
  const runner = useSylva((s) => (worktreeId ? s.runners[worktreeId] : undefined));

  // Load transcript + session + status whenever this pane's worktree changes.
  useEffect(() => {
    if (!worktreeId) return;
    void api.transcript(worktreeId).then((events) => {
      useSylva.getState().setTranscript(worktreeId, events);
    });
    void api.session(worktreeId).then(({ session, pendingPermissions, availability }) => {
      useSylva.getState().setSession(worktreeId, session);
      useSylva.getState().setPermissions(worktreeId, pendingPermissions);
      useSylva.getState().setAvailability(availability);
    });
    void api.status(worktreeId).then((st) => useSylva.getState().setStatus(st));
    // The watcher only reports changes from the moment it starts, so without
    // this the Files tab is blank until something happens to move.
    void api
      .recentFiles(worktreeId)
      .then((events) => useSylva.getState().seedFileFeed(worktreeId, events))
      .catch(() => {});
  }, [worktreeId]);

  const store = useSylva.getState();
  const focusPane = () => {
    if (!active) store.setActivePane(pane.id);
  };

  if (!worktreeId) {
    return (
      <section
        className={`pane ${split && active ? "pane-active" : ""}`}
        onMouseDown={focusPane}
      >
        <div className="pane-empty">
          <p>This pane is empty.</p>
          <p className="pane-empty-hint">
            Pick a worktree in the sidebar to open it here.
          </p>
          {split && (
            <button
              className="btn-quiet"
              onClick={() => store.closePane(pane.id)}
              data-tip="Close this pane and give the space back"
            >
              Close pane
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`pane ${split && active ? "pane-active" : ""}`} onMouseDown={focusPane}>
      <div className="wt-header">
        <Sprite state={spriteState} scale={2} />
        <div className="wt-header-text">
          <div className="wt-header-branch" data-tip="Branch checked out in this worktree">
            {status?.branch ?? "…"}
          </div>
          <div className="wt-header-sub">
            {status?.base ? (
              <span
                className="divergence"
                data-tip={`Commits ahead ↑ and behind ↓ ${status.base.branch}`}
              >
                <span className={status.base.ahead ? "div-ahead" : "div-zero"}>
                  ↑{status.base.ahead}
                </span>
                <span className={status.base.behind ? "div-behind" : "div-zero"}>
                  ↓{status.base.behind}
                </span>
                <span className="div-base">{status.base.branch}</span>
              </span>
            ) : (
              <span className="div-zero" data-tip="No base branch to compare against">
                no base branch to compare
              </span>
            )}
            <span
              className="wt-header-state"
              data-tip={
                session?.status === "running"
                  ? "An agent is running here right now"
                  : session?.status === "errored"
                    ? "The last turn ended in an error"
                    : spriteState === "success"
                      ? "The last turn finished cleanly"
                      : "No agent is running in this worktree"
              }
            >
              {session?.status === "running"
                ? "dryad is working"
                : session?.status === "errored"
                  ? "dryad hit trouble"
                  : spriteState === "success"
                    ? "task complete"
                    : "resting"}
            </span>
          </div>
        </div>
        <OpenExternallyButtons worktreeId={worktreeId} />
        {pane.tab === "agent" && <AgentSettingsButton worktreeId={worktreeId} />}
        <div className="pane-controls">
          {split ? (
            <button
              className="ghost"
              onClick={() => store.closePane(pane.id)}
              data-tip="Close this pane"
              aria-label="Close pane"
            >
              ✕
            </button>
          ) : (
            <button
              className="ghost"
              onClick={() => store.splitPane()}
              data-tip="Work on two worktrees side by side"
              aria-label="Split the workspace"
            >
              ▯▯
            </button>
          )}
        </div>
        <nav className="tabs">
          {(["agent", "files", "git", "run"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${pane.tab === t ? "tab-on" : ""}`}
              onClick={() => store.setPaneTab(pane.id, t)}
              data-tip={TAB_TIP[t]}
            >
              {TAB_LABEL[t]}
              {t === "run" && runner?.status === "running" && (
                <span className="tab-dot" data-tip="This project is running" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {pane.tab === "agent" && <AgentPanel worktreeId={worktreeId} />}
      {pane.tab === "files" && (
        <FilesPanel
          worktreeId={worktreeId}
          onOpenDiff={(path) => store.setPaneDiff(pane.id, path, "git")}
        />
      )}
      {pane.tab === "git" && (
        <GitPanel
          key={pane.diffPath ?? "none"}
          worktreeId={worktreeId}
          initialDiffPath={pane.diffPath}
        />
      )}
      {pane.tab === "run" && <RunPanel worktreeId={worktreeId} />}
    </section>
  );
}
