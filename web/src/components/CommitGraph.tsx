import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CommitFile, GraphCommit } from "sylva-shared";
import { useCommitDetail, useGraph } from "../lib/queries";
import type { DiffSelection } from "../state/store";
import { HoverCard } from "./HoverCard";

const KIND_GLYPH: Record<CommitFile["kind"], string> = {
  added: "+",
  untracked: "+",
  deleted: "−",
  renamed: "→",
  modified: "~",
};

/**
 * This branch drawn against its base. The header already reports "↑3 ↓1"; this
 * answers the question that raises — ahead by *what*? Two lanes that meet at
 * the merge base is the whole shape of a topic branch, so that is all it draws.
 *
 * Clicking a commit opens it: every file it touched, and the diff for whichever
 * you pick. The hover card says how much moved; this says what moved, which is
 * the question the card always left you holding.
 */
export function CommitGraph({
  worktreeId,
  selection,
  onSelect,
}: {
  worktreeId: string;
  selection: DiffSelection | null;
  onSelect: (selection: DiffSelection | null) => void;
}) {
  const graph = useGraph(worktreeId);
  /**
   * One commit open at a time. Several open at once turns the panel into a
   * wall of paths, and the diff beside it can only ever be about one of them.
   */
  const [openSha, setOpenSha] = useState<string | null>(null);

  const toggle = (sha: string) => {
    setOpenSha((current) => (current === sha ? null : sha));
    // Closing a commit takes its diff with it; leaving a patch on screen with
    // nothing on the left that points at it is how you lose track of what
    // you're reading.
    if (openSha === sha && selection?.commit === sha) onSelect(null);
  };

  const rowProps = { worktreeId, openSha, onToggle: toggle, selection, onSelect };

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
            {...rowProps}
          />
          <Lane
            commits={behind}
            side="theirs"
            caption={`${base ?? "base"} · ${behind.length} behind`}
            empty="nothing new upstream"
            {...rowProps}
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
            <CommitRow key={c.sha} commit={c} side="common" {...rowProps} />
          ))}
        </ul>
      )}

      {truncated && <p className="graph-note">Only the most recent commits are shown.</p>}
    </div>
  );
}

/** What every commit row needs to know about the panel it sits in. */
interface RowContext {
  worktreeId: string;
  openSha: string | null;
  onToggle: (sha: string) => void;
  selection: DiffSelection | null;
  onSelect: (selection: DiffSelection | null) => void;
}

function Lane({
  commits,
  side,
  caption,
  empty,
  ...rest
}: {
  commits: GraphCommit[];
  side: "yours" | "theirs";
  caption: string;
  empty: string;
} & RowContext) {
  return (
    <>
      <div className="graph-lane-caption">{caption}</div>
      <ul className={`graph-lane graph-lane-${side}`}>
        {commits.length === 0 && <li className="graph-empty">{empty}</li>}
        {commits.map((c) => (
          <CommitRow key={c.sha} commit={c} side={side} {...rest} />
        ))}
      </ul>
    </>
  );
}

/**
 * A commit row, with everything it doesn't have room for behind a hover, and
 * everything it changed behind a click. The row answers "what and when"; the
 * card answers "by whom and how much"; opening it answers "which files" — all
 * three of which used to mean leaving for a terminal.
 */
function CommitRow({
  commit,
  side,
  worktreeId,
  openSha,
  onToggle,
  selection,
  onSelect,
}: {
  commit: GraphCommit;
  side: "yours" | "theirs" | "common";
} & RowContext) {
  const open = openSha === commit.sha;
  return (
    <li className={`graph-row-wrap ${open ? "graph-row-open" : ""}`}>
      {/* Beside, not below: commit rows are stacked full-width, so a card under
          one of them hides the three commits you were comparing it against. */}
      <HoverCard
        className="graph-row-anchor"
        placement="beside"
        card={<CommitCard commit={commit} />}
      >
        <div
          className="graph-row"
          tabIndex={0}
          role="button"
          aria-expanded={open}
          onClick={() => onToggle(commit.sha)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle(commit.sha);
            }
          }}
          data-tip="Show the files this commit changed"
        >
          {/* The dot comes first, and stays first: the lane's rail is drawn
              down the dots, so anything in front of them pushes the whole
              column off its own line. */}
          <span className={`graph-dot graph-dot-${side}`} />
          <span className="graph-caret" aria-hidden>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
          <code className="graph-sha">{commit.short}</code>
          <span className="graph-subject">{commit.subject}</span>
          <span className="graph-when">{commit.relative}</span>
        </div>
      </HoverCard>

      {open && (
        <CommitFiles
          worktreeId={worktreeId}
          sha={commit.sha}
          selection={selection}
          onSelect={onSelect}
        />
      )}
    </li>
  );
}

/** Every file one commit touched, each opening its diff as that commit left it. */
function CommitFiles({
  worktreeId,
  sha,
  selection,
  onSelect,
}: {
  worktreeId: string;
  sha: string;
  selection: DiffSelection | null;
  onSelect: (selection: DiffSelection | null) => void;
}) {
  const detail = useCommitDetail(worktreeId, sha);

  if (detail.isLoading) return <div className="commit-files-note">Reading the commit…</div>;
  if (detail.isError || !detail.data) {
    return <div className="commit-files-note">Couldn't read what this commit changed.</div>;
  }
  const { files } = detail.data;
  if (files.length === 0) {
    return <div className="commit-files-note">This commit changed no files.</div>;
  }

  return (
    <ul className="commit-files">
      {files.map((file) => {
        const on =
          selection?.commit === sha &&
          selection.worktreeId === worktreeId &&
          selection.path === file.path;
        return (
          <li key={file.path} className={`commit-file ${on ? "commit-file-on" : ""}`}>
            <button
              className="commit-file-name"
              onClick={() => onSelect({ worktreeId, path: file.path, staged: false, commit: sha })}
              data-tip="Show this file as the commit left it"
            >
              <span className={`chg chg-${file.kind}`} data-tip={`This file was ${file.kind}`}>
                {KIND_GLYPH[file.kind]}
              </span>
              <span className="commit-file-path">
                {file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}
              </span>
              <span className="commit-file-count">
                {file.insertions === null || file.deletions === null ? (
                  <span className="commit-file-binary">binary</span>
                ) : (
                  <>
                    {file.insertions > 0 && <span className="commit-card-add">+{file.insertions}</span>}
                    {file.deletions > 0 && <span className="commit-card-del">−{file.deletions}</span>}
                  </>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
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
