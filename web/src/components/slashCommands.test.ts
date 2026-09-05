import { describe, expect, it } from "vitest";
import type { AgentCommand } from "sylva-shared";
import { applySlash, rankCommands, slashAt } from "./SlashCommands";

/**
 * Deciding whether a `/` is the start of a command.
 *
 * The eager direction is the failure that matters: paths and dates are full of
 * slashes, and a popup over one steals the Enter key from someone who was only
 * trying to send their prompt. A slash command is only a command at the very
 * start of the message, which is also the only place Claude Code honours one.
 */
describe("finding the command under the caret", () => {
  /** Caret at the end, which is where it is while you type. */
  const at = (text: string) => slashAt(text, text.length);

  it("finds a bare slash with nothing typed yet", () => {
    expect(at("/")).toEqual({ end: 1, query: "" });
  });

  it("finds one being typed", () => {
    expect(at("/comm")).toEqual({ end: 5, query: "comm" });
  });

  it("ignores a slash that isn't at the start", () => {
    expect(at("look at src/app.ts")).toBeNull();
  });

  it("ignores a slash on a later line", () => {
    expect(at("do this\n/clear")).toBeNull();
  });

  it("lets go once you are past the command word", () => {
    expect(at("/review my changes")).toBeNull();
  });

  it("still holds while the caret is inside the word", () => {
    expect(slashAt("/review", 4)).toEqual({ end: 4, query: "rev" });
  });

  it("lets go when the caret is behind the slash", () => {
    expect(slashAt("/review", 0)).toBeNull();
  });
});

describe("putting the chosen command in", () => {
  it("replaces what was typed", () => {
    expect(applySlash("/rev", { end: 4, query: "rev" }, "review")).toEqual({
      text: "/review ",
      caret: 8,
    });
  });

  it("keeps the arguments already after it", () => {
    // Caret mid-word, arguments trailing: the word is replaced, the rest stays.
    expect(applySlash("/rev the diff", { end: 4, query: "rev" }, "review")).toEqual({
      text: "/review the diff",
      caret: 8,
    });
  });
});

describe("ranking what matches", () => {
  const commands: AgentCommand[] = [
    { name: "clear", description: "", argumentHint: "" },
    { name: "code-review", description: "", argumentHint: "" },
    { name: "review", description: "", argumentHint: "", aliases: ["rv"] },
  ];

  it("puts a prefix match ahead of one in the middle", () => {
    expect(rankCommands(commands, "review").map((c) => c.name)).toEqual(["review", "code-review"]);
  });

  it("matches an alias too", () => {
    expect(rankCommands(commands, "rv").map((c) => c.name)).toEqual(["review"]);
  });

  it("offers everything when nothing has been typed", () => {
    expect(rankCommands(commands, "")).toHaveLength(3);
  });

  it("offers nothing when nothing matches", () => {
    expect(rankCommands(commands, "zzz")).toEqual([]);
  });
});
