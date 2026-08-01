import { useEffect, useState } from "react";
import type { DirListing } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { Dialog } from "../Dialog";

/**
 * Folder picker backed by the server's filesystem. A browser file input only
 * ever yields relative names, so choosing a repository has to be done by
 * browsing the machine Sylva runs on.
 */
export function RegisterRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [typedPath, setTypedPath] = useState("");

  const go = (path?: string) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    api
      .browse(path)
      .then(setListing)
      .catch((e) => {
        if (e instanceof ApiFailure) {
          setError(e.message);
          setDetail(e.detail ?? null);
        } else {
          setError("Couldn't open that folder");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open && !listing) go();
  }, [open]);

  const register = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.registerRepo(path);
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const visible = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const hiddenCount = (listing?.entries.length ?? 0) - visible.length;

  return (
    <Dialog title="Register a repository" open={open} onClose={onClose}>
      <p className="dialog-hint">
        Pick a folder on this machine. Repositories are marked; open a folder to look inside it.
      </p>

      <div className="browse-path">
        <button
          className="btn-quiet browse-up"
          onClick={() => listing?.parent && go(listing.parent)}
          disabled={!listing?.parent || loading}
          data-tip="Go up to the parent folder"
        >
          ↑
        </button>
        <code
          className="browse-current"
          data-tip={listing?.path ? `Browsing ${listing.path}` : "Folder you're browsing"}
        >
          {listing?.path ?? "…"}
        </code>
      </div>

      <div className="browse-list">
        {loading && <div className="browse-note">Reading folder…</div>}
        {!loading &&
          visible.map((entry) => (
            <div key={entry.path} className={`browse-row ${entry.isRepo ? "browse-row-repo" : ""}`}>
              <button
                className="browse-open"
                onClick={() => go(entry.path)}
                data-tip="Look inside this folder"
              >
                <span
                  className="browse-icon"
                  data-tip={entry.isRepo ? "A git repository" : "A plain folder"}
                >
                  {entry.isRepo ? "🌳" : "📁"}
                </span>
                <span className="browse-name">{entry.name}</span>
              </button>
              {entry.isRepo && (
                <button
                  className="btn-primary browse-pick"
                  disabled={busy}
                  onClick={() => void register(entry.path)}
                  data-tip="Add this repository to Sylva"
                >
                  Register
                </button>
              )}
            </div>
          ))}
        {!loading && visible.length === 0 && (
          <div className="browse-note">No folders here.</div>
        )}
      </div>

      {hiddenCount > 0 && (
        <button
          className="browse-toggle-hidden"
          onClick={() => setShowHidden((h) => !h)}
          data-tip={showHidden ? "Hide dot-folders again" : "Also list folders whose names start with a dot"}
        >
          {showHidden ? "Hide" : `Show ${hiddenCount}`} hidden folder{hiddenCount === 1 ? "" : "s"}
        </button>
      )}

      {error && (
        <div className="form-error">
          {error}
          {detail && <div className="form-error-detail">{detail}</div>}
        </div>
      )}

      {/* Browsing can fail on folders you can still use — macOS blocks listing
          Desktop and Documents unless the terminal is granted access — so
          typing a path stays available as the reliable route. */}
      <form
        className="browse-manual"
        onSubmit={(e) => {
          e.preventDefault();
          void register(typedPath.trim());
        }}
      >
        <label className="field">
          Or paste the repository path
          <div className="browse-manual-row">
            <input
              className="mono-input"
              placeholder="/Users/you/Desktop/my-project"
              value={typedPath}
              onChange={(e) => setTypedPath(e.target.value)}
              data-tip="Absolute path to a git repository on this machine"
            />
            <button
              type="submit"
              className="btn-quiet"
              disabled={busy || !typedPath.trim()}
              data-tip="Register the path you typed"
            >
              Use path
            </button>
          </div>
        </label>
      </form>

      <div className="dialog-actions">
        <button
          type="button"
          className="btn-quiet"
          onClick={onClose}
          disabled={busy}
          data-tip="Close without registering anything"
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !listing?.isRepo}
          onClick={() => listing && void register(listing.path)}
          data-tip={
            listing?.isRepo
              ? "Register the folder you're currently in"
              : "The current folder isn't a git repository"
          }
        >
          {busy ? "Checking…" : "Register this folder"}
        </button>
      </div>
    </Dialog>
  );
}
