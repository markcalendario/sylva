import type { WebSocket } from "ws";
import type { ClientEvent, ServerEvent } from "sylva-shared";

const HEARTBEAT_MS = 30_000;
/** A single keystroke is bytes; a paste is not. Anything past this is a mistake. */
const MAX_FRAME = 1_000_000;

/** Single-endpoint WebSocket hub: every client receives every event. */
export class WsHub {
  private clients = new Set<WebSocket>();
  private heartbeat: NodeJS.Timeout | null = null;

  /**
   * What to do with a frame from a client. Set once, at wiring time — the hub
   * knows how to carry an event, not what any of them mean.
   */
  onClientEvent: ((event: ClientEvent) => void) | null = null;

  add(socket: WebSocket): void {
    this.clients.add(socket);
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("message", (raw: Buffer | string) => {
      const text = typeof raw === "string" ? raw : raw.toString();
      if (text.length > MAX_FRAME) return;
      let event: ClientEvent;
      try {
        event = JSON.parse(text) as ClientEvent;
      } catch {
        return;
      }
      if (!event || typeof event !== "object" || typeof event.type !== "string") return;
      this.onClientEvent?.(event);
    });
    const ping = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on("close", () => {
      clearInterval(ping);
      this.clients.delete(socket);
    });
    socket.on("error", () => {
      clearInterval(ping);
      this.clients.delete(socket);
      socket.terminate();
    });
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients) client.terminate();
    this.clients.clear();
  }
}
