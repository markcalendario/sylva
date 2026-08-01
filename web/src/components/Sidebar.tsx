import { useState } from "react";
import type { Repo, Worktree } from "sylva-shared";
import { api } from "../lib/api";
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
      <button className="wt-open" onClick={() => void api.setFocus(worktree.id)}>
        <Sprite state={spriteState} scale={1} title={worktree.branch ?? "detached"} />
        <span className="wt-name">
          {worktree.branch ?? `${worktree.head.slice(0, 7)} (detached)`}
          {worktree.isMain && <span className="wt-main-tag">main worktree</span>}
        </span>
      </button>
      <span className="wt-meta">
        {unseen && !focused && <span className="unseen-dot" title="New activity" />}
        {dirtyCount > 0 && <span className="dirty-count">{dirtyCount}</span>}
      </span>
      {!worktree.isMain && (
        <button
          className="ghost wt-remove"
          title="Remove worktree"
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
        <button className="repo-toggle" onClick={() => setExpanded((e) => !e)}>
          <span className={`chevron ${expanded ? "open" : ""}`}>▸</span>
          <span className="repo-name">{repo.name}</span>
          {!repo.available && <span className="repo-missing">missing</span>}
        </button>
        {repo.available && (
          <div className="repo-actions">
            <button
              className="ghost"
              title="New worktree"
              onClick={() => setShowNewWorktree(true)}
            >
              +
            </button>
            <button
              className="ghost"
              title="Remove from Sylva (files stay on disk)"
              onClick={() => {
                if (confirm(`Remove ${repo.name} from Sylva? The repository on disk is untouched.`)) {
                  void api.removeRepo(repo.id).then(() => invalidate.repos());
                }
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
      <div className="sidebar-label">forest</div>
      <div className="sidebar-scroll">
        {repos.data?.map((r) => <RepoGroup key={r.id} repo={r} />)}
        {repos.data?.length === 0 && (
          <div className="side-note">No repositories yet — plant one below.</div>
        )}
      </div>
      <div className="sidebar-foot">
        <button className="btn-primary" onClick={() => setShowNewWorktree(true)}>
          ✦ New worktree
        </button>
        <button className="btn-quiet" onClick={() => setShowRegister(true)}>
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
