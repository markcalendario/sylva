import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { QuickStartResult } from "sylva-shared";
import type { AppContext } from "../context.js";

const promptSchema = z.object({ text: z.string().min(1) });
const answerSchema = z.object({
  requestId: z.string().min(1),
  answer: z.enum(["allow", "allow-always", "deny"]),
});
const quickStartSchema = z.object({
  repoId: z.string().min(1),
  taskName: z.string().min(1),
  prompt: z.string().min(1),
  baseRef: z.string().min(1).optional(),
});

/** Turn a task name into a git-friendly branch name. */
function branchNameFor(taskName: string): string {
  const slug = taskName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "task";
}

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { sessions, workspace } = ctx;

  app.get("/api/agent/availability", async () => sessions.getAvailability());

  app.get("/api/sessions", async () => sessions.listSessions());

  app.get("/api/worktrees/:worktreeId/session", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return {
      session: sessions.getByWorktree(worktreeId),
      pendingPermissions: sessions.pendingPermissions(worktreeId),
      availability: sessions.getAvailability(),
    };
  });

  app.get("/api/worktrees/:worktreeId/session/transcript", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return sessions.transcript(worktreeId);
  });

  app.post("/api/worktrees/:worktreeId/session/prompt", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = promptSchema.parse(req.body);
    return sessions.prompt(worktreeId, body.text);
  });

  app.post("/api/worktrees/:worktreeId/session/interrupt", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return sessions.interrupt(worktreeId);
  });

  app.delete("/api/worktrees/:worktreeId/session/queue/:promptId", async (req) => {
    const { worktreeId, promptId } = req.params as { worktreeId: string; promptId: string };
    return sessions.removeQueuedPrompt(worktreeId, promptId);
  });

  app.post("/api/permissions/answer", async (req) => {
    const body = answerSchema.parse(req.body);
    sessions.answerPermission(body.requestId, body.answer);
    return { ok: true };
  });

  app.post("/api/quickstart", async (req, reply) => {
    const body = quickStartSchema.parse(req.body);
    const result: QuickStartResult = { worktree: null, session: null, errors: [] };

    try {
      result.worktree = await workspace.createWorktree(body.repoId, {
        branch: branchNameFor(body.taskName),
        baseRef: body.baseRef ?? "HEAD",
      });
    } catch (err) {
      result.errors.push(`Worktree creation failed: ${err instanceof Error ? err.message : String(err)}`);
      reply.code(422);
      return result;
    }

    workspace.setFocus(result.worktree.id);

    try {
      result.session = await sessions.prompt(result.worktree.id, body.prompt);
    } catch (err) {
      result.errors.push(`Agent session failed to start: ${err instanceof Error ? err.message : String(err)}`);
      reply.code(207);
    }
    return result;
  });
}
