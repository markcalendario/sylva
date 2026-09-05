import { describe, expect, it } from "vitest";
import { iconFor, splitPath } from "./FileGlyph";

/**
 * What a change list decides about a path before it draws it.
 *
 * Both answers are ones a screenshot can't check: which icon a name earns, and
 * where a path may be cut. The interesting cases are all names that don't look
 * like `name.ext` — dotfiles, files that are only a name, paths carrying dots
 * in their directories — and those are exactly the ones nobody has on screen
 * when the row is being designed.
 */

describe("choosing an icon for a path", () => {
  it("reads the extension, wherever the file lives", () => {
    expect(iconFor("web/src/components/GitSection.tsx")).toBe(iconFor("other.tsx"));
    expect(iconFor("a/b/c/styles.css")).toBe(iconFor("styles.css"));
  });

  it("doesn't mistake a directory's dots for an extension", () => {
    expect(iconFor("some.dir/v1.2/Makefile")).toBe(iconFor("Makefile"));
    expect(iconFor("v1.2.3/notes.md")).toBe(iconFor("notes.md"));
  });

  it("treats a dotfile's name as its type", () => {
    // `.env` is an env file, not a file with an "env" extension by accident —
    // and either way it must not be read as an extensionless nothing.
    expect(iconFor(".gitignore")).toBe(iconFor("deploy/.gitignore"));
    expect(iconFor(".env.local")).toBe(iconFor("config.env"));
  });

  it("ignores case, the way the filesystem it came from does", () => {
    expect(iconFor("Dockerfile")).toBe(iconFor("dockerfile"));
    expect(iconFor("PHOTO.PNG")).toBe(iconFor("photo.png"));
  });

  it("has something to draw for a name it has never seen", () => {
    expect(iconFor("scratch")).toBeTruthy();
    expect(iconFor("archive.qqq")).toBeTruthy();
  });
});

describe("cutting a path to fit", () => {
  it("pins the file name and gives up the directories", () => {
    expect(splitPath("web/src/components/GitSection.tsx")).toEqual({
      lead: "web/src/components",
      tail: "/GitSection.tsx",
    });
  });

  it("keeps the separator with the name, so the cut still reads as a path", () => {
    const { tail } = splitPath("a/b/c.ts");
    expect(tail.startsWith("/")).toBe(true);
  });

  it("has nothing to give up when the file is at the root", () => {
    expect(splitPath("README.md")).toEqual({ lead: "", tail: "README.md" });
  });

  it("puts the whole path back together again", () => {
    for (const path of ["a/b/c.ts", "README.md", "one/two", ".gitignore", "a/.env"]) {
      const { lead, tail } = splitPath(path);
      expect(lead + tail).toBe(path);
    }
  });
});
