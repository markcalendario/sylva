import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, sep, basename } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  circleMembers,
  GROVE_ID,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_MIN,
  type Attachment,
} from "sylva-shared";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";
import { openExternal } from "../services/open.js";
import { searchTranscripts } from "../services/transcriptSearch.js";

const promptSchema = z.object({ text: z.string().min(1) });
const transcriptSearchSchema = z.object({
  q: z.string().min(1).max(200),
  mode: z.enum(["file", "text"]).default("file"),
});
const openSchema = z.object({
  kind: z.enum(["editor", "reveal", "terminal", "system"]),
  /**
   * A file inside the worktree, relative to it. Absent means the worktree
   * directory itself, which is what every Open button did before one of them
   * learned to point at a single file.
   */
  path: z.string().min(1).max(1024).optional(),
});
const answerSchema = z.object({
  requestId: z.string().min(1),
  answer: z.enum(["allow", "allow-always", "deny"]),
});
const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

const openTargetSchema = z.enum(["vscode", "cursor", "zed", "custom", "none"]);
const terminalTargetSchema = z.enum([
  "system",
  "iterm",
  "warp",
  "ghostty",
  "kitty",
  "custom",
  "none",
]);

const preferencesSchema = z.object({
  editorTarget: openTargetSchema,
  editorCommand: z.string().max(500),
  terminalShell: z.string().max(500),
  terminalApp: terminalTargetSchema,
  terminalAppCommand: z.string().max(500),
  terminalScrollback: z.number().int().min(TERMINAL_SCROLLBACK_MIN).max(TERMINAL_SCROLLBACK_MAX),
  copyEnvFiles: z.boolean(),
  pullBeforeWorktree: z.boolean(),
});

const permissionModeSchema = z.enum(["supervised", "acceptEdits", "full"]);

const globalSettingsSchema = z.object({
  permissionMode: permissionModeSchema,
  model: z.string().min(1).nullable(),
  effort: effortSchema.nullable(),
});

/** Absent keys inherit global; present keys (including null) override it. */
const overridesSchema = z.object({
  permissionMode: permissionModeSchema.optional(),
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

  /**
   * Session routes address a *target*, which is usually a worktree and
   * occasionally the grove. The grove has no worktree to resolve, so it clears
   * the guard on its own name rather than by pretending to be one.
   */
  const requireTarget = async (targetId: string): Promise<void> => {
    if (targetId === GROVE_ID) return;
    const members = circleMembers(targetId);
    if (members) {
      // Every member has to be real, or the circle isn't the one you asked for.
      for (const id of members) await workspace.resolveWorktree(id);
      return;
    }
    await workspace.resolveWorktree(targetId);
  };

  app.get("/api/agent/availability", async () => sessions.getAvailability());

  /**
   * What is left of the Claude plan. Cached and shared — the windows belong to
   * the login, so asking once serves every pane, and the reading is slow enough
   * that asking per pane would be felt.
   */
  app.get("/api/usage", async () => ctx.usage.current());

  /**
   * Which dryads touched a file, or said a thing. Reads across every session's
   * transcript — the whole point is that it answers about worktrees you are no
   * longer looking at.
   */
  app.get("/api/transcripts/search", async (req) => {
    const { q, mode } = transcriptSearchSchema.parse(req.query);
    return searchTranscripts(ctx.store, q, mode);
  });

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

  /** Forget the conversation so the next prompt starts a new one. */
  app.delete("/api/worktrees/:worktreeId/session", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return sessions.clearSession(worktreeId);
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

  /**
   * Hand something to the configured editor, terminal or file browser — the
   * worktree directory by default, or one file inside it when `path` says so.
   *
   * The path is checked rather than trusted. It arrives from a browser, and
   * the whole point of this endpoint is that it launches a program with it: a
   * `../../..` waved through here would be Sylva opening any file on the
   * machine on request. Normalizing and refusing anything that climbs out
   * keeps it to files the caller could already read through the Files tab.
   */
  app.post("/api/worktrees/:worktreeId/open", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { kind, path } = openSchema.parse(req.body ?? {});
    const { worktree } = await workspace.resolveWorktree(worktreeId);

    let target = worktree.path;
    if (path !== undefined) {
      const rel = normalize(path);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
        throw badRequest(`Invalid file path: ${path}`);
      }
      target = join(worktree.path, rel);
      // A file the agent deleted a second ago is the common way to get here
      // with a path that no longer resolves, and "explorer.exe failed" is a
      // worse answer to that than saying which file is gone.
      if (!existsSync(target)) {
        throw badRequest(`${rel} isn't there any more`);
      }
    }

    return openExternal(target, ctx.store.preferences, kind);
  });

  /**
   * The slash commands this dryad answers to — built-ins, skills, and whatever
   * the repository adds. Cached server-side, so the prompt box can ask for it
   * the moment someone types `/`.
   */
  app.get("/api/worktrees/:worktreeId/commands", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    await requireTarget(worktreeId);
    return ctx.commands.list(worktreeId);
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
    await requireTarget(worktreeId);
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
    await requireTarget(worktreeId);

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
