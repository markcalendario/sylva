import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Slash } from "lucide-react";
import type { AgentCommand } from "sylva-shared";
import { api } from "../lib/api";
import { useWords } from "../lib/theme";

/** How many suggestions are worth showing at once. */
const MAX = 10;

/** The `/fragment` being typed, when one is. */
export interface SlashToken {
  /** Offset just past the fragment — the caret. */
  end: number;
  /** What has been typed after the `/`. */
  query: string;
}

/**
 * Is the caret inside a `/command` being typed?
 *
 * Only at the very start of the prompt, and only within the first word, because
 * that is the only place a slash command means anything: anywhere else a `/` is
 * a path separator or a date, and a popup over either would steal the Enter key
 * from someone who was just typing.
 */
export function slashAt(text: string, caret: number): SlashToken | null {
  if (!text.startsWith("/")) return null;
  const token = /^\/(\S*)/.exec(text);
  if (!token) return null;
  const end = 1 + (token[1]?.length ?? 0);
  // Past the command word — you are writing its arguments now, not choosing it.
  if (caret > end || caret < 1) return null;
  return { end: caret, query: text.slice(1, caret) };
}

/** Put a chosen command into the text, replacing the `/fragment` that summoned it. */
export function applySlash(
  text: string,
  token: SlashToken,
  name: string,
): { text: string; caret: number } {
  // The command word ends where the first space does, whatever the caret was
  // sitting in the middle of.
  const rest = text.slice(token.end).replace(/^\S*/, "");
  // A trailing space, because a command is usually followed by what it acts on
  // — and when it isn't, one trailing space costs nothing.
  const insert = `/${name} `;
  return { text: `${insert}${rest.trimStart()}`, caret: insert.length };
}

/** Rank by where the typed letters land: a prefix beats a match in the middle. */
export function rankCommands(commands: AgentCommand[], query: string): AgentCommand[] {
  const q = query.toLowerCase();
  if (!q) return commands.slice(0, MAX);

  const scored: { command: AgentCommand; score: number }[] = [];
  for (const command of commands) {
    const names = [command.name, ...(command.aliases ?? [])];
    let best = -1;
    for (const name of names) {
      const at = name.toLowerCase().indexOf(q);
      if (at === -1) continue;
      const score = at === 0 ? 0 : 1;
      if (best === -1 || score < best) best = score;
    }
    if (best !== -1) scored.push({ command, score: best });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name))
    .slice(0, MAX)
    .map((s) => s.command);
}

/**
 * `/command` completion for the prompt box.
 *
 * Claude Code has commands and skills, and a repository can add its own — but
 * from inside Sylva none of that was discoverable: you typed `/` and got a
 * slash. So the list comes from the agent itself, for this worktree, which is
 * the only place that knows what this worktree offers.
 */
export function SlashCommands({
  worktreeId,
  token,
  onPick,
  onDismiss,
}: {
  worktreeId: string;
  /** Null when no `/` is being typed — the popup simply isn't there. */
  token: SlashToken | null;
  onPick: (name: string) => void;
  onDismiss: () => void;
}) {
  const words = useWords();
  // Only asked once someone reaches for it: the answer costs a Claude Code
  // process when no turn is running, and most prompts never start with a slash.
  const commands = useQuery({
    queryKey: ["commands", worktreeId],
    queryFn: () => api.listCommands(worktreeId),
    enabled: token !== null,
    staleTime: 2 * 60_000,
  });

  const suggestions = rankCommands(commands.data ?? [], token?.query ?? "");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // A new fragment is a new list; the highlight belongs at the top of it.
  useEffect(() => setCursor(0), [token?.query]);

  useEffect(() => {
    setCursor((c) => (c >= suggestions.length ? 0 : c));
  }, [suggestions.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".mention-on")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  /**
   * The keys the popup owns while it is open, handed up to the textarea's own
   * handler — which has to ask first, because Enter means "send" when there is
   * no popup and "choose this" when there is.
   */
  useEffect(() => {
    if (!token || suggestions.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => (c + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => (c - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        const chosen = suggestions[cursor];
        if (!chosen) return;
        e.preventDefault();
        e.stopPropagation();
        onPick(chosen.name);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    // Capture, so it runs before the textarea's Enter-sends handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [token, suggestions, cursor, onPick, onDismiss]);

  if (!token) return null;

  // Asking takes a moment when nothing is running here; saying so beats a
  // popup that appears a second after you have given up on it.
  if (commands.isLoading) {
    return (
      <div className="mentions mentions-note" role="status">
        Asking the {words.agent} what it answers to…
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  return (
    <div className="mentions" role="listbox" aria-label="Commands" ref={listRef}>
      {suggestions.map((command, i) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={i === cursor}
          className={`mention ${i === cursor ? "mention-on" : ""}`}
          onMouseMove={() => setCursor(i)}
          // The textarea must not lose focus, or the caret we are about to
          // write to goes with it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(command.name)}
        >
          <Slash size={12} />
          <span className="mention-name">/{command.name}</span>
          {command.argumentHint && <span className="slash-args">{command.argumentHint}</span>}
          <span className="slash-desc">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
