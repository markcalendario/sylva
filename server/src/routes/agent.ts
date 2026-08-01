import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Attachment } from "sylva-shared";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";
import { openExternal } from "../services/open.js";

const promptSchema = z.object({ text: z.string().min(1) });
const openSchema = z.object({ kind: z.enum(["editor", "terminal"]) });
const answerSchema = z.object({
  requestId: z.string().min(1),
  answer: z.enum(["allow", "allow-always", "deny"]),
});
const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

const openTargetSchema = z.enum([
  "vscode",
  "cursor",
  "zed",
  "terminal",
  "iterm",
  "warp",
  "custom",
  "none",
]);

const preferencesSchema = z.object({
  editorTarget: openTargetSchema,
  editorCommand: z.string().max(500),
  terminalTarget: openTargetSchema,
  terminalCommand: z.string().max(500),
  savedPrompts: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(80),
        text: z.string().min(1).max(4000),
      }),
    )
    .max(50),
});

const globalSettingsSchema = z.object({
  bypassPermissions: z.boolean(),
  model: z.string().min(1).nullable(),
  effort: effortSchema.nullable(),
});

/** Absent keys inherit global; present keys (including null) override it. */
const overridesSchema = z.object({
  bypassPermissions: z.boolean().optional(),
  model: z.string().min(1).nullable().optional(),
  effort: effortSchema.nullable().optional(),
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

  app.get("/api/permissions", async () => sessions.allPendingPermissions());

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

  app.get("/api/settings", async () => ctx.store.globalSettings);

  app.get("/api/preferences", async () => ctx.store.preferences);

  app.put("/api/preferences", async (req) => {
    const body = preferencesSchema.parse(req.body);
    await ctx.store.setPreferences(body);
    return ctx.store.preferences;
  });

  /** Hand the worktree directory to the configured editor or terminal. */
  app.post("/api/worktrees/:worktreeId/open", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { kind } = openSchema.parse(req.body ?? {});
    const { worktree } = await workspace.resolveWorktree(worktreeId);
    return openExternal(worktree.path, ctx.store.preferences, kind);
  });

  app.put("/api/settings", async (req) => {
    const body = globalSettingsSchema.parse(req.body);
    return sessions.setGlobalSettings(body);
  });

  app.get("/api/worktrees/:worktreeId/settings", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return sessions.getSettings(worktreeId);
  });

  app.put("/api/worktrees/:worktreeId/settings", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    await workspace.resolveWorktree(worktreeId);
    const body = overridesSchema.parse(req.body);
    return sessions.setOverrides(worktreeId, body);
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
