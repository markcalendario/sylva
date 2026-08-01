import type { ServerEvent } from "sylva-shared";
import { useSylva } from "../state/store";
import { notifyAgentEvent } from "./notify";

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
      useSylva.getState().applyServerEvent(event);
      notifyAgentEvent(event);
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
