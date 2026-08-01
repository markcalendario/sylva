import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import type { AppContext } from "./context.js";
import { GitError, HttpError } from "./lib/errors.js";
import { registerRepoRoutes } from "./routes/repos.js";
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

  app.get("/api/health", async () => ({ ok: true, name: "sylva" }));

  registerRepoRoutes(app, ctx);

  app.get("/ws", { websocket: true }, (socket) => {
    ctx.hub.add(socket);
  });

  app.addHook("onClose", async () => {
    ctx.hub.close();
  });

  return app;
}
