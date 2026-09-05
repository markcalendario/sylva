import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  FolderGit2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { circleMembers, type Repo, type Worktree } from "sylva-shared";
import { api } from "../lib/api";
import { hasPrefix, worktreeLabel } from "../lib/branch";
import { confirm } from "../lib/confirm";
import { useWords } from "../lib/theme";
import { useInvalidate, useRepos, useWorktrees } from "../lib/queries";
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  orderWorktrees,
  spriteStateFor,
  useSylva,
} from "../state/store";
import { Sprite } from "../sprites/Sprite";
import { NewWorktreeDialog } from "./dialogs/NewWorktreeDialog";
import { RegisterRepoDialog } from "./dialogs/RegisterRepoDialog";
import { RemoveWorktreeDialog } from "./dialogs/RemoveWorktreeDialog";

/**
 * What a row needs to be draggable, handed down from the list that owns the
 * order. The row knows how to *look* mid-drag; only the list knows what the
 * order is or what moving something means.
 */
interface DragHandlers {
  /** This row is the one being carried. */
  lifting: boolean;
  /** The carried row would land here. */
  dropping: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Reordering a list of worktrees by dragging.
 *
 * HTML5 drag rather than pointer maths, for the same reason the editor tabs
 * use it: the browser draws the ghost, handles the escape key and the drop
 * outside, and gives it back to the OS if you drag it somewhere else.
 *
 * The order is the ids in their current on-screen order — not indices — so a
 * list that changes underneath the drag (a worktree removed elsewhere, a
 * fetch landing) can't move the wrong row.
 */
function useReorder(repoId: string, ids: string[]) {
  const [carrying, setCarrying] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = ids.filter((id) => id !== from);
    const at = next.indexOf(to);
    if (at === -1) return;
    // Dropping onto a row puts the carried one where that row was: dragging
    // down lands after it, dragging up lands before it, which is what the
    // pointer looks like it is doing either way.
    const above = ids.indexOf(from) < ids.indexOf(to);
    next.splice(above ? at + 1 : at, 0, from);
    useSylva.getState().setWorktreeOrder(repoId, next);
  };

  return (id: string): DragHandlers => ({
    lifting: carrying === id,
    dropping: over === id && carrying !== null && carrying !== id,
    onDragStart: (e) => {
      setCarrying(id);
      e.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag with an empty payload.
      e.dataTransfer.setData("text/plain", id);
    },
    onDragEnd: () => {
      setCarrying(null);
      setOver(null);
    },
    onDragOver: (e) => {
      if (!carrying) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e) => {
      e.preventDefault();
      if (carrying) move(carrying, id);
      setCarrying(null);
      setOver(null);
    },
  });
}

