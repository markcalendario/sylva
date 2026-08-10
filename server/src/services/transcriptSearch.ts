import { readdir, readFile } from "node:fs/promises";
import type {
  AgentEvent,
  TranscriptHit,
  TranscriptSearchMode,
  TranscriptSearchResponse,
} from "sylva-shared";
import type { Store } from "./store.js";

/** Enough rows to answer the question; short enough to render as a list. */
const MAX_HITS = 150;

/** Per conversation, so one enormous session can't fill the whole answer. */
const MAX_PER_SESSION = 25;

/**
 * A transcript larger than this is skipped rather than read into memory.
 *
 * A day-long session runs to a few megabytes, which is fine; this is a guard
 * against a pathological one, not a normal limit.
 */
const MAX_BYTES = 12 * 1024 * 1024;

/** What a row shows. Long prompts and long commands are cut, not wrapped. */
function clamp(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Tools whose label is a path rather than prose.
 *
 * This list is what keeps file search honest. Matching every tool's text
 * against a path sounds more thorough and is worse: a `git add` naming six
 * files, or an `rm -rf` whose flags happen to contain the word, all match — and
 * thirty Bash rows bury the four edits that actually answer the question.
 * Commands that mention a path are still findable, in the mode meant for it.
 */
const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Does this step touch the file being asked about?
 *
 * Two sources, in order of trust. Events written since Sylva started resolving
 * file references carry the worktree and path outright, which is exact. Older
 * ones don't, so a file tool's own label is matched as well — for Read, Write
 * and Edit that label *is* the path, sometimes clipped at the front, which is
 * why this matches on a fragment rather than on equality.
 */
function mentionsFile(event: AgentEvent, needle: string): boolean {
  if (event.kind !== "tool-use") return false;
  if (event.file) return event.file.path.toLowerCase().includes(needle);
  if (!FILE_TOOLS.has(event.tool)) return false;
  if (event.summary.toLowerCase().includes(needle)) return true;
  return typeof event.detail === "string" && event.detail.toLowerCase().includes(needle);
}

/** Does this event say the words being asked about? */
function mentionsText(event: AgentEvent, needle: string): boolean {
  switch (event.kind) {
    case "user-prompt":
    case "assistant-text":
      return event.text.toLowerCase().includes(needle);
    case "tool-use":
      return (
        event.summary.toLowerCase().includes(needle) ||
        (typeof event.detail === "string" && event.detail.toLowerCase().includes(needle))
      );
    default:
      return false;
  }
}

/** The line a row shows for a matching event. */
function summarize(event: AgentEvent): string | null {
  switch (event.kind) {
    case "user-prompt":
      return clamp(event.text);
    case "assistant-text":
      return clamp(event.text);
    case "tool-use":
      return clamp(event.summary);
    default:
      return null;
  }
}

/** A transcript to read, and whatever is known about whose it was. */
interface Conversation {
  id: string;
  worktreeId: string;
  repoId: string;
}

/**
 * Every transcript on disk, not merely every session in the registry.
 *
 * These drift apart, and by a lot: the registry drops a session when its repo
 * is forgotten or its worktree removed, but the transcript file stays. On a
 * real machine a third of the conversations were orphaned this way — including,
 * inevitably, the one holding the answer. They are still worth reading; the
 * only thing missing is which worktree they belonged to, and a row that can't
 * be jumped to still tells you what happened and when.
 */
async function conversations(store: Store): Promise<Conversation[]> {
  const known = new Map(store.sessions.map((s) => [s.id, s]));
  const out: Conversation[] = store.sessions.map((s) => ({
    id: s.id,
    worktreeId: s.worktreeId,
    repoId: s.repoId,
  }));

  try {
    for (const name of await readdir(store.sessionsDir)) {
      if (!name.endsWith(".jsonl")) continue;
      const id = name.slice(0, -".jsonl".length);
      // An empty worktreeId is how a hit says "I can't take you there".
      if (!known.has(id)) out.push({ id, worktreeId: "", repoId: "" });
    }
  } catch {
    // No sessions directory yet; the registry's own list is the whole answer.
  }
  return out;
}

/**
 * Which dryads touched this file, and when.
 *
 * Running several agents at once means losing track of which one did what
 * within about an hour — and the answer is already written down, in a
 * transcript per session that nothing could read across. This reads across
 * them.
 *
 * Every session is searched, not just open ones: the question is usually about
 * a worktree you are no longer looking at, which is precisely why you are
 * asking rather than scrolling.
 */
export async function searchTranscripts(
  store: Store,
  query: string,
  mode: TranscriptSearchMode,
): Promise<TranscriptSearchResponse> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { query, mode, hits: [], sessionsSearched: 0, truncated: false };
  }

  const matches = mode === "file" ? mentionsFile : mentionsText;
  const hits: TranscriptHit[] = [];
  let sessionsSearched = 0;
  let truncated = false;

  for (const session of await conversations(store)) {
    let raw: string;
    try {
      raw = await readFile(store.transcriptPath(session.id), "utf8");
    } catch {
      // A session whose transcript has been cleared, or was never written.
      continue;
    }
    if (raw.length > MAX_BYTES) {
      truncated = true;
      continue;
    }
    sessionsSearched++;

    let fromThisSession = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let event: AgentEvent;
      try {
        event = JSON.parse(line) as AgentEvent;
      } catch {
        // One unparseable line is not a reason to abandon the conversation.
        continue;
      }
      if (!matches(event, needle)) continue;

      const summary = summarize(event);
      if (summary === null) continue;

      hits.push({
        sessionId: session.id,
        worktreeId: session.worktreeId,
        repoId: session.repoId,
        at: "at" in event ? event.at : "",
        kind: event.kind as TranscriptHit["kind"],
        ...(event.kind === "tool-use" ? { tool: event.tool } : {}),
        summary,
        ...(event.kind === "tool-use" && event.file ? { file: event.file } : {}),
      });

      if (++fromThisSession >= MAX_PER_SESSION) {
        truncated = true;
        break;
      }
    }
  }

  // Newest first: what a dryad did an hour ago is nearly always the thing being
  // asked about, and last Tuesday is nearly never.
  hits.sort((a, b) => b.at.localeCompare(a.at));
  if (hits.length > MAX_HITS) {
    truncated = true;
    hits.length = MAX_HITS;
  }

  return { query, mode, hits, sessionsSearched, truncated };
}
