import { useHasForest, useWords } from "../../lib/theme";
import { Sprite } from "../../sprites/Sprite";
import { Dialog } from "../Dialog";

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hasForest = useHasForest();
  const words = useWords();
  return (
    <Dialog title="About Sylva" open={open} onClose={onClose}>
      <div className="about-sprites">
        <Sprite state="idle" scale={2} />
        <Sprite state="working" scale={2} />
        <Sprite state="success" scale={2} />
        <Sprite state="error" scale={2} />
      </div>

      <p className="dialog-hint">
        A local mission control for git worktrees and Claude agents.{" "}
        {hasForest
          ? "Every worktree is a tree in your forest, tended by a dryad you can put to work — and watch."
          : "Every worktree gets an agent you can put to work — and watch."}
      </p>

      <div className="credits">
        <div className="pixel-label">built by</div>
        <div className="credits-name">Mark Kenneth Calendario</div>
        <div className="credits-role">Full-stack web developer · Caloocan, Philippines</div>
        <div className="credits-tagline">Design ▸ Build ▸ Ship</div>
        <div className="credits-links">
          <a
            href="https://markcalendario.vercel.app/"
            target="_blank"
            rel="noreferrer"
            data-tip="Open the author's portfolio in a new tab"
          >
            Portfolio
          </a>
          <a
            href="https://github.com/markcalendario"
            target="_blank"
            rel="noreferrer"
            data-tip="Open the author's GitHub in a new tab"
          >
            GitHub
          </a>
          <a
            href="https://www.linkedin.com/in/markcalendario"
            target="_blank"
            rel="noreferrer"
            data-tip="Open the author's LinkedIn in a new tab"
          >
            LinkedIn
          </a>
          <a href="mailto:markcalendario@gmail.com" data-tip="Email the author">
            Email
          </a>
        </div>
      </div>

      <p className="credits-colophon">
        Built with Claude Code. Sprites, sounds, and type are generated in the browser — no image or
        audio files ship with the app.
      </p>

      <div className="dialog-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={onClose}
          data-tip="Close and go back to Sylva"
        >
          Back to the {words.workspace.toLowerCase()}
        </button>
      </div>
    </Dialog>
  );
}
