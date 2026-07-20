import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ensureSchema } from "./db/ensure-schema.js";
import { seedAdminUser } from "./db/seed-admin.js";
import { env } from "./env.js";
import { attachRaceGateway } from "./realtime/gateway.js";
import { pingRedis } from "./redis.js";
import { adminRoutes } from "./routes/admin.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { challengesRoutes } from "./routes/challenges.js";
import { claimRoutes } from "./routes/claim.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { matchmakingRoutes } from "./routes/matchmaking.js";
import { meRoutes } from "./routes/me.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { passagesRoutes } from "./routes/passages.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { socketTokenRoutes } from "./routes/socket-token.js";
import { soloResultsRoutes } from "./routes/solo-results.js";
import { statsRoutes } from "./routes/stats.js";

const app = Fastify({
  logger: true,
});

try {
  await ensureSchema();
  app.log.info("Schema ensure OK");
  const adminSeed = await seedAdminUser();
  app.log.info(
    adminSeed === "ok"
      ? "Admin user seeded from env"
      : "Admin seed skipped (ADMIN_USERNAME / ADMIN_PASSWORD unset)",
  );
} catch (err) {
  app.log.error(err, "Schema ensure / admin seed failed — migrate manually if needed");
}

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
await app.register(socketTokenRoutes);
await app.register(meRoutes);
await app.register(claimRoutes);
await app.register(leaderboardRoutes);
await app.register(statsRoutes);
await app.register(analyticsRoutes);
await app.register(adminRoutes);
await app.register(challengesRoutes);
await app.register(matchmakingRoutes);
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
