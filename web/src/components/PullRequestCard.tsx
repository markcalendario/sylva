import {
  Check,
  CircleDot,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  MessageSquare,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ChecksState, CurrentPullRequest } from "sylva-shared";
import { useCurrentPull } from "../lib/queries";

const CHECK_LABEL: Record<ChecksState, string> = {
  passing: "checks passing",
  failing: "checks failing",
  pending: "checks running",
  none: "no checks",
};

/**
 * The pull request for the branch this worktree is on.
 *
 * It used to live behind a button, in a dialog, in a list of every open PR on
 * the repository — three steps to answer "is mine green yet", which is a
 * question you ask constantly and about exactly one PR. So the one that is
 * yours sits in the panel, and the list stays where it was for the times you
 * genuinely want to see everyone else's.
 *
 * A branch with no PR gets a quiet line rather than nothing: knowing there
 * isn't one is an answer too, and it is the moment you would want to open one.
 */
export function PullRequestCard({ worktreeId }: { worktreeId: string }) {
  const pull = useCurrentPull(worktreeId);

  // Nothing at all while the first read is in flight. A card that appears,
  // says "loading", then vanishes because the branch has no PR is worse than
  // one that simply arrives when there is something to say.
  if (pull.isLoading || !pull.data) return null;

  const { pull: pr, reason, createUrl } = pull.data;

  if (!pr) {
    // `gh` missing or logged out is worth saying once, quietly. A branch that
    // just hasn't got a PR yet is not a problem and doesn't get a sentence.
    if (reason) {
      return (
        <div className="pr-card pr-card-quiet" data-tip="Sylva reads pull requests through `gh`">
          {reason}
        </div>
      );
    }
    if (!createUrl) return null;
    return (
      <a
        className="pr-card pr-card-none"
        href={createUrl}
        target="_blank"
        rel="noreferrer"
        data-tip="Open a pull request for this branch on GitHub"
      >
        <GitPullRequest size={13} />
        <span>No pull request for this branch yet</span>
        <ExternalLink size={11} />
      </a>
    );
  }

  const merged = pr.state === "MERGED";
  const closed = pr.state === "CLOSED";
  const tone = merged ? "merged" : closed ? "closed" : pr.draft ? "draft" : "open";

  return (
    <div className={`pr-card pr-card-${tone}`}>
      <a
        className="pr-card-head"
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        data-tip={`Open #${pr.number} on GitHub`}
      >
        <span className="pr-card-icon" data-tip={stateTip(pr)}>
          {merged ? (
            <GitMerge size={13} />
          ) : closed ? (
            <X size={13} />
          ) : pr.draft ? (
            <GitPullRequestDraft size={13} />
          ) : (
            <GitPullRequest size={13} />
          )}
        </span>
        <span className="pr-card-number">#{pr.number}</span>
        <span className="pr-card-title">{pr.title}</span>
        <ExternalLink size={11} className="pr-card-out" />
      </a>

      <div className="pr-card-meta">
        <Checks pr={pr} />
        <Review decision={pr.reviewDecision} />

        {pr.mergeable === "CONFLICTING" && (
          <span
            className="pr-chip pr-chip-bad"
            data-tip="GitHub says this branch conflicts with its base"
          >
            <TriangleAlert size={11} />
            conflicts
          </span>
        )}

        <span
          className="pr-chip pr-chip-quiet"
          data-tip={`${pr.changedFiles} file${pr.changedFiles === 1 ? "" : "s"} changed in this pull request`}
        >
          <span className="pr-add">+{pr.additions}</span>
          <span className="pr-del">−{pr.deletions}</span>
        </span>

        {pr.commentCount > 0 && (
          <span
            className="pr-chip pr-chip-quiet"
            data-tip={`${pr.commentCount} comment${pr.commentCount === 1 ? "" : "s"} on this pull request`}
          >
            <MessageSquare size={11} />
            {pr.commentCount}
          </span>
        )}

        {pr.baseBranch && (
          <span className="pr-card-base" data-tip="Branch this pull request merges into">
            → {pr.baseBranch}
          </span>
        )}
      </div>
    </div>
  );
}

function stateTip(pr: CurrentPullRequest): string {
  if (pr.state === "MERGED") return "This pull request has been merged";
  if (pr.state === "CLOSED") return "This pull request was closed without merging";
  if (pr.draft) return "Still a draft — reviewers aren't asked yet";
  return "Open, and ready for review";
}

/**
 * How CI is doing, in one chip.
 *
 * Failure is the only state that gets a loud colour. One red check is the whole
 * answer regardless of how many green ones surround it, and the counts behind
 * it live in the tooltip where they can be read when they matter.
 */
function Checks({ pr }: { pr: CurrentPullRequest }) {
  if (pr.checks === "none") return null;
  const tone =
    pr.checks === "passing" ? "good" : pr.checks === "failing" ? "bad" : "waiting";

  return (
    <span
      className={`pr-chip pr-chip-${tone}`}
      data-tip={`${pr.checksPassed} passed · ${pr.checksFailed} failed · ${pr.checksPending} still running`}
    >
      {pr.checks === "passing" ? (
        <Check size={11} />
      ) : pr.checks === "failing" ? (
        <X size={11} />
      ) : (
        <CircleDot size={11} />
      )}
      {CHECK_LABEL[pr.checks]}
    </span>
  );
}

function Review({ decision }: { decision: string | null }) {
  if (!decision) return null;
  if (decision === "APPROVED") {
    return (
      <span className="pr-chip pr-chip-good" data-tip="Someone has approved this pull request">
        <Check size={11} />
        approved
      </span>
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return (
      <span className="pr-chip pr-chip-bad" data-tip="A reviewer has asked for changes">
        <TriangleAlert size={11} />
        changes requested
      </span>
    );
  }
  return (
    <span className="pr-chip pr-chip-quiet" data-tip="Waiting on a review">
      review needed
    </span>
  );
}
