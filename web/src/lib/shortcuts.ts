import { useEffect } from "react";
import { useSylva } from "../state/store";

/**
 * Keyboard shortcuts that belong to the window rather than to any one widget.
 *
 * They listen in the capture phase, on the way *down* to whatever has focus,
 * because the two places you most want to leave with the keyboard are the two
 * that would otherwise eat the keystroke: the prompt box, and a terminal, where
 * xterm claims every key it can turn into bytes for the shell.
 */

/** macOS, near enough for deciding which chord to name in a tooltip. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

/**
 * The chord that cycles tabs, written the way this platform writes it — and,
 * off macOS, the one that can actually be pressed. Win+Tab is bound too, but
 * naming it in a tooltip would be advertising a key Windows intercepts.
 */
export function tabCycleChord(): string {
  return isMac() ? "⌥ Tab" : "Alt + `";
}

/** Just the parts of a keydown a chord is decided from. */
type Chord = Pick<KeyboardEvent, "code" | "key" | "altKey" | "metaKey" | "ctrlKey">;

/**
 * Is this the "next tab" chord?
 *
 * Option+Tab on macOS, and the Windows key with Tab elsewhere — which is what
 * was asked for, though Windows keeps Win+Tab for Task View and the browser is
 * never told it happened. Alt+backquote is accepted everywhere as the nearest
 * chord Windows and Chrome both leave alone, so the shortcut is reachable there
 * too.
 *
 * Ctrl disqualifies everything: AltGr arrives as ctrl+alt, and on the layouts
 * that type a backquote with it, typing one must not jump you to another tab.
 */
export function cyclesTabs(e: Chord): boolean {
  if (e.ctrlKey) return false;
  if (e.code === "Tab" || e.key === "Tab") return e.altKey || e.metaKey;
  if (e.code === "Backquote") return e.altKey && !e.metaKey;
  return false;
}

/**
 * Option+Tab walks the pane's tabs: Agent → Files → Git → Terminal → Agent.
 * Holding shift walks back the other way, the way shift-tab always has.
 */
export function useTabCycleShortcut(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !cyclesTabs(e)) return;
      // A modal is its own little world; stepping the tabs behind it would
      // change something you can't see.
      if (document.querySelector("dialog[open]")) return;
      useSylva.getState().cycleActiveTab(e.shiftKey ? -1 : 1);
      // Both are needed: preventDefault stops the browser moving focus, and
      // stopping propagation here is what keeps the keystroke out of xterm.
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
