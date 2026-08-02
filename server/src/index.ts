import { buildApp } from "./app.js";
import { createContext } from "./context.js";

const PORT = Number(process.env.SYLVA_PORT ?? 4611);

const ctx = await createContext();
const app = await buildApp(ctx);

/**
 * Shut down on the way out.
 *
 * Fastify's onClose hook — which stops the agents, the watchers and every
 * terminal — only runs when something calls close(), and node calls it for
 * nobody. Without these handlers a Ctrl-C or a dev-server restart ends this
 * process and leaves its children: every restart stranded another login shell,
 * with whatever was running inside it, orphaned to init with no terminal
 * attached.
 */
let closing = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    // A second Ctrl-C means "stop waiting", not "close twice".
    if (closing) process.exit(130);
    closing = true;
    void app
      .close()
      .catch(() => {})
      .then(() => process.exit(0));
  });
}

await app.listen({ host: "127.0.0.1", port: PORT });
