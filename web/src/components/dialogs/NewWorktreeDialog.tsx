import { useEffect, useMemo, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { BranchInfo, Repo } from "sylva-shared";
import { api, ApiFailure } from "../../lib/api";
import { branchFor, KIND_TIP, WORKTREE_KINDS, type WorktreeKind } from "../../lib/branch";
import { useQueryClient } from "@tanstack/react-query";
import { useBranches, useInvalidate, usePreferences, useRepos } from "../../lib/queries";
import { useHasForest, useWords } from "../../lib/theme";
import { useSylva } from "../../state/store";
import { Dialog } from "../Dialog";

/** How many matches the list shows before it stops; the box narrows the rest. */
const MAX_MATCHES = 40;

/**
 * Filter branches by a typed fragment, best first.
 *
 * Ranked rather than merely filtered because branch names share prefixes —
 * `feature/auth`, `feature/auth-tests`, `hotfix/auth` — and an exact or
 * leading match is almost always the one meant. Case-insensitive throughout:
 * nobody remembers whether they capitalised the ticket number.
 */
function search(branches: BranchInfo[], query: string): BranchInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return branches.slice(0, MAX_MATCHES);

  return branches
    .flatMap((branch) => {
      const name = branch.name.toLowerCase();
      const at = name.indexOf(q);
      if (at === -1) return [];
      // Exact, then leading, then a match at a path segment, then anywhere.
      const rank = name === q ? 0 : at === 0 ? 1 : name[at - 1] === "/" ? 2 : 3;
      return [{ branch, rank, at }];
    })
    .sort((a, b) => a.rank - b.rank || a.at - b.at || a.branch.name.localeCompare(b.branch.name))
    .slice(0, MAX_MATCHES)
    .map((m) => m.branch);
}

/**
 * The single way to grow a worktree. Creating one opens it in the active pane,
 * so you land in the new tree ready to prompt — but nothing is sent to an agent
 * for you.
 */