function WorktreeRow({
  worktree,
  onRemove,
  collapsed = false,
  repoName,
  drag,
}: {
  worktree: Worktree;
  onRemove: (worktree: Worktree) => void;
  /** Just the dryad, in the narrow rail. */
  collapsed?: boolean;
  repoName?: string;
  /** Reordering, when the list this row is in can be reordered. */
  drag?: DragHandlers;
}) {
  const words = useWords();
  // "Open" means "held by the pane" — as itself, or inside a circle — and only
  // while the workspace is the thing on screen. In the grove or the settings
  // the pane is still holding a worktree, but it isn't what you are looking at,
  // and a lit row saying otherwise is a lie.
  const open = useSylva((s) => {
    if (s.view !== "workspace") return false;
    const held = s.pane.worktreeId;
    if (!held) return false;
    return held === worktree.id || (circleMembers(held)?.includes(worktree.id) ?? false);
  });
  const spriteState = useSylva((s) => spriteStateFor(s, worktree.id));
  const unseen = useSylva((s) => s.unseenActivity[worktree.id] ?? false);
  const selection = useSylva((s) => s.selection);
  const dirtyCount = useSylva((s) => {
    const st = s.statuses[worktree.id];
    return st ? st.staged.length + st.unstaged.length + st.untracked.length : 0;
  });
  // Live status wins over the fetched list: it arrives first after a checkout.
  const liveBranch = useSylva((s) => s.statuses[worktree.id]?.branch);
  const branch = liveBranch ?? worktree.branch;
  /* The leaf is what this worktree is *called*; the branch is what git calls
     it. Both are on the row, because a sidebar of `feature/…` is a column you
     have to read past the prefix to use, and a sidebar with the prefix gone
     entirely can't tell you which of two `login` branches you're looking at. */
  const label = worktreeLabel(branch, `${worktree.head.slice(0, 7)}`);
  const detached = !branch;

  const selecting = selection !== null;
  const picked = selection?.includes(worktree.id) ?? false;

  const activate = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const store = useSylva.getState();
    const wantsSet = e.shiftKey || e.metaKey || e.ctrlKey;
    // Once picking, a plain click keeps picking — you are mid-gesture, and
    // making you hold shift for every one of them would be tiresome.
    if (selecting) store.toggleSelection(worktree.id);
    else if (wantsSet) store.beginSelection(worktree.id);
    else store.openWorktree(worktree.id);
  };

  if (collapsed) {
    // Collapsing hides the names, not the forest: the dryads are the part you
    // watch, and losing them was losing the reason to glance left at all.
    return (
      <button
        className={`rail-tree ${open ? "focused" : ""} ${picked ? "wt-picked" : ""}`}
        onClick={activate}
        aria-pressed={selecting ? picked : undefined}
        data-tip={`${repoName ? `${repoName} / ` : ""}${branch ?? "detached"}${
          selecting ? ` · click to add to the shared ${words.agent}` : ""
        }`}
      >
        <Sprite state={spriteState} scale={1} title={label} />
        {unseen && !open && <span className="rail-dot" />}
        {dirtyCount > 0 && <span className="rail-count">{dirtyCount}</span>}
      </button>
    );
  }

  return (
    <div
      className={`wt-row ${open ? "focused" : ""} ${picked ? "wt-picked" : ""} ${
        drag?.dropping ? "wt-row-drop" : ""
      } ${drag?.lifting ? "wt-row-lift" : ""}`}
      draggable={drag ? !selecting : undefined}
      onDragStart={drag?.onDragStart}
      onDragEnd={drag?.onDragEnd}
      onDragOver={drag?.onDragOver}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag?.onDrop}
    >
      <button
        className="wt-open"
        onClick={activate}
        aria-pressed={selecting ? picked : undefined}
        data-tip={
          selecting
            ? picked
              ? "Picked — click to drop it from the set"
              : `Click to add this worktree to the shared ${words.agent}`
            : `${branch ?? "detached"} · open it, shift-click to share one ${
                words.agent
              } between several, drag to reorder`
        }
      >
        {selecting ? (
          <span className={`wt-check ${picked ? "wt-check-on" : ""}`} aria-hidden>
            {picked ? <Check size={12} strokeWidth={3} /> : null}
          </span>
        ) : (
          <Sprite state={spriteState} scale={1} title={label} />
        )}
        <span className="wt-text">
          <span className="wt-name">
            {label}
            {worktree.isMain && (
              <span className="wt-main-tag" data-tip="The repository's original checkout">
                main
              </span>
            )}
          </span>
          {/* The branch, only when it says something the name doesn't. A row
              for `main` would otherwise carry the word twice. */}
          {(hasPrefix(branch) || detached) && (
            <span className="wt-branch">{detached ? "detached" : branch}</span>
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
          aria-label={`Remove worktree ${label}`}
          onClick={() => onRemove(worktree)}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function RepoGroup({ repo, collapsed = false }: { repo: Repo; collapsed?: boolean }) {
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

  /* git lists worktrees in the order it made them; you arranged them. */
  const order = useSylva((st) => st.worktreeOrder[repo.id]);
  const trees = useMemo(() => orderWorktrees(listed ?? [], order ?? []), [listed, order]);
  const dragFor = useReorder(
    repo.id,
    trees.map((wt) => wt.id),
  );

  const count = listed?.length ?? 0;
  /** Worktrees in this repo with something uncommitted, for the header. */
  const busy = useSylva(
    (s) =>
      (listed ?? []).filter((wt) => {
        const st = s.statuses[wt.id];
        return st ? st.staged.length + st.unstaged.length + st.untracked.length > 0 : false;
      }).length,
  );

  if (collapsed) {
    if (!repo.available) return null;
    return (
      <div className="rail-group" data-tip={repo.name}>
        {trees.map((wt) => (
          <WorktreeRow
            key={wt.id}
            worktree={wt}
            onRemove={() => {}}
            collapsed
            repoName={repo.name}
          />
        ))}
      </div>
    );
  }

  return (
    <section className={`repo-group ${expanded ? "repo-group-open" : ""}`}>
      <div className="repo-head">
        <button
          className="repo-toggle"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          data-tip={expanded ? "Hide this repo's worktrees" : "Show this repo's worktrees"}
        >
          <ChevronRight size={11} className={`chevron ${expanded ? "open" : ""}`} />
          <FolderGit2 size={11} className="repo-icon" />
          <span className="repo-name">{repo.name}</span>
          {!repo.available && (
            <span className="repo-missing" data-tip="Sylva can't find this repository on disk">
              missing
            </span>
          )}
          {/* The group says how big it is even while shut, so collapsing a repo
              doesn't also hide the fact that there is anything in it. */}
          {repo.available && count > 0 && (
            <span
              className="repo-count"
              data-tip={`${count} worktree${count === 1 ? "" : "s"}${
                busy ? `, ${busy} with uncommitted changes` : ""
              }`}
            >
              {count}
              {busy > 0 && <span className="repo-count-busy" aria-hidden />}
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
              <Plus size={14} />
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
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      {expanded && repo.available && (
        <div className="wt-list">
          {trees.map((wt) => (
            <WorktreeRow key={wt.id} worktree={wt} onRemove={setRemoving} drag={dragFor(wt.id)} />
          ))}
          {count === 0 && !worktrees.isLoading && (
            <div className="side-note side-note-empty">No worktrees yet.</div>
          )}
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
    </section>
  );
}

/** One shared dryad in the sidebar: which trees it tends, and a way back in. */
function CircleRow({ id, collapsed = false }: { id: string; collapsed?: boolean }) {
  const words = useWords();
  const members = circleMembers(id) ?? [];
  const index = useSylva((s) => s.worktreeIndex);
  const open = useSylva((s) => s.view === "workspace" && s.pane.worktreeId === id);
  const spriteState = useSylva((s) => spriteStateFor(s, id));
  const unseen = useSylva((s) => s.unseenActivity[id] ?? false);

  const names = members.map((m) => index[m]?.branch ?? m.slice(0, 7));

  if (collapsed) {
    return (
      <button
        className={`rail-tree rail-circle ${open ? "focused" : ""}`}
        onClick={() => useSylva.getState().openCircle(members)}
        data-tip={`shared · ${names.join(" + ")}`}
      >
        <Sprite state={spriteState} scale={1} title={names.join(" + ")} />
        <span className="rail-count rail-count-shared">{members.length}</span>
        {unseen && !open && <span className="rail-dot" />}
      </button>
    );
  }

  return (
    <div className={`wt-row ${open ? "focused" : ""}`}>
      <button
        className="wt-open"
        onClick={() => useSylva.getState().openCircle(members)}
        data-tip={members
          .map((m) => `${index[m]?.repoName ?? "?"} / ${index[m]?.branch ?? m}`)
          .join("\n")}
      >
        <Sprite state={spriteState} scale={1} title={names.join(" + ")} />
        <span className="wt-name circle-name">{names.join(" + ")}</span>
      </button>
      <span className="wt-meta">
        {unseen && !open && (
          <span className="unseen-dot" data-tip="New agent activity you haven't looked at" />
        )}
        <span className="circle-count" data-tip={`Worktrees this ${words.agent} tends`}>
          {members.length}
        </span>
      </span>
      <button
        className="ghost wt-remove"
        onClick={() => useSylva.getState().forgetCircle(id)}
        aria-label={`Forget the shared ${words.agent} for ${names.join(" and ")}`}
        data-tip="Take this off the list. The conversation is kept — picking the same worktrees again returns to it."
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Shared sessions, above the repositories: they span all of them. */
function SharedGroup({ collapsed = false }: { collapsed?: boolean }) {
  const words = useWords();
  const circles = useSylva((s) => s.knownCircles);
  if (circles.length === 0) return null;

  if (collapsed) {
    return (
      <div className="rail-group rail-group-shared" data-tip={`Shared ${words.agents}`}>
        {circles.map((id) => (
          <CircleRow key={id} id={id} collapsed />
        ))}
      </div>
    );
  }

  return (
    <section className="repo-group repo-group-open">
      <div className="repo-head">
        <span className="repo-toggle repo-shared-head">
          <Users size={11} />
          <span className="repo-name">shared</span>
          <span className="repo-count" data-tip={`${words.agents} tending more than one worktree`}>
            {circles.length}
          </span>
        </span>
      </div>
      <div className="wt-list">
        {circles.map((id) => (
          <CircleRow key={id} id={id} />
        ))}
      </div>
    </section>
  );
}

/**
 * The edge you drag to make the rail wider or narrower.
 *
 * Pointer capture rather than window listeners: it keeps the drag attached to
 * this element even when the pointer outruns it — which it will, because the
 * whole gesture is moving faster than a 4px target — and it ends cleanly if the
 * pointer leaves the window entirely.
 *
 * It is also a real control for the keyboard: a separator you can focus and
 * nudge with the arrows, since a 4px drag target is not reachable otherwise.
 */
function SidebarResizer() {
  const width = useSylva((s) => s.sidebarWidth);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Left button only; a right-click here should open the context menu.
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // Measured from the window's left edge, which is where the sidebar starts.
    // Reading the pointer rather than accumulating deltas means a drag that
    // hits the clamp and comes back doesn't arrive somewhere else.
    useSylva.getState().setSidebarWidth(e.clientX);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  return (
    <div
      className={`sidebar-resizer ${dragging ? "sidebar-resizer-on" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => setDragging(false)}
      // Back to where it started, the way a dragged divider always is.
      onDoubleClick={() => useSylva.getState().setSidebarWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          useSylva.getState().setSidebarWidth(width - step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          useSylva.getState().setSidebarWidth(width + step);
        }
      }}
      data-tip="Drag to resize · double-click to reset"
    />
  );
}

/**
 * What to do with the worktrees you've picked. Appears only while picking, and
 * says how many, because "share a dryad" is meaningless with one.
 */
function SelectionBar() {
  const words = useWords();
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
            ? `One ${words.agent} tends all of these, and can carry what it learns between them`
            : `Pick at least two worktrees to share a ${words.agent}`
        }
      >
        Share {words.agent === "dryad" ? "a dryad" : "an agent"}
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
  const words = useWords();
  const repos = useRepos();
  const [showRegister, setShowRegister] = useState(false);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const collapsed = useSylva((s) => s.sidebarCollapsed);
  const width = useSylva((s) => s.sidebarWidth);
  const invalidate = useInvalidate();
  /**
   * Nothing in this list is what you're looking at.
   *
   * The grove, the fleet and the settings all cover the pane without emptying
   * it, so the rail keeps describing a worktree that is no longer on screen.
   * Draining the colour out of the dryads says "none of these" in the one place
   * you'd look to find out.
   */
  const away = useSylva((s) => s.view !== "workspace");

  if (collapsed) {
    return (
      <aside className={`sidebar sidebar-collapsed ${away ? "sidebar-away" : ""}`}>
        <button
          className="sidebar-toggle"
          onClick={() => useSylva.getState().toggleSidebar()}
          aria-label="Show the sidebar"
          data-tip={`Show the ${words.workspace.toLowerCase()}`}
        >
          <PanelLeftOpen size={16} />
        </button>
        <div className="rail-scroll">
          <SharedGroup collapsed />
          {repos.data?.map((r) => (
            <RepoGroup key={r.id} repo={r} collapsed />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className={`sidebar ${away ? "sidebar-away" : ""}`} style={{ width }}>
      <div className="sidebar-head">
        <span className="sidebar-label" data-tip="Every repository you've registered with Sylva">
          {words.workspace.toLowerCase()}
        </span>
        <button
          className="sidebar-toggle"
          onClick={() => useSylva.getState().toggleSidebar()}
          aria-label="Hide the sidebar"
          data-tip={`Hide the ${words.workspace.toLowerCase()} and give the space to your work`}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className="sidebar-scroll">
        <SharedGroup />
        {repos.data?.map((r) => (
          <RepoGroup key={r.id} repo={r} />
        ))}
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
      <SidebarResizer />
    </aside>
  );
}
