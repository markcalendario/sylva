import { useEffect, useMemo } from "react";
import { Columns2, PanelsTopLeft, X } from "lucide-react";
import { circleMembers } from "sylva-shared";
import { api } from "../lib/api";
import { spriteStateFor, useSylva, type Pane, type Tab } from "../state/store";
import { Sprite } from "../sprites/Sprite";
import { AgentPanel } from "./AgentPanel";
import { FilesPanel } from "./FilesPanel";
import { GitPanel } from "./GitPanel";
import { TerminalPanel } from "./TerminalPanel";
import { OpenExternallyButtons } from "./OpenExternallyButton";

const TAB_LABEL: Record<Tab, string> = {
  agent: "Agent",
  files: "Files",
  git: "Git",
  terminal: "Terminal",
};

const TAB_TIP: Record<Tab, string> = {
  agent: "Prompt the dryad and watch it work",
  files: "Live feed of files changing in this worktree",
  git: "Stage, diff, commit, push and pull",
  terminal: "Real shells in this worktree — as many as you need",
};

/**
 * One worktree, with its header and its tabs. Extracted from MainPanel so that
 * two of them can sit side by side — everything below here already took a
 * worktreeId and needed no changes at all.
 */
export function WorktreePane({ pane, split }: { pane: Pane; split: boolean }) {
  /** The session this pane talks to: a worktree, or a circle of them. */
  const targetId = pane.worktreeId;
  const circle = targetId ? circleMembers(targetId) : null;
  /**
   * Every worktree the panels below are about. One entry for an ordinary
   * worktree, which is what keeps this the *same* code path rather than a
   * second one that has to be kept in step.
   */
  const members = useMemo(
    () => circle ?? (targetId ? [targetId] : []),
    [circle?.join(","), targetId],
  );

  const active = useSylva((s) => s.activePaneId) === pane.id;
  const spriteState = useSylva((s) => (targetId ? spriteStateFor(s, targetId) : "idle"));
  const statuses = useSylva((s) => s.statuses);
  const session = useSylva((s) => (targetId ? s.sessions[targetId] : undefined));
  const terminals = useSylva((s) => s.terminals);
  const index = useSylva((s) => s.worktreeIndex);

  // The header still describes a single worktree when there is one.
  const status = circle ? undefined : statuses[members[0] ?? ""];
  const anyLive = Object.values(terminals).some(
    (t) => t.status === "running" && members.includes(t.worktreeId),
  );

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

  // Status and the file feed belong to real worktrees, so they are fetched for
  // every member rather than for whichever one was being pointed at.
  const memberKey = members.join(",");
  useEffect(() => {
    for (const id of memberKey ? memberKey.split(",") : []) {
      void api.status(id).then((st) => useSylva.getState().setStatus(st)).catch(() => {});
      // The watcher only reports changes from the moment it starts, so without
      // this the Files tab is blank until something happens to move.
      void api
        .recentFiles(id)
        .then((events) => useSylva.getState().seedFileFeed(id, events))
        .catch(() => {});
    }
  }, [memberKey]);

  const store = useSylva.getState();
  const focusPane = () => {
    if (!active) store.setActivePane(pane.id);
  };

  if (!targetId || members.length === 0) {
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
            {circle ? (
              <span className="wt-circle-title" data-tip="One dryad tends all of these">
                <PanelsTopLeft size={14} />
                {circle.length} worktrees, one dryad
              </span>
            ) : (
              (status?.branch ?? "…")
            )}
          </div>
          <div className="wt-header-sub">
            {circle && (
              /* What the dryad tends, stated rather than chosen between. The
                 panels below show all of it at once. */
              <span className="wt-members" data-tip="Every worktree this dryad tends">
                {circle
                  .map((id) => statuses[id]?.branch ?? index[id]?.branch ?? id.slice(0, 7))
                  .join("  +  ")}
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
        <OpenExternallyButtons members={members} />
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
          {(["agent", "files", "git", "terminal"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${pane.tab === t ? "tab-on" : ""}`}
              onClick={() => store.setPaneTab(pane.id, t)}
              data-tip={TAB_TIP[t]}
            >
              {TAB_LABEL[t]}
              {t === "terminal" && anyLive && (
                <span className="tab-dot" data-tip="A shell is open and running here" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {pane.tab === "agent" && <AgentPanel worktreeId={targetId} />}
      {pane.tab === "files" && (
        <FilesPanel
          members={members}
          onOpenDiff={(selection) => store.setPaneDiff(pane.id, selection, "git")}
        />
      )}
      {pane.tab === "git" && (
        <GitPanel
          members={members}
          selection={pane.diff}
          onSelect={(selection) => store.setPaneDiff(pane.id, selection)}
        />
      )}
      {pane.tab === "terminal" && <TerminalPanel members={members} />}
    </section>
  );
}
