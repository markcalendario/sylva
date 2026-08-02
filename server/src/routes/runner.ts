import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

/**
 * The one-click runner. Start and stop are POSTs rather than a single toggle so
 * that a double-click can't race itself into stopping what it just started.
 */
export function registerRunnerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { runners } = ctx;

  app.get("/api/worktrees/:worktreeId/runner", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return runners.snapshot(worktreeId);
  });

  app.post("/api/worktrees/:worktreeId/runner/start", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return runners.start(worktreeId);
  });

  app.post("/api/worktrees/:worktreeId/runner/stop", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return runners.stop(worktreeId);
  });

  /** Every runner this server has started, for rebuilding state after a reload. */
  app.get("/api/runners", async () => runners.states());
}
