/**
 * How an attached file is named in a prompt.
 *
 * Attaching used to write the file's absolute path into the sentence, which is
 * what the agent needs and nothing like what you meant to say. A path is forty
 * characters of machine detail in the middle of "look at this" — it wrecks the
 * line you are writing, and you have to read around it to check the sentence
 * still makes sense.
 *
 * So the sentence carries the name and the message carries the paths: the
 * caret gets `[photo.png]`, and the paths go under an Attachments heading at
 * the end, where the agent finds them and you never have to look.
 */

/** What goes in the sentence: the label, bracketed so it reads as one thing. */
export function attachmentToken(label: string): string {
  return `[${label}]`;
}

/**
 * A display name per attachment, in order.
 *
 * Two files can arrive with the same name from different folders, and two
 * identical `[photo.png]` tokens would leave the agent guessing which one the
 * sentence meant. The second gets `photo (2).png` — suffixed before the
 * extension, the way every file manager does it, so it still reads as a name.
 *
 * The first of a name always keeps it. That is what lets attaching a file
 * leave the labels already written into the sentence alone.
 */
export function attachmentLabels(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen === 0) return name;

    const dot = name.lastIndexOf(".");
    // A leading dot is the whole name (".env"), not an extension.
    return dot > 0
      ? `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}`
      : `${name} (${seen + 1})`;
  });
}

/**
 * Rename the tokens already written into a prompt.
 *
 * Removing one of two files called photo.png promotes the other from
 * `photo (2).png` back to `photo.png`, and the sentence has to follow — a
 * token naming a label nothing is called any more is a dangling reference.
 */
export function relabelAttachments(text: string, from: string[], to: string[]): string {
  let out = text;
  for (const [i, before] of from.entries()) {
    const after = to[i];
    if (after === undefined || after === before) continue;
    out = out.replace(attachmentToken(before), attachmentToken(after));
  }
  return out;
}

/**
 * The block that goes after the prompt.
 *
 * Every attachment is listed, including the ones named in the sentence: the
 * name in the sentence is what you wrote, and this is where it resolves. An
 * agent reading `[photo.png]` mid-sentence has somewhere to look it up.
 */
export function attachmentNote(items: { label: string; path: string }[]): string {
  if (items.length === 0) return "";
  const lines = items.map((item) => `${item.label}: ${item.path}`).join("\n");
  return `\n\nAttachments:\n${lines}`;
}
