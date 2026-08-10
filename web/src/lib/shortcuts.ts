import { useEffect } from "react";
import { GROVE_ID } from "sylva-shared";
import { attentionQueue, fileKey, TABS, useSylva } from "../state/store";

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

/** The platform's own name for the command modifier, for tooltips and the Help. */
export function cmdKey(): string {
  return isMac() ? "⌘" : "Ctrl";
}

/** Is this the command (or control) modifier, and only it? */
function commandHeld(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/**
 * Is anything on screen that should swallow keystrokes wholesale?
 *
 * A dialog is its own little world: acting on the workspace behind one would
 * change something you can't see, and undo a decision you were in the middle
 * of making.
 */
function modalOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/**
 * Every window-level shortcut, in one listener.
 *
 * They listen in the capture phase for the reason given at the top of this
 * file: the two places you most want to leave with the keyboard are the prompt
 * box and a terminal, and both would otherwise eat the keystroke.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const store = useSylva.getState();

      // ⌘K opens the palette; while it is open it is a dialog like any other
      // and everything below stands aside for it.
      if (commandHeld(e) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        store.setPalette(!store.paletteOpen);
        return;
      }
      if (store.paletteOpen) return;

      // Option+Tab walks the pane's tabs: Agent → Files → Git → Terminal →
      // Agent. Holding shift walks back, the way shift-tab always has.
      if (cyclesTabs(e)) {
        if (modalOpen()) return;
        store.cycleActiveTab(e.shiftKey ? -1 : 1);
        // Both are needed: preventDefault stops the browser moving focus, and
        // stopping propagation is what keeps the keystroke out of xterm.
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // ⌘⇧F searches every dryad's memory. Above the modal guard on purpose:
      // it is the one thing you reach for *while* reading a transcript, and it
      // opens with whatever file you are looking at when there is one.
      if (commandHeld(e) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        const pane = store.panes.find((p) => p.id === store.activePaneId) ?? store.panes[0];
        const file = pane?.files.find((f) => fileKey(f) === pane.activeFile);
        store.openTranscriptSearch(pane?.tab === "files" && file ? file.path : "");
        return;
      }

      if (modalOpen()) return;

      // ⌘⇧A goes to whatever is waiting on you — the one shortcut that pays for
      // itself the moment more than about three dryads are running.
      if (commandHeld(e) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        const next = attentionQueue(store)[0];
        if (!next) return;
        if (next.worktreeId === GROVE_ID) store.setView("grove");
        else store.openWorktree(next.worktreeId);
        return;
      }

      // ⌘1–4 jump straight to a tab. Cycling is fine for stepping through;
      // going *there* is what you actually want most of the time.
      if (commandHeld(e) && !e.shiftKey && !e.altKey && /^[1-4]$/.test(e.key)) {
        const pane = store.panes.find((p) => p.id === store.activePaneId) ?? store.panes[0];
        const tab = TABS[Number(e.key) - 1];
        if (!pane?.worktreeId || !tab) return;
        e.preventDefault();
        e.stopPropagation();
        if (store.view !== "workspace") store.setView("workspace");
        store.setPaneTab(pane.id, tab);
        return;
      }

      // ⌘⌥← / → step through the Files tab's open files, which is where the
      // browser's own tab shortcuts would go if the browser weren't using them.
      if (commandHeld(e) && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const pane = store.panes.find((p) => p.id === store.activePaneId) ?? store.panes[0];
        if (!pane || pane.files.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        store.setPaneTab(pane.id, "files");
        store.cycleFile(pane.id, e.key === "ArrowRight" ? 1 : -1);
        return;
      }

      // ⌘W closes the file you're reading — but only in the Files tab, and only
      // when there is a file. Anywhere else it stays the browser's, because
      // stealing "close the tab" everywhere would be worse than not having it.
      if (commandHeld(e) && !e.shiftKey && e.key.toLowerCase() === "w") {
        const pane = store.panes.find((p) => p.id === store.activePaneId) ?? store.panes[0];
        if (!pane || pane.tab !== "files" || !pane.activeFile) return;
        e.preventDefault();
        e.stopPropagation();
        store.closeFile(pane.id, pane.activeFile);
        return;
      }

      // ⌘B for the sidebar, as in every editor that has one.
      if (commandHeld(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        store.toggleSidebar();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
