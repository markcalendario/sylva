import type { FastifyRequest, FastifyReply } from "fastify";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return LOCAL_HOSTS.has(url.hostname) || LOCAL_HOSTS.has(`[${url.hostname}]`);
  } catch {
    return false;
  }
}

/**
 * Defends the localhost server against requests from foreign websites
 * (CSRF / DNS rebinding). Applies to REST and WebSocket upgrades alike:
 *  - a present Origin header must be a localhost origin
 *  - the Host header must be localhost
 */
export function originGuard(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  const host = req.headers.host ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0] ?? "";
  if (!LOCAL_HOSTS.has(hostname)) {
    reply.code(403).send({ error: "Forbidden: non-local Host header" });
    return;
  }
  const origin = req.headers.origin;
  if (origin && !isLocalOrigin(origin)) {
    reply.code(403).send({ error: "Forbidden: cross-origin request rejected" });
    return;
  }
  done();
}
