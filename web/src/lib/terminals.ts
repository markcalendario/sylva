import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { clampScrollback, PREFERENCE_DEFAULTS } from "sylva-shared";
import { api } from "./api";
import { sendWs } from "./ws";

/**
 * The emulators, and the bytes going into them.
 *
 * Terminals live outside React because what is on screen in one is not state
 * any component owns: it is a scrollback the server streams and xterm holds.
 * Switching tabs, splitting the pane or re-rendering the tab strip must not
 * disturb a single line of it, so each terminal keeps its own detached element
 * here and a pane merely borrows it.
 */
interface View {
  term: Terminal;
  fit: FitAddon;
  /** The element xterm draws into. Moved between panes; never rebuilt. */
  host: HTMLDivElement;
  /** Highest chunk written. Anything at or below it is already on screen. */
  seq: number;
  /** Chunks that arrived while the replayed buffer was still in flight. */
  queue: { seq: number; data: string }[];
  ready: boolean;
}

const views = new Map<string, View>();

/**
 * How many lines each emulator keeps above the top of the screen.
 *
 * A module-level number rather than a prop, for the same reason the emulators
 * themselves live here: a terminal outlives every component that draws it, and
 * a setting it reads has to outlive them too. The saved preference replaces
 * this as soon as it has been fetched.
 */
let scrollback = PREFERENCE_DEFAULTS.terminalScrollback;

/**
 * Set the scrollback for every terminal, now and hereafter.
 *
 * xterm trims immediately when the limit drops, which is the point: the setting
 * exists because the lines already held are costing something, and one that
 * only applied to terminals opened later would leave that cost exactly where it
 * was until the next reload.
 */
export function setTerminalScrollback(lines: number): void {
  const next = clampScrollback(lines);
  if (next === scrollback) return;
  scrollback = next;
  for (const view of views.values()) view.term.options.scrollback = next;
}

/** One CSS custom property, resolved to whatever the stylesheet says it is. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The forest's palette, handed to xterm. The same sixteen colours the old log
 * renderer used, so a dev server's output looks the way it always did.
 */
function theme() {
  return {
    background: token("--pine-0", "#0c1110"),
    foreground: token("--moon", "#e9f0e4"),
    cursor: token("--firefly", "#ffb454"),
    cursorAccent: token("--pine-0", "#0c1110"),
    selectionBackground: token("--pine-3", "#243129"),
    black: token("--ansi-black", "#2a352e"),
    red: token("--ansi-red", "#ff6b5b"),
    green: token("--ansi-green", "#7fd068"),
    yellow: token("--ansi-yellow", "#ffb454"),
    blue: token("--ansi-blue", "#7fb7c9"),
    magenta: token("--ansi-magenta", "#c69ae0"),
    cyan: token("--ansi-cyan", "#6fd3c4"),
    white: token("--ansi-white", "#cdd8c8"),
    brightBlack: token("--ansi-bright-black", "#5d6f63"),
    brightRed: token("--ansi-bright-red", "#ff9182"),
    brightGreen: token("--ansi-bright-green", "#a6e694"),
    brightYellow: token("--ansi-bright-yellow", "#ffcd85"),
    brightBlue: token("--ansi-bright-blue", "#a6d3e0"),
    brightMagenta: token("--ansi-bright-magenta", "#dcbaf0"),
    brightCyan: token("--ansi-bright-cyan", "#99e8dc"),
    brightWhite: token("--ansi-bright-white", "#f2f7ef"),
  };
}

/** Terminal type is fixed-width, so it follows the app's text size directly. */
function fontSize(): number {
  const scale = Number(token("--text-scale", "1")) || 1;
  return Math.max(9, Math.round(12 * scale));
}

/**
 * Output from the socket. Dropped when nothing is drawing this terminal —
 * the server keeps its own scrollback, and attaching later replays it.
 */
export function receiveTerminalOutput(terminalId: string, seq: number, data: string): void {
  const view = views.get(terminalId);
  if (!view) return;
  if (!view.ready) {
    view.queue.push({ seq, data });
    return;
  }
  if (seq <= view.seq) return;
  view.seq = seq;
  view.term.write(data);
}

