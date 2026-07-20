import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import { sendError } from "../lib/api-error.js";
import { getUserElo } from "../lib/elo.js";
import {
  getGhostForDifficulty,
  getPersonalBests,
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

    const [history, pbs, elo] = await Promise.all([
      getStatsHistory(sessionUser.id),
      getPersonalBests(sessionUser.id),
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
        // Finish time when available — when the run was posted.
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
      personalBests: pbs.map((p) => ({
        difficulty: p.difficulty,
        bestWpm: Math.round(p.bestWpm * 10) / 10,
        bestAccuracy: Math.round(p.bestAccuracy * 10) / 10,
        passageId: p.passageId,
        achievedAt: p.achievedAt.toISOString(),
      })),
      mistypeHeatmap: heatmap,
    };
  });

  app.get("/stats/ghost", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in to race a ghost.");
    }
    const parsed = z
      .object({
        difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, 400, "invalid", "Invalid difficulty.");
    }
    const ghost = await getGhostForDifficulty(
      sessionUser.id,
      parsed.data.difficulty,
    );
    if (!ghost) {
      return sendError(
        reply,
        404,
        "no_pb",
        "No personal best on this difficulty yet. Finish a race to set one.",
      );
    }
    return {
      difficulty: ghost.difficulty,
      bestWpm: ghost.bestWpm,
      bestAccuracy: ghost.bestAccuracy,
      passageId: ghost.passageId,
      passageText: ghost.passageText,
      strokes: ghost.strokes,
    };
  });
}
