import { Sprite } from "../sprites/Sprite";

/**
 * First run: nothing is registered yet, so this is the only screen with room
 * to say what Sylva is before asking for anything.
 */
export function Landing({ onRegister, onAbout }: { onRegister: () => void; onAbout: () => void }) {
  return (
    <div className="landing">
      <div className="landing-hero">
        <div className="landing-sprites">
          <Sprite state="idle" scale={3} />
          <Sprite state="working" scale={3} />
          <Sprite state="success" scale={3} />
        </div>
        <h1 className="landing-title">SYLVA</h1>
        <p className="landing-lede">
          A local mission control for git worktrees and Claude agents. Every worktree is a tree in
          your forest, tended by a dryad you can put to work — and watch.
        </p>
        <button className="btn-primary landing-cta" onClick={onRegister}>
          Register your first repository
        </button>
        <p className="landing-note">Nothing leaves your machine. Sylva runs entirely on localhost.</p>
      </div>

      <div className="landing-grid">
        <section className="landing-card">
          <div className="pixel-label">grow</div>
          <h2>A tree per task</h2>
          <p>
            Create a worktree from any branch and land in it. Work on several things at once
            without stashing or switching branches.
          </p>
        </section>
        <section className="landing-card">
          <div className="pixel-label">tend</div>
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
            Each dryad's animation tells you what its tree is doing — resting, working,
            celebrating, or stuck — with live diffs, divergence, and cost alongside.
          </p>
        </section>
        <section className="landing-card">
          <div className="pixel-label">ship</div>
          <h2>Git without the tab-juggling</h2>
          <p>
            Stage, diff, commit, push and pull from the same place, so a finished task goes out
            without leaving the forest.
          </p>
        </section>
      </div>

      <footer className="landing-foot">
        <button className="landing-credit" onClick={onAbout}>
          Built by Mark Kenneth Calendario
        </button>
      </footer>
    </div>
  );
}
