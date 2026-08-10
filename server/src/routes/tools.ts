import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { killPorts, scanPorts } from "../services/ports.js";

const port = z.coerce.number().int().min(1).max(65535);

/**
 * A cap, not a limit anyone will meet. Ranges make it cheap to ask about a
 * thousand ports by accident, and every one of them is a kill the server would
 * carry out in order.
 */
const MAX_PORTS = 128;

const portList = z.array(port).max(MAX_PORTS);
const killSchema = z.object({ ports: portList.min(1) });

/**
 * Small utilities that belong to the machine rather than to any worktree.
 *
 * They live outside `/api/worktrees/...` for exactly that reason: freeing a
 * port has nothing to do with which branch you happen to be looking at.
 */
export function registerToolRoutes(app: FastifyInstance): void {
  /**
   * Who is listening. With `?ports=` it answers about those ports only —
   * including which of them are free — and with nothing, about all of them.
   */
  app.get("/api/tools/ports", async (req) => {
    const { ports } = req.query as { ports?: string };
    const asked = (ports ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return scanPorts(portList.parse(asked));
  });

  app.post("/api/tools/kill-port", async (req) => {
    const body = killSchema.parse(req.body);
    // Duplicates would kill the same process twice and report the second
    // attempt as a failure; order is kept so the results read as they were asked.
    const unique = [...new Set(body.ports)];
    return { results: await killPorts(unique) };
  });
}
