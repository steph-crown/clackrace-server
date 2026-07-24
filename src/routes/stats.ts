import type { FastifyInstance } from "fastify";
import { getSessionUser } from "../auth/session.js";
import { sendError } from "../lib/api-error.js";
import { getGhostForBest } from "../lib/personal-bests.js";
import {
  buildStatsForUserId,
  getPublicStatsByUsername,
} from "../lib/stats-view.js";

export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats/me", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in to view stats.");
    }

    return buildStatsForUserId(sessionUser.id);
  });

  /** Public garage by username (leaderboard deep-link). */
  app.get<{ Params: { username: string } }>(
    "/stats/u/:username",
    async (req, reply) => {
      const stats = await getPublicStatsByUsername(req.params.username);
      if (!stats) {
        return sendError(reply, 404, "not_found", "Racer not found.");
      }
      return stats;
    },
  );

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