function create(terminalId: string): View {
  const host = document.createElement("div");
  host.className = "term-host";

  const term = new Terminal({
    fontFamily: token("--font-mono", "ui-monospace, monospace"),
    fontSize: fontSize(),
    lineHeight: 1.2,
    cursorBlink: true,
    // The server keeps only the last stretch of output; the emulator is where a
    // long build log is actually scrolled back through — and where its cost is
    // paid, one object per cell, which is why the depth is yours to choose.
    scrollback,
    allowProposedApi: true,
    theme: theme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(host);

  const view: View = { term, fit, host, seq: 0, queue: [], ready: false };
  views.set(terminalId, view);

  term.onData((data) => {
    // Nowhere to send it means nowhere to send it: better a keystroke that
    // visibly did nothing than one echoed locally and never run.
    sendWs({ type: "terminal.input", terminalId, data });
  });
  term.onResize(({ cols, rows }) => {
    sendWs({ type: "terminal.resize", terminalId, cols, rows });
  });

  // Catch up on everything said before we were watching, then let the live
  // chunks through — dropping the ones the replay already contained.
  void api
    .terminalBuffer(terminalId)
    .then(({ data, seq }) => {
      if (data) term.write(data);
      view.seq = seq;
      const queued = view.queue.splice(0);
      view.ready = true;
      for (const chunk of queued) receiveTerminalOutput(terminalId, chunk.seq, chunk.data);
    })
    .catch(() => {
      // Gone between opening the tab and asking for its buffer. Live output
      // still works if it comes back; there is nothing to replay.
      view.ready = true;
    });

  return view;
}

/**
 * Put a terminal into a pane. Returns a teardown that only detaches it — the
 * emulator and its scrollback stay, because leaving the tab is not closing the
 * terminal.
 */
export function attachTerminal(terminalId: string, parent: HTMLElement): () => void {
  const view = views.get(terminalId) ?? create(terminalId);
  parent.appendChild(view.host);
  fitTerminal(terminalId);
  return () => {
    view.host.remove();
  };
}

/** Match the emulator to the space it has, and tell the pty about it. */
export function fitTerminal(terminalId: string): void {
  const view = views.get(terminalId);
  if (!view || !view.host.isConnected) return;
  const { clientWidth, clientHeight } = view.host;
  if (clientWidth === 0 || clientHeight === 0) return;
  try {
    view.fit.fit();
  } catch {
    // Measured mid-layout, before the pane has a size worth fitting to.
  }
}

export function focusTerminal(terminalId: string): void {
  views.get(terminalId)?.term.focus();
}

/**
 * The terminal is gone for good — throw the emulator away with it.
 *
 * `dispose` is what actually frees the scrollback: the buffer, its cells and
 * the renderer's canvases all hang off the Terminal, and dropping the map entry
 * alone would leave every line of a build log alive for as long as the tab is.
 */
export function disposeTerminal(terminalId: string): void {
  const view = views.get(terminalId);
  if (!view) return;
  views.delete(terminalId);
  view.queue.length = 0;
  view.host.remove();
  view.term.dispose();
}

/**
 * Throw away every emulator the server no longer has a terminal for.
 *
 * Closing a terminal broadcasts, and the broadcast disposes it — but a close
 * that happened while this tab was disconnected has no broadcast to hear, and
 * its scrollback would otherwise sit in memory until the page was reloaded.
 * Called with the server's own list, on reconnect, which is the moment we stop
 * believing anything we remember.
 */
export function disposeMissingTerminals(liveIds: string[]): void {
  const live = new Set(liveIds);
  for (const id of [...views.keys()]) {
    if (!live.has(id)) disposeTerminal(id);
  }
}

/** Re-theme every open terminal, after the palette or the text size changes. */
export function restyleTerminals(): void {
  for (const view of views.values()) {
    view.term.options.theme = theme();
    view.term.options.fontSize = fontSize();
  }
  for (const id of views.keys()) fitTerminal(id);
}
