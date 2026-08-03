import { describe, expect, it } from "vitest";
import { cyclesTabs } from "./shortcuts";

/**
 * Which keystroke steps the tabs. Worth pinning down on its own because the
 * costly mistakes here are the false positives: a chord that fires while you
 * are typing moves the pane out from under you mid-sentence.
 */
function press(over: Partial<Parameters<typeof cyclesTabs>[0]>) {
  return cyclesTabs({
    code: "",
    key: "",
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...over,
  });
}

describe("the tab-cycling chord", () => {
  it("fires on Option+Tab", () => {
    expect(press({ code: "Tab", key: "Tab", altKey: true })).toBe(true);
  });

  it("fires on Win+Tab, for the platform that asked for it", () => {
    expect(press({ code: "Tab", key: "Tab", metaKey: true })).toBe(true);
  });

  it("fires on Alt+backquote, which Windows actually lets through", () => {
    expect(press({ code: "Backquote", key: "`", altKey: true })).toBe(true);
  });

  it("leaves a bare Tab alone, so focus still moves normally", () => {
    expect(press({ code: "Tab", key: "Tab" })).toBe(false);
  });

  it("leaves a bare backquote alone, so it can still be typed", () => {
    expect(press({ code: "Backquote", key: "`" })).toBe(false);
  });

  it("ignores AltGr, which arrives as ctrl+alt and types characters", () => {
    expect(press({ code: "Backquote", key: "`", altKey: true, ctrlKey: true })).toBe(false);
    expect(press({ code: "Tab", key: "Tab", altKey: true, ctrlKey: true })).toBe(false);
  });

  it("ignores every other key", () => {
    expect(press({ code: "KeyT", key: "t", altKey: true })).toBe(false);
  });
});
