import { useMemo, useState } from "react";
import { GitCompare, RefreshCw } from "lucide-react";
import { sessionBusy, type FleetEntry, type StatusEntry } from "sylva-shared";
import { worktreeLabel } from "../lib/branch";
import { useFleet } from "../lib/queries";
import { useWords } from "../lib/theme";
import { spriteStateFor, useSylva } from "../state/store";
import { Sprite } from "../sprites/Sprite";

/** One changed file, flattened out of the three groups git reports. */
interface Row {
  path: string;
  kind: StatusEntry["kind"];
  staged: boolean;
  renamedFrom?: string;
}

const KIND_GLYPH: Record<StatusEntry["kind"], string> = {
  added: "+",
  untracked: "+",
  deleted: "−",
  renamed: "→",
  modified: "~",
};

/**
 * Everything the fleet has changed, on one screen.
 *
 * The forest map answers "what is each dryad doing"; this answers the question
 * that comes after, which is "what have they actually done to my code". With
 * four agents running, reviewing that meant opening each of them in turn and
 * clicking through four Git tabs — and the first thing you did was read the same
 * short list of filenames. So here is every list, at once, with a way into any
 * of them.
 */
export function FleetView() {
  const fleet = useFleet(true);
  /** Worktrees with nothing uncommitted are hidden by default — they are noise. */
  const [showClean, setShowClean] = useState(false);

  const entries = fleet.data?.entries ?? [];

  const { dirty, clean, totals } = useMemo(() => {
    const dirty: FleetEntry[] = [];
    const clean: FleetEntry[] = [];
    let files = 0;

    for (const entry of entries) {
      const count = entry.status
        ? entry.status.staged.length + entry.status.unstaged.length + entry.status.untracked.length
        : 0;
      files += count;
      if (count > 0 || entry.error) dirty.push(entry);
      else clean.push(entry);
    }
    return { dirty, clean, totals: { files, worktrees: dirty.length } };
  }, [entries]);

  if (fleet.isLoading) {
    return <div className="fleet-note">Reading every worktree…</div>;
  }
  if (fleet.isError) {
    return <div className="fleet-note">Couldn't read the fleet.</div>;
  }

  return (
    <div className="fleet">
      <header className="fleet-head">
        <div className="fleet-title">
          <h1>The fleet</h1>
          <p className="fleet-sub">
            {totals.files === 0
              ? "Every worktree is clean."
              : `${totals.files} uncommitted file${totals.files === 1 ? "" : "s"} across ${
                  totals.worktrees
                } worktree${totals.worktrees === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="fleet-actions">
          {clean.length > 0 && (
            <button
              className="btn-quiet"
              onClick={() => setShowClean((s) => !s)}
              data-tip="Worktrees with nothing uncommitted"
            >
              {showClean ? "Hide" : "Show"} {clean.length} clean
            </button>
          )}
          <button
            className="btn-quiet"
            onClick={() => void fleet.refetch()}
            disabled={fleet.isFetching}
            data-tip="Ask every worktree again"
            aria-label="Refresh"
          >
            <RefreshCw size={13} className={fleet.isFetching ? "spin" : ""} />
          </button>
        </div>
      </header>

      {dirty.length === 0 && clean.length === 0 && (
        <div className="fleet-note">No worktrees registered yet.</div>
      )}

      <div className="fleet-grid">
        {dirty.map((entry) => (
          <FleetCard key={entry.worktreeId} entry={entry} />
        ))}
        {showClean && clean.map((entry) => <FleetCard key={entry.worktreeId} entry={entry} />)}
      </div>
    </div>
  );
}

function FleetCard({ entry }: { entry: FleetEntry }) {
  const words = useWords();
  const store = useSylva.getState();
  const spriteState = useSylva((s) => spriteStateFor(s, entry.worktreeId));
  const session = useSylva((s) => s.sessions[entry.worktreeId]);

  const rows: Row[] = useMemo(() => {
    const status = entry.status;
    if (!status) return [];
    const out: Row[] = [];
    const push = (entries: StatusEntry[], staged: boolean) => {
      for (const e of entries) {
        out.push({
          path: e.path,
          kind: e.kind,
          staged,
          ...(e.renamedFrom ? { renamedFrom: e.renamedFrom } : {}),
        });
      }
    };
    push(status.staged, true);
    push(status.unstaged, false);
    push(status.untracked, false);
    return out;
  }, [entry.status]);

  const open = () => store.openWorktree(entry.worktreeId);

  return (
    <section className="fleet-card">
      <header className="fleet-card-head">
        <Sprite state={spriteState} scale={1} title={worktreeLabel(entry.branch, "detached")} />
        <button
          className="fleet-card-name"
          onClick={open}
          data-tip={`${entry.branch ?? "detached"} · open this worktree`}
        >
          <span className="fleet-repo">{entry.repoName}</span>
          <code className="fleet-branch">{worktreeLabel(entry.branch, "detached")}</code>
        </button>

        {entry.status?.base && (
          <span
            className="fleet-div tabular"
            data-tip={`Commits ahead ↑ and behind ↓ ${entry.status.base.branch}`}
          >
            <span className={entry.status.base.ahead ? "div-ahead" : "div-zero"}>
              ↑{entry.status.base.ahead}
            </span>
            <span className={entry.status.base.behind ? "div-behind" : "div-zero"}>
              ↓{entry.status.base.behind}
            </span>
          </span>
        )}

        {sessionBusy(session) && (
          <span
            className="fleet-working"
            data-tip={
              session?.status === "running"
                ? `A ${words.agent} is working here right now`
                : "Background work is still running here"
            }
          >
            working
          </span>
        )}
      </header>

      {entry.error && <div className="fleet-error">{entry.error}</div>}

      {!entry.error && rows.length === 0 && <div className="fleet-clean">clean</div>}

      {rows.length > 0 && (
        <ul className="fleet-files">
          {rows.map((row) => (
            <li key={`${row.staged ? "s" : "u"}:${row.path}`} className="fleet-file">
              <button
                className="fleet-file-open"
                onClick={() => store.openFile({ worktreeId: entry.worktreeId, path: row.path })}
                data-tip="Open this file in the Files tab"
              >
                <span className={`chg chg-${row.kind}`} data-tip={`This file was ${row.kind}`}>
                  {KIND_GLYPH[row.kind]}
                </span>
                <span className="fleet-path">
                  {row.renamedFrom ? `${row.renamedFrom} → ${row.path}` : row.path}
                </span>
                {row.staged && (
                  <span className="fleet-staged" data-tip="Staged for the next commit">
                    staged
                  </span>
                )}
              </button>
              <button
                className="ghost fleet-file-diff"
                onClick={() => {
                  // Open the worktree first: the diff belongs to a pane, and
                  // the pane has to be pointed at this tree to show it.
                  store.openWorktree(entry.worktreeId);
                  store.setPaneDiff(
                    { worktreeId: entry.worktreeId, path: row.path, staged: row.staged },
                    "git",
                  );
                }}
                aria-label={`Show the diff for ${row.path}`}
                data-tip="Show this file's diff in the Git tab"
              >
                <GitCompare size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
