import type { ClientEvent, ServerEvent } from "sylva-shared";
import { useSylva } from "../state/store";
import { playCue } from "./audio";
import { notifyAgentEvent } from "./notify";
import { disposeTerminal, receiveTerminalOutput } from "./terminals";

/**
 * Sound only ever comes from live events. Transcript replay goes through the
 * REST layer, so switching worktrees never re-plays an old conversation's cues.
 */
function soundForEvent(event: ServerEvent): void {
  if (event.type === "permission.request") {
    playCue("attention");
    return;
  }
  if (event.type !== "agent.event") return;
  if (event.event.kind === "result") {
    if (event.event.outcome === "success") playCue("done");
    else if (event.event.outcome === "error") playCue("error");
  } else if (event.event.kind === "error") {
    playCue("error");
  }
}

const MAX_BACKOFF_MS = 15_000;

let socket: WebSocket | null = null;
let backoff = 500;
let started = false;

/** Connect the single app WebSocket; reconnects with backoff forever. */
export function startWs(onResync: () => void): void {
  if (started) return;
  started = true;
  connect(onResync);
}

/**
 * Send something up the socket. Keystrokes only — see ClientEvent. Returns
 * false when the socket isn't open, which is the caller's cue that what it
 * typed went nowhere.
 */
export function sendWs(event: ClientEvent): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(event));
  return true;
}

function connect(onResync: () => void): void {
  const store = useSylva.getState();
  store.setConnection("connecting");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.onopen = () => {
    backoff = 500;
    useSylva.getState().setConnection("connected");
    onResync();
  };

  socket.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data as string) as ServerEvent;
      // Terminal bytes go straight to the emulator drawing them. Everything
      // else is application state and goes to the store.
      if (event.type === "terminal.output") {
        receiveTerminalOutput(event.terminalId, event.seq, event.data);
        return;
      }
      // A closed terminal is never coming back; the emulator holding its
      // scrollback should go with it.
      if (event.type === "terminal.closed") disposeTerminal(event.terminalId);
      useSylva.getState().applyServerEvent(event);
      notifyAgentEvent(event);
      soundForEvent(event);
    } catch {
      // Ignore malformed frames.
    }
  };

  socket.onclose = () => {
    useSylva.getState().setConnection("disconnected");
    setTimeout(() => connect(onResync), backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  socket.onerror = () => {
    socket?.close();
  };
}
