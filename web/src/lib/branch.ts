/**
 * What a worktree is called, and what its branch is called.
 *
 * Those stopped being the same thing. A branch wants a prefix — `feature/`,
 * `chore/`, `docs/` — because that is what makes a repository's branch list
 * readable to everyone else six months from now. A sidebar does not: twelve
 * rows all starting with the same eight characters is twelve rows you have to
 * read past the prefix to tell apart, in the one place where you already know
 * what kind of work you are doing.
 *
 * So the branch keeps its prefix and the interface shows the leaf.
 */

export const WORKTREE_KINDS = ["feature", "chore", "docs"] as const;

export type WorktreeKind = (typeof WORKTREE_KINDS)[number];

export const KIND_TIP: Record<WorktreeKind, string> = {
  feature: "New behaviour — branches as feature/…",
  chore: "Maintenance, refactors, dependencies — branches as chore/…",
  docs: "Documentation and comments — branches as docs/…",
};

/**
 * Turn what someone typed into something git will accept.
 *
 * Git refuses a great deal in a ref name — spaces, `~^:?*[`, a leading or
 * trailing dot, two dots together, a trailing `.lock` — and it refuses it
 * *after* you have filled in the rest of the dialog and pressed the button.
 * Cleaning as you type means the preview under the field is the branch you are
 * actually going to get.
 */
export function slugifyBranch(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      // Anything git dislikes, or that would read badly in a path, becomes a
      // separator; runs of separators collapse to one.
      .replace(/[\s~^:?*[\]\\@{}]+/g, "-")
      .replace(/[^a-z0-9._/-]/g, "")
      .replace(/\.{2,}/g, ".")
      .replace(/-{2,}/g, "-")
      .replace(/\/{2,}/g, "/")
      .replace(/^[-._/]+|[-._/]+$/g, "")
  );
}

/**
 * The branch a kind and a name make together.
 *
 * A name that already carries a prefix is left alone: someone typing
 * `feature/auth` into the box means that branch, and `feature/feature/auth` is
 * nobody's intention.
 */
export function branchFor(kind: WorktreeKind, name: string): string {
  const slug = slugifyBranch(name);
  if (!slug) return "";
  const prefixed = WORKTREE_KINDS.some((k) => slug === k || slug.startsWith(`${k}/`));
  return prefixed ? slug : `${kind}/${slug}`;
}

/**
 * What to call a worktree on screen: the last segment of its branch.
 *
 * `feature/night-mode` shows as `night-mode`. A branch with no prefix is
 * already its own leaf and comes back unchanged, and a detached head — which
 * has no branch to take a leaf from — falls back to whatever the caller can
 * offer, usually a short commit hash.
 */
export function worktreeLabel(branch: string | null | undefined, fallback: string): string {
  if (!branch) return fallback;
  const leaf = branch.slice(branch.lastIndexOf("/") + 1);
  return leaf || branch;
}

/** Whether a branch's name is carrying a prefix worth showing separately. */
export function hasPrefix(branch: string | null | undefined): boolean {
  return typeof branch === "string" && branch.includes("/");
}
