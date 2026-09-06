import { useEffect, useState } from "react";
import { ExternalLink, GitPullRequest } from "lucide-react";
import { api, type OpenPullRequests } from "../lib/api";
import { Dialog } from "./Dialog";

/**
 * Pull requests already open on this repository.
 *
 * Creating one has never needed an API — the compare URL does it — but there is
 * no way to *read* a list out of a plain git remote, so this needs `gh`. When
 * `gh` can't answer it hands over the repository's pulls page rather than a
 * dead end.
 */
export function OpenPullsButton({
  worktreeId,
  /** So the button can join a cluster it is drawn inside rather than beside. */
  className = "btn-quiet",
}: {
  worktreeId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OpenPullRequests | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setData(null);
    void api
      .openPulls(worktreeId)
      .then(setData)
      .catch(() => setData({ pulls: null, fallbackUrl: null, reason: "Couldn't reach the server." }))
      .finally(() => setLoading(false));
  }, [open, worktreeId]);

  return (
    <>
      <button
        className={`${className} git-pulls-btn`}
        onClick={() => setOpen(true)}
        data-tip="Pull requests already open on this repository"
      >
        <GitPullRequest size={13} />
        PRs
      </button>

      <Dialog title="Open pull requests" open={open} onClose={() => setOpen(false)}>
        {loading && <p className="dialog-hint">Asking GitHub…</p>}

        {!loading && data?.pulls && data.pulls.length === 0 && (
          <p className="dialog-hint">Nothing is open on this repository right now.</p>
        )}

        {!loading && data?.pulls && data.pulls.length > 0 && (
          <ul className="pr-list">
            {data.pulls.map((pr) => (
              <li key={pr.number} className={`pr-row ${pr.isCurrent ? "pr-row-current" : ""}`}>
                <a
                  className="pr-link"
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  data-tip={`Open #${pr.number} on GitHub`}
                >
                  <span className="pr-number">#{pr.number}</span>
                  <span className="pr-title">{pr.title}</span>
                  <ExternalLink size={12} />
                </a>
                <div className="pr-meta">
                  <code className="pr-branch">{pr.branch}</code>
                  {pr.draft && <span className="pr-tag">draft</span>}
                  {/* The one for the branch you're standing on is why you opened this. */}
                  {pr.isCurrent && <span className="pr-tag pr-tag-current">this worktree</span>}
                  {pr.author && <span className="pr-author">{pr.author}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && data && !data.pulls && (
          <>
            <p className="dialog-hint">{data.reason}</p>
            {data.fallbackUrl && (
              <p className="dialog-hint">
                <a href={data.fallbackUrl} target="_blank" rel="noreferrer">
                  Open the pull requests page instead
                </a>
              </p>
            )}
          </>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn-quiet" onClick={() => setOpen(false)} data-tip="Close">
            Close
          </button>
        </div>
      </Dialog>
    </>
  );
}
