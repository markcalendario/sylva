import type { WebSocket } from "ws";
import type { ServerEvent } from "sylva-shared";

const HEARTBEAT_MS = 30_000;

/** Single-endpoint WebSocket hub: every client receives every event. */
export class WsHub {
  private clients = new Set<WebSocket>();
  private heartbeat: NodeJS.Timeout | null = null;

  add(socket: WebSocket): void {
    this.clients.add(socket);
    let alive = true;
    socket.on("pong", () => {
      alive = true;
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
