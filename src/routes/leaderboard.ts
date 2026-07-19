import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDailyChampion, getLeaderboard } from "../lib/retention.js";

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard", async (req, reply) => {
    const parsed = z
      .object({
        scope: z.enum(["all_time", "daily", "weekly"]).default("all_time"),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid scope" });
    }
    const rows = await getLeaderboard(parsed.data.scope);
    return {
      scope: parsed.data.scope,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        username: r.username ?? r.name,
        carColor: r.carColor,
        bestWpm: Math.round(r.bestWpm * 10) / 10,
        achievedAt: r.achievedAt.toISOString(),
      })),
    };
  });

  app.get("/leaderboard/daily-champion", async () => {
    const champ = await getDailyChampion();
    if (!champ) return { champion: null };
    return {
      champion: {
        day: champ.day,
        userId: champ.userId,
        username: champ.username ?? champ.name,
        carColor: champ.carColor,
        bestWpm: Math.round(champ.bestWpm * 10) / 10,
      },
    };
  });
}
