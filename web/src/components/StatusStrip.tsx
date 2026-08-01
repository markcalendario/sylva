import { useSylva } from "../state/store";

export function StatusStrip() {
  const worktreeId = useSylva((s) => s.focusedWorktreeId);
  const status = useSylva((s) => (worktreeId ? s.statuses[worktreeId] : undefined));
  const session = useSylva((s) => (worktreeId ? s.sessions[worktreeId] : undefined));

  if (!worktreeId || !status) {
    return <footer className="statusstrip statusstrip-empty">no worktree focused</footer>;
  }

  const dirty = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <footer className="statusstrip">
      <span className="strip-branch">⎇ {status.branch ?? "detached"}</span>
      {status.upstream && (
        <span className="strip-item" title={`upstream: ${status.upstream}`}>
          ↑{status.ahead} ↓{status.behind}
        </span>
      )}
      <span className="strip-item">{dirty === 0 ? "clean" : `${dirty} dirty`}</span>
      {session && (
        <span className="strip-item strip-cost" title="Session cost">
          ✦ ${session.totalCostUsd.toFixed(3)}
        </span>
      )}
    </footer>
  );
}
