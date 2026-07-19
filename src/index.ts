import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { pingRedis } from "./redis.js";
import { passagesRoutes } from "./routes/passages.js";
import { soloResultsRoutes } from "./routes/solo-results.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
  ],
});

app.get("/health", async () => {
  const redis = await pingRedis();
  return {
    ok: true,
    service: "clackrace-server",
    redis,
  };
});

await app.register(passagesRoutes);
await app.register(soloResultsRoutes);

try {
  await app.listen({ port, host });
  app.log.info(`ClackRace API on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
