import { useSylva } from "../state/store";

export function StatusStrip() {
  const worktreeId = useSylva((s) => s.focusedWorktreeId);
  const status = useSylva((s) => (worktreeId ? s.statuses[worktreeId] : undefined));
  const session = useSylva((s) => (worktreeId ? s.sessions[worktreeId] : undefined));

  if (!worktreeId || !status) {
    return (
      <footer
        className="statusstrip statusstrip-empty"
        data-tip="Open a worktree to see its git status here"
      >
        no worktree focused
      </footer>
    );
  }

  const dirty = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <footer className="statusstrip">
      <span className="strip-branch" data-tip="Branch checked out in this worktree">
        ⎇ {status.branch ?? "detached"}
      </span>
      {status.upstream && (
        <span
          className="strip-item"
          data-tip={`Commits ahead ↑ and behind ↓ ${status.upstream}`}
        >
          ↑{status.ahead} ↓{status.behind}
        </span>
      )}
      <span
        className="strip-item"
        data-tip={dirty === 0 ? "Nothing uncommitted here" : "Files changed but not committed"}
      >
        {dirty === 0 ? "clean" : `${dirty} dirty`}
      </span>
      {session && (
        <span
          className="strip-item strip-cost"
          data-tip="What this worktree's agent session has cost so far"
        >
          ✦ ${session.totalCostUsd.toFixed(3)}
        </span>
      )}
    </footer>
  );
}
