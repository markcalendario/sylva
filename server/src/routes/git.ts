import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const pathsSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ paths: z.array(z.string().min(1)).min(1) }),
]);
const commitSchema = z.object({ message: z.string() });
const pushSchema = z.object({ setUpstream: z.boolean().optional() }).default({});
const diffQuerySchema = z.object({
  path: z.string().min(1),
  staged: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export function registerGitRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { gitOps, hub } = ctx;

  async function broadcastStatus(worktreeId: string): Promise<void> {
    const status = await ctx.gitOps.status(worktreeId);
    hub.broadcast({ type: "git.status", status });
  }

  app.get("/api/worktrees/:worktreeId/status", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return gitOps.status(worktreeId);
  });

  app.get("/api/worktrees/:worktreeId/diff", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const query = diffQuerySchema.parse(req.query);
    return gitOps.diff(worktreeId, query.path, query.staged ?? false);
  });

  app.post("/api/worktrees/:worktreeId/stage", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pathsSchema.parse(req.body);
    await gitOps.stage(worktreeId, "all" in body ? "all" : body.paths);
    await broadcastStatus(worktreeId);
    return { ok: true };
  });

  app.post("/api/worktrees/:worktreeId/unstage", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pathsSchema.parse(req.body);
    await gitOps.unstage(worktreeId, "all" in body ? "all" : body.paths);
    await broadcastStatus(worktreeId);
    return { ok: true };
  });

  app.post("/api/worktrees/:worktreeId/commit", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = commitSchema.parse(req.body);
    const result = await gitOps.commit(worktreeId, body.message);
    await broadcastStatus(worktreeId);
    return result;
  });

  app.get("/api/repos/:repoId/branches", async (req) => {
    const { repoId } = req.params as { repoId: string };
    return gitOps.branches(repoId);
  });

  app.post("/api/worktrees/:worktreeId/push", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pushSchema.parse(req.body ?? {});
    const result = await gitOps.push(worktreeId, body.setUpstream ?? false);
    await broadcastStatus(worktreeId);
    return result;
  });

  app.post("/api/worktrees/:worktreeId/pull", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const result = await gitOps.pull(worktreeId);
    await broadcastStatus(worktreeId);
    return result;
  });
}
