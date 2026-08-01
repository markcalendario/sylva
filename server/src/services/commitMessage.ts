import { query } from "@anthropic-ai/claude-agent-sdk";
import { badRequest, HttpError } from "../lib/errors.js";
import type { GitService } from "./git.js";
import type { Store } from "./store.js";
import type { Workspace } from "./workspace.js";

/**
 * Large diffs get truncated rather than refused: the file list plus the first
 * slice of the patch is nearly always enough to write a subject line, and a
 * hard failure on a big commit is the worse outcome.
 */
const MAX_DIFF_CHARS = 60_000;
const TIMEOUT_MS = 90_000;
/** A commit message is a few dozen tokens; anything past this is a runaway. */
const MAX_BUDGET_USD = 0.5;

const SYSTEM_PROMPT = `You write git commit messages. You are given a staged diff and reply with the commit message alone.

Rules:
- First line: imperative mood, no trailing period, under 72 characters ("Add retry to the git queue", not "Added..." or "This adds...").
- Describe why the change was made and what it achieves, not a file-by-file list of edits.
- Add a body only when the reason isn't obvious from the subject. Separate it with a blank line and wrap at 72 characters.
- Match the style of the recent commits you are shown — if they use a prefix convention like "feat:" or "fix:", follow it; if they don't, don't invent one.
- Output the raw commit message and nothing else. No markdown fences, no surrounding quotes, no preamble like "Here is the commit message".`;

/** Strip the wrappers models add even when told not to. */
export function cleanCommitMessage(raw: string): string {
  let out = raw.trim();

  // ```\n...\n``` or ```text\n...\n```
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(out);
  if (fenced?.[1] !== undefined) out = fenced[1].trim();

  // Whole message wrapped in matching quotes.
  if (out.length > 1) {
    const first = out[0];
    if ((first === '"' || first === "'") && out.endsWith(first)) {
      out = out.slice(1, -1).trim();
    }
  }

  // A leading "Subject:"-style label on the first line only.
  out = out.replace(/^(?:commit message|subject|message)\s*:\s*/i, "");

  return out.trim();
}

/**
 * Drafts a commit message from the staged diff using a one-off agent query.
 *
 * Deliberately separate from the worktree's chat session: this must work while
 * the dryad is mid-turn, and it should leave no trace in the transcript. The
 * query runs with every built-in tool disabled — the diff travels in the prompt,
 * so there is nothing for it to read, run, or edit.
 */
export class CommitMessageService {
  constructor(
    private git: GitService,
    private workspace: Workspace,
    private store: Store,
  ) {}

  async generate(worktreeId: string): Promise<{ message: string }> {
    const { worktree } = await this.workspace.resolveWorktree(worktreeId);

    const { stdout: nameStatus } = await this.git.run(worktree.path, [
      "diff",
      "--cached",
      "--name-status",
    ]);
    if (!nameStatus.trim()) throw badRequest("Nothing staged to describe");

    const { stdout: rawPatch } = await this.git.run(worktree.path, [
      "diff",
      "--cached",
      "--no-color",
    ]);
    const truncated = rawPatch.length > MAX_DIFF_CHARS;
    const patch = truncated ? rawPatch.slice(0, MAX_DIFF_CHARS) : rawPatch;

    // Recent subjects let the model match the repo's existing convention.
    let recent = "";
    try {
      const { stdout } = await this.git.run(worktree.path, [
        "log",
        "-n",
        "10",
        "--format=%s",
      ]);
      recent = stdout.trim();
    } catch {
      // A repo with no commits yet has no history to match; that's fine.
    }

    const prompt = [
      recent && `Recent commit messages in this repository:\n${recent}`,
      `Files staged for this commit:\n${nameStatus.trim()}`,
      `Staged diff:\n${patch}`,
      truncated &&
        "(The diff above was truncated. Base the message on the full file list and the portion shown.)",
      "Write the commit message for this change.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const prefs = this.store.effectiveFor(worktreeId);
    const text = await this.ask(prompt, worktree.path, prefs.model);
    const message = cleanCommitMessage(text);
    if (!message) {
      throw new HttpError(502, "The dryad returned an empty commit message");
    }
    return { message };
  }

  private async ask(
    prompt: string,
    cwd: string,
    model: string | null,
  ): Promise<string> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS);

    try {
      const q = query({
        prompt,
        options: {
          cwd,
          abortController,
          // Everything it needs is in the prompt; no tools means no permission
          // prompts, no filesystem reach, and one round trip.
          tools: [],
          // Don't inherit CLAUDE.md or user settings — they're written to steer
          // coding sessions and only skew a commit message.
          settingSources: [],
          systemPrompt: SYSTEM_PROMPT,
          maxTurns: 1,
          maxBudgetUsd: MAX_BUDGET_USD,
          effort: "low",
          ...(model ? { model } : {}),
        },
      });

      let text = "";
      for await (const message of q) {
        if (message.type !== "assistant") continue;
        for (const block of message.message.content) {
          if (block.type === "text") text += block.text;
        }
      }
      return text;
    } catch (err) {
      if (abortController.signal.aborted) {
        throw new HttpError(504, "Timed out drafting a commit message");
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new HttpError(502, "Couldn't draft a commit message", detail);
    } finally {
      clearTimeout(timer);
    }
  }
}
