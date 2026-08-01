import { Dialog } from "../Dialog";

/**
 * Turning permission checks off is the one action in Sylva that hands an agent
 * unsupervised shell access, so it gets a real dialog rather than a browser
 * confirm — the consequences need room to be read.
 */
export function SkipPermissionDialog({
  open,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="Skip all permission checks?" open={open} onClose={onClose}>
      <p className="dialog-hint">
        The dryad stops asking before it acts in this worktree. It will run any command it decides
        on — including deleting files, rewriting history, and pushing to your remote — without
        showing you an approval first.
      </p>

      <ul className="danger-list">
        <li>Only worth it in a worktree you'd be comfortable throwing away.</li>
        <li>Nothing outside this worktree is protected; the shell can reach your whole machine.</li>
        <li>The current session restarts, but the conversation carries over.</li>
      </ul>

      <p className="dialog-hint">You can switch back to asking permission at any time.</p>

      <div className="dialog-actions">
        <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
          Keep asking
        </button>
        <button type="button" className="btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Switching…" : "Skip permissions"}
        </button>
      </div>
    </Dialog>
  );
}
