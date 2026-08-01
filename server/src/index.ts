import { buildApp } from "./app.js";
import { createContext } from "./context.js";

const PORT = Number(process.env.SYLVA_PORT ?? 4611);

const ctx = await createContext();
const app = await buildApp(ctx);

await app.listen({ host: "127.0.0.1", port: PORT });
