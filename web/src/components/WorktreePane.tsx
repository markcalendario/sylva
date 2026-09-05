import { useEffect, useMemo, useState } from "react";
import { PanelsTopLeft } from "lucide-react";
import { circleMembers, sessionBusy, type BackgroundTask } from "sylva-shared";
import { api } from "../lib/api";
import { worktreeLabel } from "../lib/branch";
import { tabCycleChord } from "../lib/shortcuts";
import { useWords } from "../lib/theme";
import type { Words } from "../lib/words";
import { spriteStateFor, TABS, useSylva, type Pane, type Tab } from "../state/store";
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

/** Named once, in the tooltips, so the shortcut is findable without the Help. */
const chord = tabCycleChord();

/**
 * Name the work still running when the turn itself is over.
 *
 * "Working" with nothing else said would be a puzzle here — the composer is
 * open and the Stop button is gone, which reads like a mistake until you know
 * that what is working isn't the agent's own turn.
 */
function backgroundTip(tasks: BackgroundTask[]): string {
  const first = tasks[0]?.description;
  if (tasks.length === 1 && first) return `Still running in the background: ${first}`;
  return `${tasks.length} background tasks still running here`;
}

/** What the Agent tab shows about itself while you are somewhere else. */
type AgentTabState = "idle" | "working" | "blocked" | "errored" | "done";

function agentTip(state: AgentTabState, words: Words): string {
  switch (state) {
    case "idle":
      return "No agent is running here";
    case "working":
      return `The ${words.agent} is working right now`;
    case "blocked":
      return `The ${words.agent} is waiting for a permission decision`;
    case "errored":
      return "The last turn ended in an error";
    case "done":
      return "A turn finished here and you haven't read it yet";
  }
}

/**
 * What a tab is carrying, worn on the tab itself.
 *
 * Every one of these was already knowable, and every one of them needed the tab
 * opened to know it — which is the wrong way round for a strip whose whole job
 * is to tell you where to go next. Counts are muted; the Agent's state is the
 * one thing allowed to use colour, because it is the only one that can mean
 * "everything here has stopped until you do something".
 */
function TabBadge({
  tab,
  dirty,
  terminalCount,
  anyLive,
  agentState,
  words,
}: {
  tab: Tab;
  dirty: number;
  terminalCount: number;
  anyLive: boolean;
  agentState: AgentTabState;
  words: Words;
}) {
  if (tab === "agent") {
    // Resting is the ordinary state and needs no mark; a dot for "nothing is
    // happening" is just noise on three tabs out of four.
    if (agentState === "idle") return null;
    const tip = agentTip(agentState, words);
    return <span className={`tab-state tab-state-${agentState}`} data-tip={tip} aria-label={tip} />;
  }

  if (tab === "terminal") {
    if (terminalCount === 0) return null;
    return (
      <span
        className={`tab-count ${anyLive ? "tab-count-live" : ""}`}
        data-tip={
          `${terminalCount} terminal${terminalCount === 1 ? "" : "s"} open here` +
          (anyLive ? " · at least one shell is still running" : "")
        }
      >
        {terminalCount}
      </span>
    );
  }

  if (dirty === 0) return null;
  return (
    <span
      className="tab-count"
      data-tip={`${dirty} uncommitted file${dirty === 1 ? "" : "s"} in this worktree`}
    >
      {dirty}
    </span>
  );
}

const TAB_TIP: Record<Tab, string> = {
  agent: "Prompt the agent and watch it work",
  files: "Live feed of files changing in this worktree",
  git: "Stage, diff, commit, push and pull",
  terminal: "Real shells in this worktree — as many as you need",
};

