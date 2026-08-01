import { describe, expect, it } from "vitest";
import { cleanCommitMessage } from "../src/services/commitMessage.js";

describe("cleanCommitMessage", () => {
  it("strips code fences the model adds despite being told not to", () => {
    expect(cleanCommitMessage("```\nFix the retry loop\n```")).toBe("Fix the retry loop");
    expect(cleanCommitMessage("```text\nFix the retry loop\n```")).toBe("Fix the retry loop");
  });

  it("strips matching wrapping quotes", () => {
    expect(cleanCommitMessage('"Fix the retry loop"')).toBe("Fix the retry loop");
    expect(cleanCommitMessage("'Fix the retry loop'")).toBe("Fix the retry loop");
  });

  it("strips a leading label", () => {
    expect(cleanCommitMessage("Commit message: Fix the retry loop")).toBe("Fix the retry loop");
    expect(cleanCommitMessage("Subject: Fix the retry loop")).toBe("Fix the retry loop");
  });

  it("keeps the body and its blank line", () => {
    const message = "Fix the retry loop\n\nBackoff was linear, so a slow service still dropped work.";
    expect(cleanCommitMessage(message)).toBe(message);
  });

  it("keeps quotes that are part of the message rather than wrapping it", () => {
    expect(cleanCommitMessage('Quote the "name" argument')).toBe('Quote the "name" argument');
    expect(cleanCommitMessage("Handle apostrophes like it's fine")).toBe(
      "Handle apostrophes like it's fine",
    );
  });

  it("does not mistake a fenced block inside a body for a wrapper", () => {
    const message = "Add a usage example\n\n```js\nwithRetry(fn)\n```";
    expect(cleanCommitMessage(message)).toBe(message);
  });

  it("returns empty for empty input so the caller can reject it", () => {
    expect(cleanCommitMessage("   ")).toBe("");
  });
});
