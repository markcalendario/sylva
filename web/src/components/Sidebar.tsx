import { useState } from "react";
import type { Repo, Worktree } from "sylva-shared";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useInvalidate, useRepos, useWorktrees } from "../lib/queries";
import { spriteStateFor, useSylva } from "../state/store";
import { Sprite } from "../sprites/Sprite";
import { NewWorktreeDialog } from "./dialogs/NewWorktreeDialog";
import { RegisterRepoDialog } from "./dialogs/RegisterRepoDialog";
import { RemoveWorktreeDialog } from "./dialogs/RemoveWorktreeDialog";

function WorktreeRow({
  worktree,
  onRemove,
}: {
  worktree: Worktree;
  onRemove: (worktree: Worktree) => void;
}) {
  const focused = useSylva((s) => s.focusedWorktreeId) === worktree.id;
  const spriteState = useSylva((s) => spriteStateFor(s, worktree.id));
  const unseen = useSylva((s) => s.unseenActivity[worktree.id] ?? false);
  const dirtyCount = useSylva((s) => {
    const st = s.statuses[worktree.id];
    return st ? st.staged.length + st.unstaged.length + st.untracked.length : 0;
  });

  return (
    <div className={`wt-row ${focused ? "focused" : ""}`}>
      <button
        className="wt-open"
        onClick={() => void api.setFocus(worktree.id)}
        data-tip="Open this worktree and work in it"
      >
        <Sprite state={spriteState} scale={1} title={worktree.branch ?? "detached"} />
        <span className="wt-name" data-tip="Branch checked out in this worktree">
          {worktree.branch ?? `${worktree.head.slice(0, 7)} (detached)`}
          {worktree.isMain && (
            <span className="wt-main-tag" data-tip="The repository's original checkout">
              main worktree
            </span>
          )}
        </span>
      </button>
      <span className="wt-meta">
        {unseen && !focused && (
          <span className="unseen-dot" data-tip="New agent activity you haven't looked at" />
        )}
        {dirtyCount > 0 && (
          <span className="dirty-count" data-tip="Files changed but not committed">
            {dirtyCount}
          </span>
        )}
      </span>
      {!worktree.isMain && (
        <button
          className="ghost wt-remove"
          data-tip="Delete this worktree's folder; the branch stays"
          aria-label={`Remove worktree ${worktree.branch ?? worktree.path}`}
          onClick={() => onRemove(worktree)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function RepoGroup({ repo }: { repo: Repo }) {
  const [expanded, setExpanded] = useState(true);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [removing, setRemoving] = useState<Worktree | null>(null);
  const worktrees = useWorktrees(repo.id);
  const invalidate = useInvalidate();

  return (
    <div className="repo-group">
      <div className="repo-head">
        <button
          className="repo-toggle"
          onClick={() => setExpanded((e) => !e)}
          data-tip={expanded ? "Hide this repo's worktrees" : "Show this repo's worktrees"}
        >
          <span className={`chevron ${expanded ? "open" : ""}`}>▸</span>
          <span className="repo-name">{repo.name}</span>
          {!repo.available && (
            <span className="repo-missing" data-tip="Sylva can't find this repository on disk">
              missing
            </span>
          )}
        </button>
        {repo.available && (
          <div className="repo-actions">
            <button
              className="ghost"
              data-tip="Grow a new worktree in this repository"
              onClick={() => setShowNewWorktree(true)}
            >
              +
            </button>
            <button
              className="ghost"
              data-tip="Forget this repo — the folder on disk is untouched"
              onClick={() => {
                void confirm({
                  title: `Forget ${repo.name}?`,
                  body: "Sylva stops tracking this repository. The folder on disk, its branches and its worktrees are all left exactly as they are.",
                  confirmLabel: "Forget it",
                  tone: "danger",
                }).then((ok) => {
                  if (ok) void api.removeRepo(repo.id).then(() => invalidate.repos());
                });
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      {expanded && repo.available && (
        <div className="wt-list">
          {worktrees.data?.map((wt) => (
            <WorktreeRow key={wt.id} worktree={wt} onRemove={setRemoving} />
          ))}
          {worktrees.isError && <div className="side-note">Couldn't list worktrees</div>}
        </div>
      )}
      <NewWorktreeDialog
        repo={repo}
        open={showNewWorktree}
        onClose={() => {
          setShowNewWorktree(false);
          invalidate.worktrees(repo.id);
        }}
      />
      {removing && (
        <RemoveWorktreeDialog
          key={removing.id}
          worktree={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

export function Sidebar() {
  const repos = useRepos();
  const [showRegister, setShowRegister] = useState(false);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const invalidate = useInvalidate();

  return (
    <aside className="sidebar">
      <div className="sidebar-label" data-tip="Every repository you've registered with Sylva">
        forest
      </div>
      <div className="sidebar-scroll">
        {repos.data?.map((r) => <RepoGroup key={r.id} repo={r} />)}
        {repos.data?.length === 0 && (
          <div className="side-note">No repositories yet — plant one below.</div>
        )}
      </div>
      <div className="sidebar-foot">
        <button
          className="btn-primary"
          onClick={() => setShowNewWorktree(true)}
          data-tip="Check out a branch in its own folder and open it"
        >
          ✦ New worktree
        </button>
        <button
          className="btn-quiet"
          onClick={() => setShowRegister(true)}
          data-tip="Add a git repository from this machine to Sylva"
        >
          + Register repo
        </button>
      </div>
      <RegisterRepoDialog
        open={showRegister}
        onClose={() => {
          setShowRegister(false);
          invalidate.repos();
        }}
      />
      <NewWorktreeDialog
        open={showNewWorktree}
        onClose={() => {
          setShowNewWorktree(false);
          invalidate.worktrees();
        }}
      />
    </aside>
  );
}