/** One worktree, with its header and its tabs. */
export function WorktreePane({ pane }: { pane: Pane }) {
  const words = useWords();
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

  const spriteState = useSylva((s) => (targetId ? spriteStateFor(s, targetId) : "idle"));
  const session = useSylva((s) => (targetId ? s.sessions[targetId] : undefined));

  /*
   * Everything below is read as the one number or word it is drawn as, rather
   * than by taking the whole map it comes out of.
   *
   * A pane subscribed to `statuses` re-renders — and re-renders every panel
   * under it — each time any worktree anywhere reports a change, which during
   * a build is several times a second in a worktree you aren't even looking at.
   * A selector that returns a count only wakes the pane when the count moves.
   */
  // The header still describes a single worktree when there is one.
  const status = useSylva((s) => (circle ? undefined : s.statuses[members[0] ?? ""]));

  const terminalCount = useSylva(
    (s) => Object.values(s.terminals).filter((t) => members.includes(t.worktreeId)).length,
  );
  const anyLive = useSylva((s) =>
    Object.values(s.terminals).some(
      (t) => members.includes(t.worktreeId) && t.status === "running",
    ),
  );

  /**
   * Uncommitted files across everything this pane holds. The same number the
   * Files and Git tabs are about, so both wear it — you should be able to tell
   * there is work waiting without opening the tab that holds it.
   */
  const dirty = useSylva((s) =>
    members.reduce((n, id) => {
      const st = s.statuses[id];
      if (!st) return n;
      return n + st.staged.length + st.unstaged.length + st.untracked.length;
    }, 0),
  );

  /**
   * Permissions waiting on an answer here. Keyed by whatever holds the session
   * — a worktree id, or a circle's — so both are asked about, and the set stops
   * an ordinary worktree (which is both) from counting twice.
   */
  const blocked = useSylva((s) =>
    [...new Set([targetId, ...members].filter((id): id is string => !!id))].reduce(
      (n, id) => n + (s.pendingPermissions[id]?.length ?? 0),
      0,
    ),
  );

  /** What a circle tends, as the line the header prints. */
  const circleBranches = useSylva((s) =>
    circle
      ? circle
          .map((id) => s.statuses[id]?.branch ?? s.worktreeIndex[id]?.branch ?? id.slice(0, 7))
          .join("  +  ")
      : "",
  );

  /** What the Agent tab's own indicator says, without opening it. */
  const agentState: AgentTabState =
    blocked > 0
      ? "blocked"
      : sessionBusy(session)
        ? "working"
        : session?.status === "errored"
          ? "errored"
          : spriteState === "success"
            ? "done"
            : "idle";

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
      void api
        .status(id)
        .then((st) => useSylva.getState().setStatus(st))
        .catch(() => {});
      // The watcher only reports changes from the moment it starts, so without
      // this the Files tab is blank until something happens to move.
      void api
        .recentFiles(id)
        .then((events) => useSylva.getState().seedFileFeed(id, events))
        .catch(() => {});
    }
  }, [memberKey]);

  /**
   * Whether the conversation has been looked at in this pane yet.
   *
   * It is kept alive once opened, but not built before then: a pane parked on
   * Git or Files shouldn't pay to render a chat nobody has asked to see. Once
   * true it stays true — that is the whole point.
   */
  const [agentSeen, setAgentSeen] = useState(pane.tab === "agent");
  useEffect(() => {
    if (pane.tab === "agent") setAgentSeen(true);
  }, [pane.tab]);

  const store = useSylva.getState();

  if (!targetId || members.length === 0) {
    return (
      <section className="pane">
        <div className="pane-empty">
          <p>This pane is empty.</p>
          <p className="pane-empty-hint">Pick a worktree in the sidebar to open it here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="pane">
      <div className="wt-header">
        <Sprite state={spriteState} scale={2} />
        <div className="wt-header-text">
          <div
            className="wt-header-branch"
            data-tip={`Branch checked out here: ${status?.branch ?? "unknown"}`}
          >
            {circle ? (
              <span className="wt-circle-title" data-tip={`One ${words.agent} tends all of these`}>
                <PanelsTopLeft size={14} />
                {circle.length} worktrees, one {words.agent}
              </span>
            ) : (
              worktreeLabel(status?.branch, "…")
            )}
          </div>
          <div className="wt-header-sub">
            {circle && (
              /* What the session tends, stated rather than chosen between. The
                 panels below show all of it at once. */
              <span className="wt-members" data-tip={`Every worktree this ${words.agent} tends`}>
                {circleBranches}
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
                  : (session?.backgroundTasks.length ?? 0) > 0
                    ? backgroundTip(session?.backgroundTasks ?? [])
                    : session?.status === "errored"
                      ? "The last turn ended in an error"
                      : spriteState === "success"
                        ? "The last turn finished cleanly"
                        : "No agent is running in this worktree"
              }
            >
              {sessionBusy(session)
                ? `${words.agent} is working`
                : session?.status === "errored"
                  ? `${words.agent} hit trouble`
                  : spriteState === "success"
                    ? "task complete"
                    : "resting"}
            </span>
          </div>
        </div>
        <OpenExternallyButtons members={members} />
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={`tab ${pane.tab === t ? "tab-on" : ""}`}
              onClick={() => store.setPaneTab(t)}
              data-tip={`${TAB_TIP[t]} · ${chord} steps through the tabs`}
            >
              {TAB_LABEL[t]}
              <TabBadge
                tab={t}
                dirty={dirty}
                terminalCount={terminalCount}
                anyLive={anyLive}
                agentState={agentState}
                words={words}
              />
            </button>
          ))}
        </nav>
      </div>

      {/*
        The conversation is kept alive behind the other tabs rather than torn
        down and rebuilt.

        Unmounting it threw away every parsed markdown message and your place in
        the scroll, and going back to Agent paid for all of it again — on a long
        conversation that is a visible stall for a tab you were looking at a
        moment ago. Hidden it costs a layout it was going to need anyway.

        The other three genuinely are better off unmounted: they hold queries
        that would keep refetching for a tab nobody is looking at, and the
        terminal's emulator already lives outside React precisely so that
        leaving the tab costs it nothing.
      */}
      <div className="pane-stage">
        {agentSeen && (
          <div
            className={`pane-layer ${pane.tab === "agent" ? "" : "pane-layer-off"}`}
            aria-hidden={pane.tab !== "agent"}
          >
            <AgentPanel worktreeId={targetId} />
          </div>
        )}

        {pane.tab === "files" && (
          <FilesPanel
            pane={pane}
            members={members}
            onOpenDiff={(selection) => store.setPaneDiff(selection, "git")}
          />
        )}
        {pane.tab === "git" && (
          <GitPanel
            members={members}
            selection={pane.diff}
            onSelect={(selection) => store.setPaneDiff(selection)}
          />
        )}
        {pane.tab === "terminal" && <TerminalPanel members={members} />}
      </div>
    </section>
  );
}
