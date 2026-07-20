import type { FastifyInstance } from "fastify";
import { getSessionUser } from "../auth/session.js";
import { sendError } from "../lib/api-error.js";
import { getUserElo } from "../lib/elo.js";
import {
  getGhostForBest,
  getOverallPersonalBest,
  getStatsHistory,
  reconcilePersonalBests,
} from "../lib/personal-bests.js";

export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats/me", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in to view stats.");
    }

    // Heal PBs that missed historical runs (e.g. races before PB tracking).
    await reconcilePersonalBests(sessionUser.id);

    const [history, pb, elo] = await Promise.all([
      getStatsHistory(sessionUser.id),
      getOverallPersonalBest(sessionUser.id),
      getUserElo(sessionUser.id),
    ]);

    const heatmap: Record<string, number> = {};
    for (const row of history) {
      if (!row.mistypeCounts) continue;
      for (const [k, v] of Object.entries(row.mistypeCounts)) {
        heatmap[k] = (heatmap[k] ?? 0) + v;
      }
    }

    const series = history
      .filter((h) => h.wpm != null && !h.shadowHeld)
      .map((h) => ({
        wpm: h.wpm!,
        accuracy: h.accuracy ?? 0,
        at: (h.endedAt ?? h.startedAt).toISOString(),
        mode: h.mode,
      }))
      .reverse();

    return {
      elo: {
        rating: elo.rating,
        racesCounted: elo.racesCounted,
        kFactorTier: elo.kFactorTier,
      },
      series,
      personalBest: pb
        ? {
            wpm: Math.round(pb.bestWpm * 10) / 10,
            accuracy: Math.round(pb.bestAccuracy * 10) / 10,
            mode: pb.mode,
            achievedAt: pb.achievedAt.toISOString(),
          }
        : null,
      mistypeHeatmap: heatmap,
    };
  });

  app.get("/stats/ghost", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in to race your best.");
    }
    const ghost = await getGhostForBest(sessionUser.id);
    if (!ghost) {
      return sendError(
        reply,
        404,
        "no_pb",
        "No personal best yet. Finish a race to set one.",
      );
    }
    return {
      bestWpm: ghost.bestWpm,
      bestAccuracy: ghost.bestAccuracy,
      passageId: ghost.passageId,
      passageText: ghost.passageText,
      strokes: ghost.strokes,
      mode: ghost.mode,
      difficulty: ghost.difficulty,
    };
  });
}
