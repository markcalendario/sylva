import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api, ApiFailure } from "../lib/api";

/**
 * Open this file the way double-clicking it would.
 *
 * Sylva can already show you a file two ways — the diff, and the editor in the
 * Files tab — and both of them are text. A .png, a .pdf, a .xlsx, a .sqlite are
 * all files git will happily tell you have changed and none of them are things
 * a text pane can answer a question about. So this asks the desktop instead:
 * `open` on a Mac, the shell handler on Windows, `xdg-open` elsewhere. No
 * application is named at either end — the OS already knows which program owns
 * a `.psd`, and Sylva has no business having an opinion about it.
 *
 * Failure is quiet but not silent. A missing `xdg-open`, a file the agent
 * deleted between the render and the click: the icon goes red and its tooltip
 * becomes the reason, and callers with somewhere better to put a sentence —
 * the Git panel has a feedback strip — are handed it through `onError`.
 */
export function OpenFileButton({
  worktreeId,
  path,
  className = "git-icon",
  onError,
}: {
  worktreeId: string;
  /** Relative to the worktree, exactly as git and the change lists spell it. */
  path: string;
  className?: string;
  onError?: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clearing = useRef<number | undefined>(undefined);

  // The timeout outlives the row when a list re-renders under it, and firing
  // setState into an unmounted component is how a warning becomes a habit.
  useEffect(() => () => window.clearTimeout(clearing.current), []);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.openExternally(worktreeId, "system", path);
    } catch (e) {
      const message =
        e instanceof ApiFailure ? (e.detail ?? e.message) : `Couldn't open ${path}`;
      setError(message);
      onError?.(message);
      window.clearTimeout(clearing.current);
      // Long enough to read, short enough that a row you come back to later
      // isn't still complaining about something you have since fixed.
      clearing.current = window.setTimeout(() => setError(null), 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`${className} open-file-btn ${error ? "open-file-bad" : ""}`}
      disabled={busy}
      onClick={() => void open()}
      aria-label={`Open ${path} in the app this machine uses for it`}
      data-tip={error ?? "Open this file in whatever app this machine uses for it"}
    >
      <ExternalLink size={12} />
    </button>
  );
}
