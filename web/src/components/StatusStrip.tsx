import { GitBranch } from "lucide-react";
import { compactTokens } from "../lib/format";
import { useSylva } from "../state/store";
import { UsageMeter } from "./UsageMeter";

export function StatusStrip({ onAbout }: { onAbout: () => void }) {
  // Follows the active pane, which is what "the worktree you're looking at"
  // means once there can be two of them.
  const worktreeId = useSylva(
    (s) => s.panes.find((p) => p.id === s.activePaneId)?.worktreeId ?? null
  );
  const status = useSylva((s) =>
    worktreeId ? s.statuses[worktreeId] : undefined
  );
  const session = useSylva((s) =>
    worktreeId ? s.sessions[worktreeId] : undefined
  );

  const dirty = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  return (
    <footer className="statusstrip">
      {/* First, not last. The plan window is the one fact here that is true
          whatever is open, and it is the one you want to catch without going
          looking — so it leads the strip rather than trailing off the far end
          of it, where a wide window puts it half a screen from your eyes. */}
      <UsageMeter />

      {!worktreeId || !status ? (
        <span
          className="strip-item"
          data-tip="Open a worktree to see its git status here">
          no worktree open
        </span>
      ) : (
        <>
          <span
            className="strip-branch"
            data-tip="Branch checked out in this worktree">
            <GitBranch size={12} />
            {status.branch ?? "detached"}
          </span>
          {status.upstream && (
            <span
              className="strip-item"
              data-tip={`Commits ahead ↑ and behind ↓ ${status.upstream}`}>
              ↑{status.ahead} ↓{status.behind}
            </span>
          )}
          <span
            className="strip-item"
            data-tip={
              dirty === 0
                ? "Nothing uncommitted here"
                : "Files changed but not committed"
            }>
            {dirty === 0 ? "clean" : `${dirty} dirty`}
          </span>
          {session && (
            <span
              className="strip-item strip-usage"
              data-tip={`${session.totalTokens.toLocaleString()} tokens read and written by this worktree's dryad`}>
              {compactTokens(session.totalTokens)}
            </span>
          )}
        </>
      )}

      {/* A signature belongs at the bottom of the window, not on the wordmark —
          which people expect to take them home, and now does. */}
      <button
        className="strip-credit"
        onClick={onAbout}
        data-tip="What Sylva is, and who built it">
        jello
      </button>
    </footer>
  );
}
