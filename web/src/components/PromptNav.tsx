export interface PromptMark {
  /** Index of the block in the rendered transcript. */
  blockIndex: number;
  text: string;
}

/**
 * Jump list of everything you've asked in this worktree. The active entry
 * follows the chat as it scrolls, so the rail doubles as a position indicator.
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
  if (prompts.length === 0) return null;

  return (
    <nav className="prompt-nav" aria-label="Your prompts">
      <div className="prompt-nav-label">your prompts</div>
      <ol className="prompt-nav-list">
        {prompts.map((p, i) => (
          <li key={p.blockIndex}>
            <button
              className={`prompt-nav-item ${activeIndex === p.blockIndex ? "prompt-nav-on" : ""}`}
              onClick={() => onJump(p.blockIndex)}
              title={p.text}
              aria-current={activeIndex === p.blockIndex ? "true" : undefined}
            >
              <span className="prompt-nav-num">{i + 1}</span>
              <span className="prompt-nav-text">{p.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
