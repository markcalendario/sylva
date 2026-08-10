import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import type { AppContext } from "./context.js";
import { GitError, HttpError } from "./lib/errors.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerBrowseRoutes } from "./routes/browse.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { registerTerminalRoutes } from "./routes/terminals.js";
import { registerToolRoutes } from "./routes/tools.js";
import { originGuard } from "./security.js";

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.addHook("onRequest", originGuard);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message, detail: err.detail });
    } else if (err instanceof GitError) {
      reply.code(422).send({ error: "git failed", detail: err.message });
    } else if (err instanceof ZodError) {
      reply.code(400).send({
        error: "invalid request",
        detail: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    } else {
      app.log.error(err);
      const detail = err instanceof Error ? err.message : String(err);
      reply.code(500).send({ error: "internal error", detail });
    }
  });

  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.get("/api/health", async () => ({ ok: true, name: "sylva" }));

  registerRepoRoutes(app, ctx);
  registerGitRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerBrowseRoutes(app, ctx);
  registerTerminalRoutes(app, ctx);
  registerToolRoutes(app);

  // Production: serve the built frontend from this same port.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (process.env.NODE_ENV === "production" && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      reply.code(404).send({ error: "not found" });
    });
  }

  app.get("/ws", { websocket: true }, (socket) => {
    ctx.hub.add(socket);
  });

  app.addHook("onClose", async () => {
    ctx.hub.close();
    await ctx.sessions.shutdown();
    await ctx.terminals.closeAll();
    await ctx.watchers.closeAll();
  });

  return app;
}
