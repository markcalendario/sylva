import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const registerSchema = z.object({ path: z.string().min(1) });
const createWorktreeSchema = z.object({
  branch: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});
const removeWorktreeSchema = z.object({ force: z.boolean().optional() }).default({});
const focusSchema = z.object({ worktreeId: z.string().nullable() });

export function registerRepoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { workspace } = ctx;

  app.get("/api/repos", async () => workspace.listRepos());

  app.post("/api/repos", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const repo = await workspace.registerRepo(body.path);
    reply.code(201);
    return repo;
  });

  app.delete("/api/repos/:repoId", async (req) => {
    const { repoId } = req.params as { repoId: string };
    await workspace.removeRepo(repoId);
    return { ok: true };
  });

  app.get("/api/repos/:repoId/worktrees", async (req) => {
    const { repoId } = req.params as { repoId: string };
    return workspace.listWorktrees(repoId);
  });

  app.post("/api/repos/:repoId/worktrees", async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = createWorktreeSchema.parse(req.body);
    const worktree = await workspace.createWorktree(repoId, body);
    reply.code(201);
    return worktree;
  });

  app.delete("/api/worktrees/:worktreeId", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = removeWorktreeSchema.parse(req.body ?? {});
    await workspace.removeWorktree(worktreeId, body.force ?? false);
    return { ok: true };
  });

  app.get("/api/focus", async () => ({ worktreeId: workspace.focused }));

  app.post("/api/focus", async (req) => {
    const body = focusSchema.parse(req.body);
    if (body.worktreeId) await workspace.resolveWorktree(body.worktreeId);
    workspace.setFocus(body.worktreeId);
    return { worktreeId: workspace.focused };
  });
}
