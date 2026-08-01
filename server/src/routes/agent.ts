import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Attachment } from "sylva-shared";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";

const promptSchema = z.object({ text: z.string().min(1) });
const answerSchema = z.object({
  requestId: z.string().min(1),
  answer: z.enum(["allow", "allow-always", "deny"]),
});
const prefsSchema = z.object({
  bypassPermissions: z.boolean(),
  model: z.string().min(1).nullable(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable(),
});

/** Keep uploaded names to a safe leaf; never let one escape the directory. */
function safeFileName(name: string): string {
  const leaf = basename(name).replace(/[/\\]/g, "_").trim();
  return leaf && leaf !== "." && leaf !== ".." ? leaf.slice(0, 120) : "attachment";
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

  app.get("/api/worktrees/:worktreeId/prefs", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return sessions.getPrefs(worktreeId);
  });

  app.put("/api/worktrees/:worktreeId/prefs", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    await workspace.resolveWorktree(worktreeId);
    const body = prefsSchema.parse(req.body);
    return sessions.setPrefs(worktreeId, body);
  });

  /**
   * Files dropped on the prompt are written outside the repository, and the
   * agent is handed the path — it reads them with its own tools, so binaries
   * and large files cost nothing in the prompt.
   */
  app.post("/api/worktrees/:worktreeId/attachments", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    await workspace.resolveWorktree(worktreeId);

    const file = await req.file();
    if (!file) throw badRequest("No file uploaded");

    const dir = ctx.store.attachmentsDir(worktreeId);
    await mkdir(dir, { recursive: true });

    const buffer = await file.toBuffer();
    const name = safeFileName(file.filename);
    const target = join(dir, `${Date.now()}-${name}`);
    await writeFile(target, buffer);

    const attachment: Attachment = { name, path: target, size: buffer.byteLength };
    return attachment;
  });
}
