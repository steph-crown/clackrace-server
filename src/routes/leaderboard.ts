import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEloLadder } from "../lib/elo.js";
import { getDailyChampion, getLeaderboard } from "../lib/retention.js";

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get("/leaderboard", async (req, reply) => {
    const parsed = z
      .object({
        scope: z
          .enum(["all_time", "daily", "weekly", "rating"])
          .default("all_time"),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid scope" });
    }

    if (parsed.data.scope === "rating") {
      const rows = await getEloLadder(50);
      return {
        scope: "rating" as const,
        entries: rows.map((r, i) => ({
          rank: i + 1,
          userId: r.userId,
          username: r.username ?? r.name,
          carColor: r.carColor,
          rating: Math.round(r.rating),
          racesCounted: r.racesCounted,
          bestWpm: Math.round(r.rating),
          achievedAt: new Date().toISOString(),
        })),
      };
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
