import { useEffect, useRef } from "react";

export interface PromptMark {
  /** Index of the block in the rendered transcript. */
  blockIndex: number;
  text: string;
}

/**
 * Jump list of everything you've asked in this worktree. The active entry
 * follows the chat as it scrolls, so the rail doubles as a position indicator.
 *
 * The rail scrolls itself to keep that entry in the middle. A position
 * indicator you have to go looking for isn't one: in a long conversation the
 * highlight otherwise drifts off the end of the rail while you read, and the
 * list stops answering "where am I" until you scroll it by hand. Centred also
 * beats merely-visible, because the middle is the one position that shows what
 * came before *and* what comes next.
 */
export function PromptNav({
  prompts,
  activeIndex,
  onJump,
}: {
  prompts: PromptMark[];
  activeIndex: number | null;
  onJump: (blockIndex: number) => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    const item = activeRef.current;
    if (!rail || !item) return;

    // Measured rather than read off offsetTop: the buttons' offsetParent is the
    // chat body, not the rail, so offsets here are about the wrong box.
    const railBox = rail.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const drift =
      itemBox.top + itemBox.height / 2 - (railBox.top + railBox.height / 2);

    const top = Math.max(0, Math.min(rail.scrollTop + drift, rail.scrollHeight - rail.clientHeight));
    // Already centred — within a pixel, which rounding alone can produce.
    if (Math.abs(top - rail.scrollTop) < 1) return;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ top, behavior: still ? "auto" : "smooth" });
    // The list length matters too: a prompt landing above the active one moves
    // it down the rail without changing which one is active.
  }, [activeIndex, prompts.length]);

  if (prompts.length === 0) return null;

  return (
    <nav className="prompt-nav" aria-label="Your prompts" ref={railRef}>
      <div className="prompt-nav-label" data-tip="Jump to any prompt you've sent in this worktree">
        your prompts
      </div>
      <ol className="prompt-nav-list">
        {prompts.map((p, i) => {
          const active = activeIndex === p.blockIndex;
          return (
            <li key={p.blockIndex}>
              <button
                className={`prompt-nav-item ${active ? "prompt-nav-on" : ""}`}
                {...(active ? { ref: activeRef } : {})}
                onClick={() => onJump(p.blockIndex)}
                data-tip={`Jump to this prompt · ${p.text}`}
                aria-current={active ? "true" : undefined}
              >
                <span className="prompt-nav-num">{i + 1}</span>
                <span className="prompt-nav-text">{p.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
