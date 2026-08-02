import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const createSchema = z
  .object({
    cols: z.number().int().positive().max(500).optional(),
    rows: z.number().int().positive().max(300).optional(),
    command: z.string().max(4000).optional(),
  })
  .default({});

/**
 * Terminals over REST, keystrokes over the socket.
 *
 * Opening, listing and closing are decisions and belong here, where a failure
 * can be reported properly. What is typed goes up the WebSocket instead: a
 * round trip through fetch per keypress is latency you can feel.
 */
export function registerTerminalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { terminals } = ctx;

  app.get("/api/worktrees/:worktreeId/terminals", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return terminals.list(worktreeId);
  });

  app.post("/api/worktrees/:worktreeId/terminals", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = createSchema.parse(req.body ?? {});
    return terminals.create(worktreeId, body);
  });

  /** Retained output, for a client that has just attached to a live terminal. */
  app.get("/api/terminals/:terminalId/buffer", async (req) => {
    const { terminalId } = req.params as { terminalId: string };
    return terminals.buffer(terminalId);
  });

  app.delete("/api/terminals/:terminalId", async (req) => {
    const { terminalId } = req.params as { terminalId: string };
    terminals.close(terminalId);
    return { ok: true };
  });

  /** Every terminal this server holds, for rebuilding the tabs after a reload. */
  app.get("/api/terminals", async () => terminals.all());
}
