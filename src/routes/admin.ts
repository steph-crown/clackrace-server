import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "../db/client.js";
import { raceParticipants, races, user } from "../db/schema.js";
import { sendError } from "../lib/api-error.js";

/**
 * Minimal shadow-hold review queue (PRD §14 / Phase 7).
 * Protect with ADMIN_TOKEN header or ?token= when ADMIN_TOKEN is set.
 */
export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/shadow-holds", async (req, reply) => {
    const expected = env.adminToken;
    if (!expected) {
      return sendError(
        reply,
        503,
        "admin_disabled",
        "Set ADMIN_TOKEN to enable the shadow-hold review queue.",
      );
    }
    const header = req.headers["x-admin-token"];
    const q =
      typeof (req.query as { token?: string }).token === "string"
        ? (req.query as { token?: string }).token
        : undefined;
    const provided = (typeof header === "string" ? header : undefined) ?? q;
    if (provided !== expected) {
      return sendError(reply, 401, "unauthorized", "Invalid admin token.");
    }

    const rows = await db
      .select({
        id: raceParticipants.id,
        raceId: raceParticipants.raceId,
        userId: raceParticipants.userId,
        username: user.username,
        anonymousName: raceParticipants.anonymousName,
        finalWpm: raceParticipants.finalWpm,
        accuracy: raceParticipants.finalAccuracy,
        flagReason: raceParticipants.flagReason,
        createdAt: raceParticipants.createdAt,
        startedAt: races.startedAt,
      })
      .from(raceParticipants)
      .leftJoin(user, eq(raceParticipants.userId, user.id))
      .leftJoin(races, eq(raceParticipants.raceId, races.id))
      .where(eq(raceParticipants.shadowHeld, true))
      .orderBy(desc(raceParticipants.createdAt))
      .limit(100);

    return {
      entries: rows.map((r) => ({
        id: r.id,
        raceId: r.raceId,
        userId: r.userId,
        username: r.username ?? r.anonymousName,
        finalWpm: r.finalWpm,
        accuracy: r.accuracy,
        flagReason: r.flagReason,
        createdAt: r.createdAt?.toISOString() ?? null,
        startedAt: r.startedAt?.toISOString() ?? null,
      })),
    };
  });
}
