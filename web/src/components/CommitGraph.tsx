import type { GraphCommit } from "sylva-shared";
import { useGraph } from "../lib/queries";
import { HoverCard } from "./HoverCard";

/**
 * This branch drawn against its base. The header already reports "↑3 ↓1"; this
 * answers the question that raises — ahead by *what*? Two lanes that meet at
 * the merge base is the whole shape of a topic branch, so that is all it draws.
 */
export function CommitGraph({ worktreeId }: { worktreeId: string }) {
  const graph = useGraph(worktreeId);

  if (graph.isLoading) return <div className="graph-note">Reading the history…</div>;
  if (graph.isError || !graph.data) return <div className="graph-note">No history to draw.</div>;

  const { branch, base, ahead, behind, mergeBase, common, truncated } = graph.data;
  const diverged = ahead.length > 0 || behind.length > 0;

  return (
    <div className="graph">
      <div className="graph-head">
        <span className="graph-lane-name graph-yours">{branch ?? "detached"}</span>
        {base && <span className="graph-vs">vs</span>}
        {base && <span className="graph-lane-name graph-theirs">{base}</span>}
      </div>

      {!diverged && (
        <p className="graph-note">
          {base
            ? `In step with ${base} — nothing to merge either way.`
            : "No base branch to compare against."}
        </p>
      )}

      {diverged && (
        <div className="graph-lanes">
          <Lane
            commits={ahead}
            side="yours"
            caption={`yours · ${ahead.length} ahead`}
            empty="nothing new here"
          />
          <Lane
            commits={behind}
            side="theirs"
            caption={`${base ?? "base"} · ${behind.length} behind`}
            empty="nothing new upstream"
          />
        </div>
      )}

      {mergeBase && (
        <div className="graph-join">
          <span className="graph-join-rail" />
          <span className="graph-dot graph-dot-base" />
          <span className="graph-join-label">
            last agreed at <code>{mergeBase.short}</code> · {mergeBase.subject}
          </span>
        </div>
      )}

      {common.length > 0 && (
        <ul className="graph-common">
          {common.map((c) => (
            <CommitRow key={c.sha} commit={c} side="common" />
          ))}
        </ul>
      )}

      {truncated && <p className="graph-note">Only the most recent commits are shown.</p>}
    </div>
  );
}

function Lane({
  commits,
  side,
  caption,
  empty,
}: {
  commits: GraphCommit[];
  side: "yours" | "theirs";
  caption: string;
  empty: string;
}) {
  return (
    <>
      <div className="graph-lane-caption">{caption}</div>
      <ul className={`graph-lane graph-lane-${side}`}>
        {commits.length === 0 && <li className="graph-empty">{empty}</li>}
        {commits.map((c) => (
          <CommitRow key={c.sha} commit={c} side={side} />
        ))}
      </ul>
    </>
  );
}

/**
 * A commit row, with everything it doesn't have room for behind a hover. The
 * row answers "what changed and when"; the card answers "by whom, why, and how
 * much" — which used to mean leaving for a terminal.
 */
function CommitRow({ commit, side }: { commit: GraphCommit; side: "yours" | "theirs" | "common" }) {
  return (
    <li className="graph-row-wrap">
      <HoverCard className="graph-row-anchor" card={<CommitCard commit={commit} />}>
        <div className="graph-row" tabIndex={0} role="button">
          <span className={`graph-dot graph-dot-${side}`} />
          <code className="graph-sha">{commit.short}</code>
          <span className="graph-subject">{commit.subject}</span>
          <span className="graph-when">{commit.relative}</span>
        </div>
      </HoverCard>
    </li>
  );
}

function CommitCard({ commit }: { commit: GraphCommit }) {
  const sameIdentity =
    !commit.committer ||
    (commit.committer === commit.author && commit.committerEmail === commit.authorEmail);

  return (
    <div className="commit-card">
      <div className="commit-card-subject">{commit.subject}</div>
      {commit.body && <div className="commit-card-body">{commit.body}</div>}

      <dl className="commit-card-meta">
        <dt>author</dt>
        <dd>
          {commit.author}
          {commit.authorEmail && <span className="commit-card-email"> {commit.authorEmail}</span>}
          {commit.authorDate && (
            <span className="commit-card-date">{formatDate(commit.authorDate)}</span>
          )}
        </dd>

        {/* Only worth a row when it differs — on most commits it is the same
            person twice, which is noise. */}
        {!sameIdentity && (
          <>
            <dt>committer</dt>
            <dd>
              {commit.committer}
              {commit.committerEmail && (
                <span className="commit-card-email"> {commit.committerEmail}</span>
              )}
              {commit.committerDate && (
                <span className="commit-card-date">{formatDate(commit.committerDate)}</span>
              )}
            </dd>
          </>
        )}

        <dt>commit</dt>
        <dd>
          <code className="commit-card-sha">{commit.sha}</code>
        </dd>

        {commit.stats && (
          <>
            <dt>changed</dt>
            <dd>
              {commit.stats.files} file{commit.stats.files === 1 ? "" : "s"}
              {commit.stats.insertions > 0 && (
                <span className="commit-card-add"> +{commit.stats.insertions}</span>
              )}
              {commit.stats.deletions > 0 && (
                <span className="commit-card-del"> −{commit.stats.deletions}</span>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Absolute, local, and readable — the relative age is already on the row. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
