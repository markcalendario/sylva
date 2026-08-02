import { useEffect, useState } from "react";
import {
  Check,
  FolderGit2,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { circleMembers, type Repo, type Worktree } from "sylva-shared";
import { api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useLongPress } from "../lib/useLongPress";
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
  // "Open" now means "held by a pane" — as itself, or inside a circle.
  const open = useSylva((s) =>
    s.panes.some(
      (p) =>
        p.worktreeId === worktree.id ||
        (p.worktreeId ? (circleMembers(p.worktreeId)?.includes(worktree.id) ?? false) : false),
    ),
  );
  const spriteState = useSylva((s) => spriteStateFor(s, worktree.id));
  const unseen = useSylva((s) => s.unseenActivity[worktree.id] ?? false);
  const selection = useSylva((s) => s.selection);
  const dirtyCount = useSylva((s) => {
    const st = s.statuses[worktree.id];
    return st ? st.staged.length + st.unstaged.length + st.untracked.length : 0;
  });

  const selecting = selection !== null;
  const picked = selection?.includes(worktree.id) ?? false;
  const press = useLongPress(() => useSylva.getState().beginSelection(worktree.id));

  const activate = (e: { metaKey: boolean; ctrlKey: boolean }) => {
    const store = useSylva.getState();
    // Already picking, or asked to pick with a modifier: this click means
    // "add to the set", not "take me there".
    if (selecting) store.toggleSelection(worktree.id);
    else if (e.metaKey || e.ctrlKey) store.beginSelection(worktree.id);
    else store.openWorktree(worktree.id);
  };

  return (
    <div className={`wt-row ${open ? "focused" : ""} ${picked ? "wt-picked" : ""}`}>
      <button
        className="wt-open"
        onClick={activate}
        {...press}
        aria-pressed={selecting ? picked : undefined}
        data-tip={
          selecting
            ? picked
              ? "Picked — click to drop it from the set"
              : "Click to add this worktree to the shared dryad"
            : "Open this worktree · hold, or ⌘-click, to share a dryad between several"
        }
      >
        {selecting ? (
          <span className={`wt-check ${picked ? "wt-check-on" : ""}`} aria-hidden>
            {picked ? <Check size={12} strokeWidth={3} /> : null}
          </span>
        ) : (
          <Sprite state={spriteState} scale={1} title={worktree.branch ?? "detached"} />
        )}
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
        {unseen && !open && (
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

  // The only place worktrees are listed, so the only place that can say which
  // repository each one belongs to.
  const listed = worktrees.data;
  useEffect(() => {
    if (listed) useSylva.getState().indexWorktrees(repo, listed);
  }, [listed, repo.id, repo.name]);

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

/**
 * What to do with the worktrees you've picked. Appears only while picking, and
 * says how many, because "share a dryad" is meaningless with one.
 */
function SelectionBar() {
  const selection = useSylva((s) => s.selection);
  if (!selection) return null;

  const enough = selection.length >= 2;
  return (
    <div className="selection-bar">
      <span className="selection-count">
        <Users size={13} />
        {selection.length} picked
      </span>
      <button
        className="btn-primary"
        disabled={!enough}
        onClick={() => useSylva.getState().openCircle(selection)}
        data-tip={
          enough
            ? "One dryad tends all of these, and can carry what it learns between them"
            : "Pick at least two worktrees to share a dryad"
        }
      >
        Share a dryad
      </button>
      <button
        className="ghost"
        onClick={() => useSylva.getState().clearSelection()}
        aria-label="Stop picking"
        data-tip="Stop picking worktrees"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Sidebar() {
  const repos = useRepos();
  const [showRegister, setShowRegister] = useState(false);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const collapsed = useSylva((s) => s.sidebarCollapsed);
  const invalidate = useInvalidate();

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button
          className="sidebar-toggle"
          onClick={() => useSylva.getState().toggleSidebar()}
          aria-label="Show the sidebar"
          data-tip="Show the forest"
        >
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-label" data-tip="Every repository you've registered with Sylva">
          forest
        </span>
        <button
          className="sidebar-toggle"
          onClick={() => useSylva.getState().toggleSidebar()}
          aria-label="Hide the sidebar"
          data-tip="Hide the forest and give the space to your work"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className="sidebar-scroll">
        {repos.data?.map((r) => <RepoGroup key={r.id} repo={r} />)}
        {repos.data?.length === 0 && (
          <div className="side-note">No repositories yet — plant one below.</div>
        )}
      </div>
      <div className="sidebar-foot">
        <SelectionBar />
        <button
          className="btn-primary"
          onClick={() => setShowNewWorktree(true)}
          data-tip="Check out a branch in its own folder and open it"
        >
          <Sparkles size={13} /> New worktree
        </button>
        <button
          className="btn-quiet"
          onClick={() => setShowRegister(true)}
          data-tip="Add a git repository from this machine to Sylva"
        >
          <FolderGit2 size={13} /> Add repository
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
