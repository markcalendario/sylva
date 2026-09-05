import { describe, expect, it } from "vitest";
import { attachmentLabels, attachmentNote, relabelAttachments } from "./attachments";

describe("attachment labels", () => {
  it("uses the file's own name", () => {
    expect(attachmentLabels(["photo.png", "notes.md"])).toEqual(["photo.png", "notes.md"]);
  });

  it("suffixes a repeat before the extension, and leaves the first alone", () => {
    expect(attachmentLabels(["photo.png", "photo.png", "photo.png"])).toEqual([
      "photo.png",
      "photo (2).png",
      "photo (3).png",
    ]);
  });

  it("treats a leading dot as a name, not an extension", () => {
    expect(attachmentLabels([".env", ".env"])).toEqual([".env", ".env (2)"]);
  });

  it("counts each name separately", () => {
    expect(attachmentLabels(["a.txt", "b.txt", "a.txt"])).toEqual(["a.txt", "b.txt", "a (2).txt"]);
  });
});

describe("relabelling a prompt", () => {
  it("renames the tokens whose labels moved", () => {
    const text = "compare [photo.png] against [photo (2).png]";
    // The first photo.png was removed, so the second is promoted.
    expect(relabelAttachments(text, ["photo (2).png"], ["photo.png"])).toBe(
      "compare [photo.png] against [photo.png]",
    );
  });

  it("leaves a label that didn't move", () => {
    const text = "look at [a.txt]";
    expect(relabelAttachments(text, ["a.txt"], ["a.txt"])).toBe(text);
  });
});

describe("the attachments block", () => {
  it("is nothing at all when there are no attachments", () => {
    expect(attachmentNote([])).toBe("");
  });

  it("lists every attachment, named the way the sentence names it", () => {
    expect(
      attachmentNote([
        { label: "photo.png", path: "/tmp/1-photo.png" },
        { label: "photo (2).png", path: "/tmp/2-photo.png" },
      ]),
    ).toBe("\n\nAttachments:\nphoto.png: /tmp/1-photo.png\nphoto (2).png: /tmp/2-photo.png");
  });
});
