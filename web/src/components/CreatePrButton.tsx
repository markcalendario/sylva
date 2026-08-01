import { useState } from "react";
import type { PullRequestResult } from "sylva-shared";
import { api, ApiFailure } from "../lib/api";
import { Dialog } from "./Dialog";

/** "feature/overworld-map" → "overworld map", a reasonable first draft title. */
function titleFromBranch(branch: string): string {
  return branch.replace(/^[a-z]+\//, "").replaceAll("-", " ").replaceAll("_", " ");
}

/**
 * Opens a pull request for this branch. Pushes first when there's no upstream,
 * because a PR for commits the remote has never seen isn't one.
 */
export function CreatePrButton({
  worktreeId,
  branch,
}: {
  worktreeId: string;
  branch: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullRequestResult | null>(null);

  const start = () => {
    setTitle(branch ? titleFromBranch(branch) : "");
    setBody("");
    setError(null);
    setResult(null);
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPr(worktreeId, { draft, title, body });
      setResult(res);
      // A compare URL is a form to fill in, so it's only useful once opened.
      if (res.via === "compare") window.open(res.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open a pull request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn-quiet"
        onClick={start}
        disabled={!branch}
        data-tip={
          branch
            ? "Open a pull request for this branch"
            : "Detached HEAD — nothing to open a pull request from"
        }
      >
        ⑂ Pull request
      </button>

      <Dialog open={open} title="Open a pull request" onClose={() => setOpen(false)}>
        {result ? (
          <>
            <p className="field-hint">
              {result.via === "gh"
                ? `${result.draft ? "Draft pull request" : "Pull request"} opened.`
                : "`gh` wasn't available, so GitHub's compare page opened with the details filled in."}
            </p>
            <p className="field-hint">
              <a href={result.url} target="_blank" rel="noreferrer noopener">
                {result.url}
              </a>
            </p>
            <div className="dialog-actions">
              <button className="btn-quiet" onClick={() => setOpen(false)}>
                Close
              </button>
              <a
                className="btn-primary"
                href={result.url}
                target="_blank"
                rel="noreferrer noopener"
                data-tip="Open the pull request in your browser"
              >
                View it
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="seg" role="group" aria-label="Pull request kind">
              <button
                className={!draft ? "seg-on" : ""}
                onClick={() => setDraft(false)}
                data-tip="Ready for review straight away"
              >
                Normal
              </button>
              <button
                className={draft ? "seg-on" : ""}
                onClick={() => setDraft(true)}
                data-tip="Opened as a draft — no reviewers requested yet"
              >
                Draft
              </button>
            </div>

            <label className="field">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={branch ?? ""}
                data-tip="Defaults to the branch name"
              />
            </label>

            <label className="field">
              Description
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="What changed, and why."
                data-tip="Becomes the pull request body"
              />
            </label>

            <span className="field-hint">
              The branch is pushed first if it has no upstream. Without `gh` installed, Sylva opens
              GitHub's compare page instead of creating the PR outright.
            </span>

            {error && <p className="form-error">{error}</p>}

            <div className="dialog-actions">
              <button className="btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
                {busy ? "Opening…" : draft ? "Create draft PR" : "Create PR"}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
