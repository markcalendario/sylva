import { useHasForest } from "../lib/theme";
import { LandingScene } from "./LandingScene";

/**
 * First run: nothing is registered yet, so this is the only screen with room
 * to say what Sylva is before asking for anything.
 *
 * The pitch is the same either way; only the metaphor is a theme's. A theme
 * with no forest gets no scene above the fold and plain nouns in the copy,
 * because promising a dryad and then not drawing one is worse than never
 * mentioning it.
 */
export function Landing({ onRegister, onAbout }: { onRegister: () => void; onAbout: () => void }) {
  const hasForest = useHasForest();
  return (
    <div className="landing">
      {hasForest && <LandingScene />}

      <div className="landing-hero">
        <h1 className="landing-title">SYLVA</h1>
        <p className="landing-lede">
          A local mission control for git worktrees and Claude agents.{" "}
          {hasForest
            ? "Every worktree is a tree in your forest, tended by a dryad you can put to work — and watch."
            : "Every worktree gets an agent you can put to work — and watch."}
        </p>
        <button
          className="btn-primary landing-cta"
          onClick={onRegister}
          data-tip="Point Sylva at a git repository on this machine"
        >
          Register your first repository
        </button>
        <p className="landing-note">
          Nothing leaves your machine. Sylva runs entirely on localhost.
        </p>
      </div>

      <div className="landing-grid">
        <section className="landing-card">
          <div className="pixel-label">{hasForest ? "grow" : "branch"}</div>
          <h2>{hasForest ? "A tree per task" : "A worktree per task"}</h2>
          <p>
            Create a worktree from any branch and land in it. Work on several things at once without
            stashing or switching branches.
          </p>
        </section>
        <section className="landing-card">
          <div className="pixel-label">{hasForest ? "tend" : "run"}</div>
          <h2>Agents you can watch</h2>
          <p>
            Prompt Claude inside a worktree and see its messages, tool calls, and file edits stream
            in. Approve commands inline; queue follow-ups mid-turn.
          </p>
        </section>
        <section className="landing-card">
          <div className="pixel-label">read</div>
          <h2>State at a glance</h2>
          <p>
            {hasForest
              ? "Each dryad's animation tells you what its tree is doing — resting, working, celebrating, or stuck — with live diffs, divergence, and token usage alongside."
              : "One indicator per worktree tells you what it is doing — resting, working, done, or stuck — with live diffs, divergence, and token usage alongside."}
          </p>
        </section>
        <section className="landing-card">
          <div className="pixel-label">ship</div>
          <h2>Git without the tab-juggling</h2>
          <p>
            Stage, diff, commit, push and pull from the same place, so a finished task goes out
            without {hasForest ? "leaving the forest" : "leaving Sylva"}.
          </p>
        </section>
      </div>

      <footer className="landing-foot">
        <button className="landing-credit" onClick={onAbout} data-tip="About Sylva and its author">
          Built by Mark Kenneth Calendario
        </button>
      </footer>
    </div>
  );
}
