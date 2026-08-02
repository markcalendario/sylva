import { useEffect, useState } from "react";
import type { DirListing } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { Dialog } from "../Dialog";

/**
 * Folder picker backed by the server's filesystem. A browser file input only
 * ever yields relative names, so choosing a repository has to be done by
 * browsing the machine Sylva runs on.
 *
 * Two modes over the same browser: adopt a repository that already exists, or
 * start one that doesn't. Registering leads, because it is what you do more
 * often — but "I want to begin something" previously meant leaving for a
 * terminal to run `git init`.
 */
export function RegisterRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"register" | "create">("register");
  const [newName, setNewName] = useState("");
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

  const create = async () => {
    if (!listing) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      await api.createRepo(listing.path, newName.trim());
      setNewName("");
      onClose();
    } catch (e) {
      if (e instanceof ApiFailure) {
        setError(e.message);
        setDetail(e.detail ?? null);
      } else {
        setError("Couldn't create that repository");
      }
    } finally {
      setBusy(false);
    }
  };

  const visible = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const hiddenCount = (listing?.entries.length ?? 0) - visible.length;
  const creating = mode === "create";

  return (
    <Dialog
      title={creating ? "Start a repository" : "Register a repository"}
      open={open}
      onClose={onClose}
    >
      <div className="seg" role="group" aria-label="Repository mode">
        <button
          className={!creating ? "seg-on" : ""}
          onClick={() => setMode("register")}
          data-tip="Add a git repository that already exists on this machine"
        >
          Register existing
        </button>
        <button
          className={creating ? "seg-on" : ""}
          onClick={() => setMode("create")}
          data-tip="Start a new git repository, ready for worktrees"
        >
          Create new
        </button>
      </div>

      <p className="dialog-hint">
        {creating
          ? "Browse to the folder the new repository should live in, then name it. Sylva initializes it with a first commit, so you can grow a worktree straight away."
          : "Pick a folder on this machine. Repositories are marked; open a folder to look inside it."}
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
              {entry.isRepo && !creating && (
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

      {creating && (
        <form
          className="browse-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="field">
            Name the new repository
            <div className="browse-manual-row">
              <input
                className="mono-input"
                placeholder="my-project"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                data-tip="A folder with this name is created in the folder above"
              />
            </div>
            <span className="field-hint">
              Created at <code>{listing?.path ?? "…"}/{newName.trim() || "name"}</code>
            </span>
          </label>
        </form>
      )}

      {/* Browsing can fail on folders you can still use — macOS blocks listing
          Desktop and Documents unless the terminal is granted access — so
          typing a path stays available as the reliable route. */}
      {!creating && (
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
      )}

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
        {creating ? (
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !newName.trim() || !listing}
            onClick={() => void create()}
            data-tip={
              newName.trim()
                ? "Create the repository here and register it"
                : "Name the repository first"
            }
          >
            {busy ? "Creating…" : "Create repository"}
          </button>
        ) : (
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
        )}
      </div>
    </Dialog>
  );
}
