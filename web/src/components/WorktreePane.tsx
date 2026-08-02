import { useEffect } from "react";
import { Columns2, PanelsTopLeft, X } from "lucide-react";
import { circleMembers } from "sylva-shared";
import { api } from "../lib/api";
import { spriteStateFor, useSylva, type Pane, type Tab } from "../state/store";
import { Sprite } from "../sprites/Sprite";
import { AgentPanel } from "./AgentPanel";
import { FilesPanel } from "./FilesPanel";
import { GitPanel } from "./GitPanel";
import { RunPanel } from "./RunPanel";
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
  /** The session this pane talks to: a worktree, or a circle of them. */
  const targetId = pane.worktreeId;
  const members = targetId ? circleMembers(targetId) : null;
  /**
   * The worktree the file-shaped tabs act on. A circle has no files of its own —
   * a diff belongs to exactly one worktree — so those tabs follow a chosen
   * member while the chat keeps addressing the whole circle.
   */
  const worktreeId = members ? (pane.memberId ?? members[0] ?? null) : targetId;

  const active = useSylva((s) => s.activePaneId) === pane.id;
  const spriteState = useSylva((s) => (targetId ? spriteStateFor(s, targetId) : "idle"));
  const status = useSylva((s) => (worktreeId ? s.statuses[worktreeId] : undefined));
  const session = useSylva((s) => (targetId ? s.sessions[targetId] : undefined));
  const runner = useSylva((s) => (worktreeId ? s.runners[worktreeId] : undefined));
  const index = useSylva((s) => s.worktreeIndex);

  // The session belongs to the target; a circle's transcript is its own.
  useEffect(() => {
    if (!targetId) return;
    void api.transcript(targetId).then((events) => {
      useSylva.getState().setTranscript(targetId, events);
    });
    void api.session(targetId).then(({ session, pendingPermissions, availability }) => {
      useSylva.getState().setSession(targetId, session);
      useSylva.getState().setPermissions(targetId, pendingPermissions);
      useSylva.getState().setAvailability(availability);
    });
  }, [targetId]);

  // Git status and the file feed belong to a real worktree, which for a circle
  // is whichever member is currently being looked at.
  useEffect(() => {
    if (!worktreeId) return;
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

  if (!targetId || !worktreeId) {
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
            {members ? (
              <span className="wt-circle-title" data-tip="One dryad tends all of these">
                <PanelsTopLeft size={14} />
                {members.length} worktrees, one dryad
              </span>
            ) : (
              (status?.branch ?? "…")
            )}
          </div>
          <div className="wt-header-sub">
            {members && (
              /* Which worktree the file-shaped tabs are pointed at. The chat is
                 unaffected — it always addresses the whole circle. */
              <span className="wt-members" role="group" aria-label="Worktree in view">
                {members.map((id) => (
                  <button
                    key={id}
                    className={`wt-member ${id === worktreeId ? "wt-member-on" : ""}`}
                    onClick={() => store.setPaneMember(pane.id, id)}
                    data-tip={`Point Files, Git and Run at ${index[id]?.repoName ?? "this worktree"}`}
                  >
                    {index[id]?.branch ?? id.slice(0, 7)}
                  </button>
                ))}
              </span>
            )}
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
        <div className="pane-controls">
          {split ? (
            <button
              className="ghost"
              onClick={() => store.closePane(pane.id)}
              data-tip="Close this pane"
              aria-label="Close pane"
            >
              <X size={14} />
            </button>
          ) : (
            <button
              className="ghost"
              onClick={() => store.splitPane()}
              data-tip="Show two worktrees side by side"
              aria-label="Split the workspace"
            >
              <Columns2 size={14} />
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
