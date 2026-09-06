import { hasPrefix, worktreeLabel } from "../lib/branch";

/**
 * A branch, written so both halves of it are readable at once.
 *
 * The interface leads with what you call a worktree — `night-mode` — because
 * a column of `feature/…` is a column you have to read past the prefix to
 * use. But the prefix is not noise: it is half the answer to "which branch am
 * I on", and hiding it in a tooltip meant the one question a header exists to
 * answer needed a hover.
 *
 * So both are shown, and weight does the work the truncation used to: the
 * prefix sits back in the muted colour, the name comes forward. You read the
 * name at a glance and the branch when you look.
 */
export function BranchName({
  branch,
  className,
  tip,
}: {
  branch: string;
  className?: string;
  /**
   * Taken as a prop rather than left to the caller's `data-tip`: TypeScript
   * waves hyphenated JSX attributes through on a component without checking
   * them, so a `data-tip` written here would compile and then be dropped on
   * the floor, and the tooltip would simply never appear.
   */
  tip?: string;
}) {
  const rest = tip ? { "data-tip": tip } : {};

  if (!hasPrefix(branch)) {
    return (
      <span className={className} {...rest}>
        {branch}
      </span>
    );
  }

  const cut = branch.lastIndexOf("/");
  return (
    <span className={className} {...rest}>
      <span className="branch-prefix">{branch.slice(0, cut + 1)}</span>
      {worktreeLabel(branch, branch)}
    </span>
  );
}
