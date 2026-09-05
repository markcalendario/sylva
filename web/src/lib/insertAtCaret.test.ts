import { describe, expect, it } from "vitest";
import { insertAtCaret, removeFromText } from "./insertAtCaret";

/**
 * Where an attached file's path lands, and what surrounds it.
 *
 * The spacing rules are the whole point: a path welded to the previous word is
 * unreadable, and a path arriving with two spaces around it looks like it was
 * dropped there by accident — which, before this, it was.
 */
describe("inserting at the caret", () => {
  it("puts it in with nothing around it when the box is empty", () => {
    expect(insertAtCaret("", 0, "/tmp/a.png")).toEqual({ text: "/tmp/a.png", caret: 10 });
  });

  it("adds a space in front when a word runs up to the caret", () => {
    expect(insertAtCaret("look at", 7, "/tmp/a.png")).toEqual({
      text: "look at /tmp/a.png",
      caret: 18,
    });
  });

  it("doesn't add a second space when there is already one", () => {
    expect(insertAtCaret("look at ", 8, "/tmp/a.png")).toEqual({
      text: "look at /tmp/a.png",
      caret: 18,
    });
  });

  it("adds a space behind it when the sentence carries on", () => {
    const { text, caret } = insertAtCaret("compare against main", 8, "/tmp/a.png");
    expect(text).toBe("compare /tmp/a.png against main");
    // The caret sits after the path and its space, ready for the next word.
    expect(text.slice(0, caret)).toBe("compare /tmp/a.png ");
  });

  it("leaves an existing space behind it alone", () => {
    expect(insertAtCaret("a  b", 2, "X")).toEqual({ text: "a X b", caret: 3 });
  });

  it("treats a newline as spacing too", () => {
    expect(insertAtCaret("first line\n", 11, "/tmp/a.png")).toEqual({
      text: "first line\n/tmp/a.png",
      caret: 21,
    });
  });

  it("clamps a caret that is past the end", () => {
    expect(insertAtCaret("ab", 99, "X")).toEqual({ text: "ab X", caret: 4 });
  });
});

describe("taking a path back out", () => {
  it("removes it and the space that went in with it", () => {
    expect(removeFromText("compare /tmp/a.png against main", "/tmp/a.png")).toBe(
      "compare against main",
    );
  });

  it("leaves the sentence alone when the path isn't in it", () => {
    expect(removeFromText("nothing here", "/tmp/a.png")).toBe("nothing here");
  });

  it("doesn't eat a space that wasn't padding", () => {
    expect(removeFromText("/tmp/a.png", "/tmp/a.png")).toBe("");
  });

  it("only takes the first one, since the rest you typed", () => {
    expect(removeFromText("a X b X c", "X")).toBe("a b X c");
  });
});
