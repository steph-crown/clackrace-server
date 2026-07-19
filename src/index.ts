import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env.js";
import { attachRaceGateway } from "./realtime/gateway.js";
import { pingRedis } from "./redis.js";
import { authRoutes } from "./routes/auth.js";
import { challengesRoutes } from "./routes/challenges.js";
import { claimRoutes } from "./routes/claim.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { meRoutes } from "./routes/me.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { passagesRoutes } from "./routes/passages.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { soloResultsRoutes } from "./routes/solo-results.js";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: [...env.corsOrigins],
  credentials: true,
});

app.get("/health", async () => {
  const redis = await pingRedis();
  return {
    ok: true,
    service: "clackrace-server",
    redis,
  };
});

await app.register(authRoutes);
await app.register(meRoutes);
await app.register(claimRoutes);
await app.register(leaderboardRoutes);
await app.register(challengesRoutes);
await app.register(notificationsRoutes);
await app.register(passagesRoutes);
await app.register(soloResultsRoutes);
await app.register(sessionsRoutes);

await app.ready();
attachRaceGateway(app);

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`ClackRace API on http://${env.host}:${env.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