export function NewWorktreeDialog({
  repo,
  open,
  onClose,
}: {
  /** Pre-selected repo when opened from a repo row; otherwise the user picks. */
  repo?: Repo;
  open: boolean;
  onClose: () => void;
}) {
  const words = useWords();
  const hasForest = useHasForest();
  const repos = useRepos();
  const prefs = usePreferences();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [repoId, setRepoId] = useState("");
  /**
   * What kind of work this is, and what you're calling it. Held apart, because
   * the branch is made of both and the sidebar only ever shows the second.
   */
  const [kind, setKind] = useState<WorktreeKind>("feature");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");
  /** What's typed in the existing-branch search box, which is not the choice. */
  const [branchQuery, setBranchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Fetch before cutting the tree.
   *
   * A setting rather than a one-off choice: whether you start from the remote
   * or from what is already on disk is a habit, not a decision you want to make
   * again every time. It opens on the saved preference and writes back to it,
   * so the box you ticked last week is the box you find ticked today.
   */
  const [pull, setPull] = useState<boolean | null>(null);
  const pulling = pull ?? prefs.data?.pullBeforeWorktree ?? true;

  // The preference arrives after the first render, and again after a save
  // elsewhere; an untouched checkbox should follow it.
  useEffect(() => {
    if (open) setPull(null);
  }, [open]);

  const available = repos.data?.filter((r) => r.available) ?? [];
  const effectiveRepoId = repo?.id ?? repoId ?? "";
  const targetRepoId = effectiveRepoId || available[0]?.id || "";
  const branches = useBranches(open ? targetRepoId || null : null);
  const allBranches = useMemo(() => branches.data ?? [], [branches.data]);
  const freeBranches = useMemo(() => allBranches.filter((b) => !b.worktreeId), [allBranches]);
  const matches = useMemo(() => search(freeBranches, branchQuery), [freeBranches, branchQuery]);
  /** The branch the two fields add up to. Shown under them, so there is no
      moment where you find out what you named it after the fact. */
  const newBranch = branchFor(kind, name);
  const taken = allBranches.some((b) => b.name === newBranch);
  const ready = mode === "new" ? Boolean(newBranch) && !taken : Boolean(branch.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createWorktree(targetRepoId, {
        branch: mode === "new" ? newBranch : branch.trim(),
        ...(mode === "new" ? { baseRef: baseRef.trim() || "HEAD" } : {}),
        pull: pulling,
      });
      // Remember the habit, but never let saving it get in the way of the
      // worktree that has already been made.
      if (prefs.data && prefs.data.pullBeforeWorktree !== pulling) {
        void api
          .setPreferences({ ...prefs.data, pullBeforeWorktree: pulling })
          .then(() => qc.invalidateQueries({ queryKey: ["preferences"] }))
          .catch(() => {});
      }
      invalidate.worktrees(targetRepoId);
      invalidate.branches();
      useSylva.getState().openWorktree(created.worktree.id);
      setName("");
      setBranch("");
      setBaseRef("");
      setBranchQuery("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.detail ?? e.message) : "Worktree creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New worktree" open={open} onClose={onClose}>
      <p className="dialog-hint">
        {hasForest
          ? "Grows a new tree in the forest and takes you to it."
          : "Creates a worktree and takes you to it."}{" "}
        Prompt the {words.agent} once you're there.
        {prefs.data?.copyEnvFiles && (
          <>
            {" "}
            Any <code>.env</code> files go with it, so it can run as soon as it exists.
          </>
        )}
      </p>

      <div className="seg">
        <button
          type="button"
          className={mode === "new" ? "seg-on" : ""}
          /* The two modes mean two different things by `branch` — a name to
             create, or a name to find — so switching clears it rather than
             carrying a half-typed name into a search box. */
          onClick={() => {
            setMode("new");
            setBranch("");
          }}
          data-tip="Create a branch and check it out in the new worktree"
        >
          New branch
        </button>
        <button
          type="button"
          className={mode === "existing" ? "seg-on" : ""}
          onClick={() => {
            setMode("existing");
            setBranch("");
            setBranchQuery("");
          }}
          data-tip="Check out a branch that has no worktree yet"
        >
          Existing branch
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!repo && (
          <label className="field">
            Repository
            <select
              value={targetRepoId}
              onChange={(e) => setRepoId(e.target.value)}
              data-tip="Repository the worktree is created in"
            >
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "new" ? (
          <>
            <div className="field">
              Kind
              {/* Three, and no "other". A prefix is only worth having if it is
                  the same three words every time — a free-text prefix box
                  produces `feat/`, `feature/` and `features/` inside a month,
                  and then the list sorts into three piles of the same thing. */}
              <div className="seg">
                {WORKTREE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={kind === k ? "seg-on" : ""}
                    onClick={() => setKind(k)}
                    data-tip={KIND_TIP[k]}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              Name
              <input
                autoFocus
                className="mono-input"
                placeholder="night mode"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-tip="What you'll call this worktree. The branch takes the kind as its prefix."
              />
              {/* The preview is the point of splitting the field in two: you
                  type English and watch the ref it becomes. */}
              {name.trim() && (
                <span className={`branch-preview ${taken ? "branch-preview-taken" : ""}`}>
                  {newBranch ? (
                    <>
                      branch <code>{newBranch}</code>
                      {taken && " already exists"}
                    </>
                  ) : (
                    "That name has nothing in it git can use."
                  )}
                </span>
              )}
            </label>
            <label className="field">
              Base ref <span className="field-hint">(default: HEAD)</span>
              <input
                className="mono-input"
                placeholder="main"
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                /* Suggestions rather than a fixed list: a base ref can be any
                   commit or tag, so the branches are a shortcut, not the set. */
                list="worktree-base-refs"
                data-tip="Branch or commit the new branch starts from — branch names are suggested as you type"
              />
              <datalist id="worktree-base-refs">
                {allBranches.map((b) => (
                  <option key={b.name} value={b.name} />
                ))}
              </datalist>
            </label>
          </>
        ) : (
          <div className="field">
            Branch
            {/* A repository with two hundred branches makes a <select> useless,
                and the name you want is usually one you can half-remember —
                so this is a search box with the matches under it. */}
            <input
              autoFocus
              className="mono-input"
              placeholder="Search branches…"
              value={branchQuery}
              onChange={(e) => setBranchQuery(e.target.value)}
              aria-label="Search branches"
              data-tip="Type any part of a branch name to narrow the list"
            />
            {branch && (
              <div className="branch-chosen">
                <span className="branch-chosen-label">checking out</span>
                <code>{branch}</code>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setBranch("")}
                  aria-label="Clear the chosen branch"
                  data-tip="Pick a different branch"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {branches.isLoading ? (
              <span className="field-hint">Reading the branches…</span>
            ) : freeBranches.length === 0 ? (
              <span className="field-hint">Every branch is already checked out in a worktree.</span>
            ) : matches.length === 0 ? (
              <span className="field-hint">
                No free branch matches “{branchQuery.trim()}”.
                {allBranches.some((b) => b.name.includes(branchQuery.trim()) && b.worktreeId)
                  ? " One that does is already checked out somewhere."
                  : ""}
              </span>
            ) : (
              <ul className="branch-list">
                {matches.map((b) => (
                  <li key={b.name}>
                    <button
                      type="button"
                      className={`branch-option ${branch === b.name ? "branch-option-on" : ""}`}
                      onClick={() => setBranch(b.name)}
                      data-tip={
                        b.isCurrent
                          ? "The branch this repository's main worktree is on"
                          : "Check this branch out in the new worktree"
                      }
                    >
                      <span className="branch-option-name">{b.name}</span>
                      {b.isCurrent && <span className="branch-option-tag">current</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label
          className="dialog-check"
          data-tip="Fetch from the remote before the worktree is cut, so it starts from the latest"
        >
          <input
            type="checkbox"
            checked={pulling}
            onChange={(e) => setPull(e.target.checked)}
            disabled={busy}
          />
          <span>
            <RefreshCw size={11} className="check-glyph" aria-hidden /> Pull first
            <span className="field-hint">
              {mode === "new"
                ? "Fetches, then starts the branch from the remote's copy of the base ref rather than from whatever this machine last had."
                : "Fetches, then catches the branch up to its upstream — only where that's a fast-forward, so commits of your own are never lost."}{" "}
              A repository with no remote skips it.
            </span>
          </span>
        </label>

        {error && (
          <div className="form-error" data-tip="Git wouldn't create the worktree">
            {error}
          </div>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="btn-quiet"
            onClick={onClose}
            data-tip="Close without creating a worktree"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !ready || !targetRepoId}
            data-tip={
              ready
                ? "Create the worktree and open it"
                : mode === "new"
                  ? "Name the worktree first"
                  : "Pick a branch first"
            }
          >
            {busy ? (pulling ? "Fetching, then growing…" : "Growing…") : "Create worktree"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
