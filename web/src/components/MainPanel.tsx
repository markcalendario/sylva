import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { spriteStateFor, useSylva } from "../state/store";
import { Sprite } from "../sprites/Sprite";
import { AgentPanel } from "./AgentPanel";
import { FilesPanel } from "./FilesPanel";
import { GitPanel } from "./GitPanel";
import { PermissionToggle } from "./PermissionToggle";

type Tab = "agent" | "files" | "git";

function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-sprites">
        <Sprite state="idle" scale={4} />
        <Sprite state="working" scale={4} />
        <Sprite state="success" scale={4} />
      </div>
      <h1 className="welcome-title">Welcome to the forest</h1>
      <p className="welcome-copy">
        Each worktree is a tree; each tree has a dryad. Register a repository, pick a worktree in
        the sidebar, or start a task and watch a dryad get to work.
      </p>
    </div>
  );
}

export function MainPanel() {
  const worktreeId = useSylva((s) => s.focusedWorktreeId);
  const spriteState = useSylva((s) => (worktreeId ? spriteStateFor(s, worktreeId) : "idle"));
  const status = useSylva((s) => (worktreeId ? s.statuses[worktreeId] : undefined));
  const session = useSylva((s) => (worktreeId ? s.sessions[worktreeId] : undefined));
  const [tab, setTab] = useState<Tab>("agent");
  const [diffPath, setDiffPath] = useState<string | null>(null);

  // Load transcript + session + status whenever focus changes.
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
  }, [worktreeId]);

  if (!worktreeId) return <main className="main"><Welcome /></main>;

  return (
    <main className="main">
      <div className="wt-header">
        <Sprite state={spriteState} scale={3} />
        <div className="wt-header-text">
          <div className="wt-header-branch">{status?.branch ?? "…"}</div>
          <div className="wt-header-sub">
            {status?.base ? (
              <span className="divergence" title={`Compared with ${status.base.branch}`}>
                <span className={status.base.ahead ? "div-ahead" : "div-zero"}>
                  ↑{status.base.ahead}
                </span>
                <span className={status.base.behind ? "div-behind" : "div-zero"}>
                  ↓{status.base.behind}
                </span>
                <span className="div-base">{status.base.branch}</span>
              </span>
            ) : (
              <span className="div-zero">no base branch to compare</span>
            )}
            <span className="wt-header-state">
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
        {tab === "agent" && <PermissionToggle worktreeId={worktreeId} />}
        <nav className="tabs">
          {(["agent", "files", "git"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>
              {t === "agent" ? "Agent" : t === "files" ? "Files" : "Git"}
            </button>
          ))}
        </nav>
      </div>
      {tab === "agent" && <AgentPanel worktreeId={worktreeId} />}
      {tab === "files" && (
        <FilesPanel
          worktreeId={worktreeId}
          onOpenDiff={(path) => {
            setDiffPath(path);
            setTab("git");
          }}
        />
      )}
      {tab === "git" && (
        <GitPanel key={diffPath ?? "none"} worktreeId={worktreeId} initialDiffPath={diffPath} />
      )}
    </main>
  );
}
