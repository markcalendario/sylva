/**
 * Drop a piece of text into a prompt where the caret was, spaced sensibly.
 *
 * Attaching a file used to say nothing about where in the sentence it belonged:
 * the paths were bolted onto the end of the prompt at send time, under a
 * heading, after whatever you had written. That is fine for "here are three
 * screenshots" and wrong for "compare THIS against the one in main" — the
 * position in the sentence *is* the instruction, and it was the one thing you
 * couldn't say.
 *
 * The spacing is the whole subtlety. A path pushed against the preceding word
 * makes a token neither you nor the agent can read, and a path with two spaces
 * either side reads as an afterthought — so one space is added on each side,
 * and only where there isn't one already.
 */
export function insertAtCaret(
  text: string,
  caret: number,
  insert: string,
): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);

  const needsLead = before.length > 0 && !/\s$/.test(before);
  // No trailing space at the very end of the text: the caret lands after the
  // path, and the next thing typed puts its own space in front of itself.
  const needsTail = after.length > 0 && !/^\s/.test(after);

  const body = `${needsLead ? " " : ""}${insert}${needsTail ? " " : ""}`;
  return { text: `${before}${body}${after}`, caret: at + body.length };
}

/**
 * Take a path back out of a prompt, along with one of the spaces around it.
 *
 * The counterpart to the above: removing an attachment has to remove what
 * attaching it wrote, or the sentence keeps pointing at a file you just said
 * you didn't mean. Only the first occurrence — if you typed the path a second
 * time yourself, that one is yours.
 */
export function removeFromText(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at === -1) return text;
  const before = text.slice(0, at);
  const after = text.slice(at + needle.length);
  // Spaced on both sides: one of them went in with the path, so one comes out.
  if (/\s$/.test(before) && /^\s/.test(after)) return before + after.slice(1);
  return before + after;
}
