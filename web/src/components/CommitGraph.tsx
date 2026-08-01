import type { GraphCommit } from "sylva-shared";
import { useGraph } from "../lib/queries";

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
            <li key={c.sha} className="graph-row">
              <span className="graph-dot graph-dot-common" />
              <code className="graph-sha">{c.short}</code>
              <span className="graph-subject">{c.subject}</span>
              <span className="graph-when">{c.relative}</span>
            </li>
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
        <li key={c.sha} className="graph-row" data-tip={`${c.author} · ${c.sha.slice(0, 12)}`}>
          <span className={`graph-dot graph-dot-${side}`} />
          <code className="graph-sha">{c.short}</code>
          <span className="graph-subject">{c.subject}</span>
          <span className="graph-when">{c.relative}</span>
        </li>
      ))}
    </ul>
    </>
  );
}
