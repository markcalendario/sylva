import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const registerSchema = z.object({ path: z.string().min(1) });
const createRepoSchema = z.object({
  parentPath: z.string().min(1),
  name: z.string().min(1).max(100),
});
const createWorktreeSchema = z.object({
  branch: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});
const removeWorktreeSchema = z.object({ force: z.boolean().optional() }).default({});
const focusSchema = z.object({ worktreeId: z.string().nullable() });
const openWorktreesSchema = z
  .object({ worktreeIds: z.array(z.string().min(1)).max(8).default([]) })
  .default({ worktreeIds: [] });

export function registerRepoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { workspace } = ctx;

  app.get("/api/repos", async () => workspace.listRepos());

  app.post("/api/repos", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const repo = await workspace.registerRepo(body.path);
    reply.code(201);
    return repo;
  });

  /** Start a new repository on disk and register it, ready for worktrees. */
  app.post("/api/repos/create", async (req, reply) => {
    const body = createRepoSchema.parse(req.body);
    const repo = await workspace.createRepo(body.parentPath, body.name);
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
    const created = await workspace.createWorktree(repoId, body);
    reply.code(201);
    return created;
  });

  app.delete("/api/worktrees/:worktreeId", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = removeWorktreeSchema.parse(req.body ?? {});
    await workspace.removeWorktree(worktreeId, body.force ?? false);
    return { ok: true };
  });

  /**
   * What the panes hold. The client owns pane layout — it is a view concern —
   * so it tells the server which worktrees have to stay live. Capped because a
   * request is not a reason to open an unbounded number of file watchers.
   */
  app.post("/api/open-worktrees", async (req) => {
    const body = openWorktreesSchema.parse(req.body ?? {});
    await workspace.setOpenWorktrees(body.worktreeIds);
    return { worktreeIds: workspace.openWorktrees };
  });

  app.get("/api/focus", async () => ({ worktreeId: workspace.focused }));

  app.post("/api/focus", async (req) => {
    const body = focusSchema.parse(req.body);
    if (body.worktreeId) await workspace.resolveWorktree(body.worktreeId);
    workspace.setFocus(body.worktreeId);
    return { worktreeId: workspace.focused };
  });
}
