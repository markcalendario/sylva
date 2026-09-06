import { describe, expect, it } from "vitest";
import { PREFERENCE_DEFAULTS, type AppPreferences, type TerminalTarget } from "sylva-shared";
import { openExternal, resolveArgv } from "../src/services/open.js";

const WT = "/tmp/trees/feature branch";

function prefs(patch: Partial<AppPreferences> = {}): AppPreferences {
  return { ...PREFERENCE_DEFAULTS, ...patch };
}

/**
 * These pin down the argv, not the launch. Every one of them is a decision
 * about a platform the machine running the test is probably not on, which is
 * exactly why the platform is a parameter rather than something read off
 * `process` — otherwise two thirds of this file could only ever be checked by
 * whoever happened to be on Windows that week.
 */
/**
 * The desktop's own answer, which is the only one that can deal with a file
 * that isn't text. Same three commands as reveal, deliberately: handed a
 * directory the shell handler opens a window, handed a file it opens the file.
 */
describe("handing a file to the desktop", () => {
  const FILE = "/tmp/trees/feature branch/docs/plan.pdf";

  it("asks each platform's shell handler, and nothing else", () => {
    expect(resolveArgv(prefs(), "system", FILE, "darwin")).toEqual(["open", FILE]);
    expect(resolveArgv(prefs(), "system", FILE, "win32")).toEqual(["explorer.exe", FILE]);
    expect(resolveArgv(prefs(), "system", FILE, "linux")).toEqual(["xdg-open", FILE]);
  });

  /**
   * Neither of these is configurable, and both mean "ask the OS" — so if one
   * ever grows a flag the other doesn't want, this is what will notice.
   */
  it("resolves the same way as revealing a folder", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(resolveArgv(prefs(), "system", FILE, platform)).toEqual(
        resolveArgv(prefs(), "reveal", FILE, platform),
      );
    }
  });

  /** No editor is named at either end, so switching the editor off is irrelevant. */
  it("still works when the editor is switched off in Settings", () => {
    expect(resolveArgv(prefs({ editorTarget: "none" }), "system", FILE, "darwin")).toEqual([
      "open",
      FILE,
    ]);
  });
});

describe("opening a worktree in a terminal", () => {
  it("asks a Mac for the application, and hands it the path", () => {
    expect(resolveArgv(prefs(), "terminal", WT, "darwin")).toEqual(["open", "-a", "Terminal", WT]);
    expect(resolveArgv(prefs({ terminalApp: "iterm" }), "terminal", WT, "darwin")).toEqual([
      "open",
      "-a",
      "iTerm",
      WT,
    ]);
  });

  /**
   * No path, deliberately: these inherit the working directory they are
   * launched from, and a bare path as an argument would be read as a program
   * to run instead.
   */
  it("elsewhere names the binary and nothing else", () => {
    expect(resolveArgv(prefs(), "terminal", WT, "linux")).toEqual(["x-terminal-emulator"]);
    expect(resolveArgv(prefs({ terminalApp: "kitty" }), "terminal", WT, "linux")).toEqual([
      "kitty",
    ]);
  });

  it("uses Windows Terminal's own directory flag", () => {
    expect(resolveArgv(prefs(), "terminal", WT, "win32")).toEqual(["wt.exe", "-d", WT]);
  });

  it("refuses a terminal that doesn't exist on this platform", () => {
    expect(() => resolveArgv(prefs({ terminalApp: "iterm" }), "terminal", WT, "linux")).toThrow(
      /macOS/,
    );
    expect(() => resolveArgv(prefs({ terminalApp: "warp" }), "terminal", WT, "win32")).toThrow(
      /custom command/,
    );
  });

  it("substitutes {path} into a custom command, without a shell to reinterpret it", () => {
    const custom = prefs({
      terminalApp: "custom",
      terminalAppCommand: 'alacritty --working-directory "{path}"',
    });
    expect(resolveArgv(custom, "terminal", WT, "linux")).toEqual([
      "alacritty",
      "--working-directory",
      WT,
    ]);
  });

  it("says so when the terminal action is switched off or unconfigured", () => {
    expect(() =>
      resolveArgv(prefs({ terminalApp: "none" as TerminalTarget }), "terminal", WT, "darwin"),
    ).toThrow(/switched off/);
    expect(() =>
      resolveArgv(
        prefs({ terminalApp: "custom", terminalAppCommand: "  " }),
        "terminal",
        WT,
        "linux",
      ),
    ).toThrow(/No terminal command/);
  });

  it("leaves the editor and the file browser as they were", () => {
    expect(resolveArgv(prefs(), "editor", WT, "linux")).toEqual(["code", WT]);
    expect(resolveArgv(prefs(), "reveal", WT, "darwin")).toEqual(["open", WT]);
    expect(resolveArgv(prefs(), "reveal", WT, "win32")).toEqual(["explorer.exe", WT]);
  });
});

/**
 * The launch itself, which is the half a resolved argv can't speak for: a
 * terminal is let go of rather than waited on, so "did it start" has to be
 * answered by the spawn and nothing later.
 */
describe("launching one", () => {
  it("starts a custom command in the worktree and doesn't wait for it", async () => {
    const result = await openExternal(
      "/",
      prefs({ terminalApp: "custom", terminalAppCommand: "/bin/echo {path}" }),
      "terminal",
    );
    expect(result.ok).toBe(true);
    expect(result.ran).toBe("/bin/echo /");
  });

  it("says which command is missing rather than failing silently", async () => {
    await expect(
      openExternal(
        "/",
        prefs({ terminalApp: "custom", terminalAppCommand: "sylva-no-such-terminal {path}" }),
        "terminal",
      ),
    ).rejects.toThrow(/isn't on your PATH/);
  });
});
