import { describe, expect, it } from "vitest";
import { applyMention, mentionAt } from "./PathMentions";

/**
 * Deciding whether an `@` is the start of a file mention.
 *
 * Getting this wrong in the eager direction is the failure that matters: a
 * popup that appears over an email address, a decorator or an npm scope steals
 * the Enter key from someone who was only trying to send their prompt.
 */
describe("finding the mention under the caret", () => {
  /** Caret at the end, which is where it is while you type. */
  const at = (text: string) => mentionAt(text, text.length);

  it("finds one at the start of the text", () => {
    expect(at("@src/app")).toEqual({ start: 0, end: 8, query: "src/app" });
  });

  it("finds one after a space", () => {
    expect(at("look at @store")).toEqual({ start: 8, end: 14, query: "store" });
  });

  it("finds one after a newline", () => {
    expect(at("look at this:\n@store")).toEqual({ start: 14, end: 20, query: "store" });
  });

  it("finds a bare @ with nothing typed yet", () => {
    expect(at("fix @")).toEqual({ start: 4, end: 5, query: "" });
  });

  it("says nothing when there is no @ at all", () => {
    expect(at("fix the store")).toBeNull();
  });

  /* The eager-direction failures, one per shape that contains a stray @. */
  it("ignores an email address", () => {
    expect(at("mail me@example.com")).toBeNull();
  });

  it("ignores an npm scope", () => {
    expect(at("install @scope/pkg")).not.toBeNull(); // leading @ after a space is a mention
    expect(at("install pkg@1.2.3")).toBeNull();
  });

  it("ignores a decorator written mid-token", () => {
    expect(at("use foo@bar")).toBeNull();
  });

  it("ends the mention at a space", () => {
    expect(at("@src/app.ts and then")).toBeNull();
  });

  it("reads the caret, not the end of the text", () => {
    const text = "@store and more";
    expect(mentionAt(text, 6)).toEqual({ start: 0, end: 6, query: "store" });
  });

  it("has nothing to find at the very start", () => {
    expect(mentionAt("", 0)).toBeNull();
  });
});

describe("inserting a chosen path", () => {
  it("replaces the fragment that summoned the list", () => {
    const text = "look at @sto";
    const mention = mentionAt(text, text.length)!;
    expect(applyMention(text, mention, "web/src/state/store.ts")).toEqual({
      text: "look at web/src/state/store.ts ",
      caret: 31,
    });
  });

  it("keeps whatever followed the caret", () => {
    const text = "look at @sto and tell me";
    const mention = mentionAt(text, 12)!;
    const out = applyMention(text, mention, "store.ts");
    expect(out.text).toBe("look at store.ts  and tell me");
  });

  it("leaves the caret after the inserted path", () => {
    const text = "@a";
    const mention = mentionAt(text, 2)!;
    const out = applyMention(text, mention, "x.ts");
    expect(out.text.slice(0, out.caret)).toBe("x.ts ");
  });
});
