import type { FastifyInstance } from "fastify";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  or,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth/session.js";
import { env } from "../env.js";
import { db } from "../db/client.js";
import {
  analyticsEvents,
  dailyChampions,
  eloRatings,
  leaderboardEntries,
  passages,
  personalBests,
  raceParticipants,
  races,
  raceSessions,
  streaks,
  user,
} from "../db/schema.js";
import { sendError } from "../lib/api-error.js";

const ENTITIES = [
  "events",
  "users",
  "sessions",
  "races",
  "participants",
  "personal_bests",
  "leaderboard",
  "elo",
  "streaks",
  "champions",
  "passages",
  "shadow_holds",
] as const;

type Entity = (typeof ENTITIES)[number];

async function gateAdmin(req: Parameters<typeof requireAdmin>[0], reply: {
  code: (n: number) => { send: (b: unknown) => unknown };
}) {
  const admin = await requireAdmin(req);
  if (!admin) {
    sendError(reply as never, 401, "unauthorized", "Admin sign-in required.");
    return null;
  }
  return admin;
}

function pageParams(query: unknown) {
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(40),
      q: z.string().max(120).optional(),
      name: z.string().max(96).optional(),
      scope: z.string().max(32).optional(),
      mode: z.string().max(32).optional(),
      visibility: z.string().max(32).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    })
    .safeParse(query);
  if (!parsed.success) return null;
  const { page, limit, ...filters } = parsed.data;
  return { page, limit, offset: (page - 1) * limit, filters };
}

export async function adminRoutes(app: FastifyInstance) {
  /** Who am I — used by /nimad to gate the UI. */
  app.get("/admin/me", async (req, reply) => {
    const admin = await requireAdmin(req);
    if (!admin) {
      return sendError(reply, 401, "unauthorized", "Admin sign-in required.");
    }
    return {
      user: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
      },
    };
  });

  app.get("/admin/overview", async (req, reply) => {
    if (!(await gateAdmin(req, reply))) return;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      [usersC],
      [sessionsC],
      [racesC],
      [eventsC],
      [events7d],
      topEvents,
    ] = await Promise.all([
      db.select({ n: count() }).from(user),
      db.select({ n: count() }).from(raceSessions),
      db.select({ n: count() }).from(races),
      db.select({ n: count() }).from(analyticsEvents),
      db
        .select({ n: count() })
        .from(analyticsEvents)
        .where(gte(analyticsEvents.createdAt, since)),
      db
        .select({
          name: analyticsEvents.name,
          n: count(),
        })
        .from(analyticsEvents)
        .where(gte(analyticsEvents.createdAt, since))
        .groupBy(analyticsEvents.name)
        .orderBy(desc(count()))
        .limit(20),
    ]);

    return {
      counts: {
        users: usersC?.n ?? 0,
        sessions: sessionsC?.n ?? 0,
        races: racesC?.n ?? 0,
        events: eventsC?.n ?? 0,
        events7d: events7d?.n ?? 0,
      },
      topEvents7d: topEvents.map((r) => ({ name: r.name, count: r.n })),
      entities: ENTITIES,
    };
  });

  app.get("/admin/entities/:entity", async (req, reply) => {
    if (!(await gateAdmin(req, reply))) return;

    const entity = (req.params as { entity?: string }).entity as Entity;
    if (!ENTITIES.includes(entity)) {
      return sendError(reply, 400, "invalid", "Unknown entity.");
    }
    const params = pageParams(req.query);
    if (!params) {
      return sendError(reply, 400, "invalid", "Invalid query.");
    }
    const { page, limit, offset, filters } = params;
    const q = filters.q?.trim();

    if (entity === "events") {
      const conds: SQL[] = [];
      if (filters.name) conds.push(eq(analyticsEvents.name, filters.name));
      if (q) {
        conds.push(
          or(
            ilike(analyticsEvents.name, `%${q}%`),
            ilike(analyticsEvents.path, `%${q}%`),
            ilike(analyticsEvents.guestSessionToken, `%${q}%`),
            ilike(analyticsEvents.sessionId, `%${q}%`),
          )!,
        );
      }
      if (filters.from)
        conds.push(gte(analyticsEvents.createdAt, new Date(filters.from)));
      const where = conds.length ? and(...conds) : undefined;
      const [totalRow] = await db
        .select({ n: count() })
        .from(analyticsEvents)
        .where(where);
      const rows = await db
        .select({
          id: analyticsEvents.id,
          name: analyticsEvents.name,
          userId: analyticsEvents.userId,
          guestSessionToken: analyticsEvents.guestSessionToken,
          sessionId: analyticsEvents.sessionId,
          props: analyticsEvents.props,
          path: analyticsEvents.path,
          createdAt: analyticsEvents.createdAt,
        })
        .from(analyticsEvents)
        .where(where)
        .orderBy(desc(analyticsEvents.createdAt))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (entity === "users") {
      const where = q
        ? or(
            ilike(user.username, `%${q}%`),
            ilike(user.email, `%${q}%`),
            ilike(user.name, `%${q}%`),
          )
        : undefined;
      const [totalRow] = await db.select({ n: count() }).from(user).where(where);
      const rows = await db
        .select({
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
          carColor: user.carColor,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(where)
        .orderBy(desc(user.createdAt))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (entity === "sessions") {
      const conds: SQL[] = [];
      if (filters.visibility)
        conds.push(
          eq(
            raceSessions.visibility,
            filters.visibility as "public" | "challenge" | "matchmade",
          ),
        );
      if (q) conds.push(ilike(raceSessions.id, `%${q}%`));
      const where = conds.length ? and(...conds) : undefined;
      const [totalRow] = await db
        .select({ n: count() })
        .from(raceSessions)
        .where(where);
      const rows = await db
        .select()
        .from(raceSessions)
        .where(where)
        .orderBy(desc(raceSessions.createdAt))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          id: r.id,
          visibility: r.visibility,
          status: r.status,
          creatorUserId: r.creatorUserId,
          createdAt: r.createdAt.toISOString(),
          endedAt: r.endedAt?.toISOString() ?? null,
        })),
      };
    }

    if (entity === "races") {
      const conds: SQL[] = [];
      if (filters.mode) conds.push(eq(races.mode, filters.mode));
      if (q) {
        conds.push(
          or(ilike(races.id, `%${q}%`), ilike(races.sessionId, `%${q}%`))!,
        );
      }
      const where = conds.length ? and(...conds) : undefined;
      const [totalRow] = await db.select({ n: count() }).from(races).where(where);
      const rows = await db
        .select()
        .from(races)
        .where(where)
        .orderBy(desc(races.startedAt))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          id: r.id,
          sessionId: r.sessionId,
          passageId: r.passageId,
          mode: r.mode,
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt?.toISOString() ?? null,
        })),
      };
    }

    if (entity === "participants") {
      const conds: SQL[] = [];
      if (q) {
        conds.push(
          or(
            ilike(raceParticipants.anonymousName, `%${q}%`),
            ilike(raceParticipants.userId, `%${q}%`),
            ilike(raceParticipants.raceId, `%${q}%`),
          )!,
        );
      }
      const where = conds.length ? and(...conds) : undefined;
      const [totalRow] = await db
        .select({ n: count() })
        .from(raceParticipants)
        .where(where);
      const rows = await db
        .select({
          id: raceParticipants.id,
          raceId: raceParticipants.raceId,
          userId: raceParticipants.userId,
          anonymousName: raceParticipants.anonymousName,
          finalWpm: raceParticipants.finalWpm,
          finalAccuracy: raceParticipants.finalAccuracy,
          placement: raceParticipants.placement,
          shadowHeld: raceParticipants.shadowHeld,
          flagReason: raceParticipants.flagReason,
          disconnected: raceParticipants.disconnected,
          createdAt: raceParticipants.createdAt,
        })
        .from(raceParticipants)
        .where(where)
        .orderBy(desc(raceParticipants.createdAt))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (entity === "personal_bests") {
      const [totalRow] = await db.select({ n: count() }).from(personalBests);
      const rows = await db
        .select({
          id: personalBests.id,
          userId: personalBests.userId,
          username: user.username,
          difficulty: personalBests.difficulty,
          bestWpm: personalBests.bestWpm,
          bestAccuracy: personalBests.bestAccuracy,
          passageId: personalBests.passageId,
          achievedAt: personalBests.achievedAt,
        })
        .from(personalBests)
        .leftJoin(user, eq(personalBests.userId, user.id))
        .orderBy(desc(personalBests.bestWpm))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          ...r,
          achievedAt: r.achievedAt.toISOString(),
        })),
      };
    }

    if (entity === "leaderboard") {
      const conds: SQL[] = [];
      if (filters.scope)
        conds.push(
          eq(
            leaderboardEntries.scope,
            filters.scope as "all_time" | "daily" | "weekly",
          ),
        );
      const where = conds.length ? and(...conds) : undefined;
      const [totalRow] = await db
        .select({ n: count() })
        .from(leaderboardEntries)
        .where(where);
      const rows = await db
        .select({
          id: leaderboardEntries.id,
          userId: leaderboardEntries.userId,
          username: user.username,
          scope: leaderboardEntries.scope,
          bestWpm: leaderboardEntries.bestWpm,
          achievedAt: leaderboardEntries.achievedAt,
        })
        .from(leaderboardEntries)
        .leftJoin(user, eq(leaderboardEntries.userId, user.id))
        .where(where)
        .orderBy(desc(leaderboardEntries.bestWpm))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          ...r,
          achievedAt: r.achievedAt.toISOString(),
        })),
      };
    }

    if (entity === "elo") {
      const [totalRow] = await db.select({ n: count() }).from(eloRatings);
      const rows = await db
        .select({
          userId: eloRatings.userId,
          username: user.username,
          rating: eloRatings.rating,
          racesCounted: eloRatings.racesCounted,
          kFactorTier: eloRatings.kFactorTier,
        })
        .from(eloRatings)
        .leftJoin(user, eq(eloRatings.userId, user.id))
        .orderBy(desc(eloRatings.rating))
        .limit(limit)
        .offset(offset);
      return { entity, page, limit, total: totalRow?.n ?? 0, rows };
    }

    if (entity === "streaks") {
      const [totalRow] = await db.select({ n: count() }).from(streaks);
      const rows = await db
        .select({
          userId: streaks.userId,
          username: user.username,
          currentStreak: streaks.currentStreak,
          longestStreak: streaks.longestStreak,
          lastPlayedDate: streaks.lastPlayedDate,
        })
        .from(streaks)
        .leftJoin(user, eq(streaks.userId, user.id))
        .orderBy(desc(streaks.currentStreak))
        .limit(limit)
        .offset(offset);
      return { entity, page, limit, total: totalRow?.n ?? 0, rows };
    }

    if (entity === "champions") {
      const [totalRow] = await db.select({ n: count() }).from(dailyChampions);
      const rows = await db
        .select({
          day: dailyChampions.day,
          userId: dailyChampions.userId,
          username: user.username,
          bestWpm: dailyChampions.bestWpm,
          createdAt: dailyChampions.createdAt,
        })
        .from(dailyChampions)
        .leftJoin(user, eq(dailyChampions.userId, user.id))
        .orderBy(desc(dailyChampions.day))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    if (entity === "passages") {
      const [totalRow] = await db.select({ n: count() }).from(passages);
      const rows = await db
        .select({
          id: passages.id,
          difficulty: passages.difficulty,
          source: passages.source,
          text: passages.text,
          createdAt: passages.createdAt,
        })
        .from(passages)
        .orderBy(asc(passages.difficulty), asc(passages.id))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          id: r.id,
          difficulty: r.difficulty,
          source: r.source,
          textPreview: r.text.slice(0, 80),
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }

    // shadow_holds — also keep legacy token gate for old UI
    if (entity === "shadow_holds") {
      const [totalRow] = await db
        .select({ n: count() })
        .from(raceParticipants)
        .where(eq(raceParticipants.shadowHeld, true));
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
        })
        .from(raceParticipants)
        .leftJoin(user, eq(raceParticipants.userId, user.id))
        .where(eq(raceParticipants.shadowHeld, true))
        .orderBy(desc(raceParticipants.createdAt))
        .limit(limit)
        .offset(offset);
      return {
        entity,
        page,
        limit,
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          id: r.id,
          raceId: r.raceId,
          userId: r.userId,
          username: r.username ?? r.anonymousName,
          finalWpm: r.finalWpm,
          accuracy: r.accuracy,
          flagReason: r.flagReason,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
      };
    }

    return sendError(reply, 400, "invalid", "Unknown entity.");
  });

  /** Legacy token-gated shadow queue (kept for /admin/shadow). */
  app.get("/admin/shadow-holds", async (req, reply) => {
    const expected = env.adminToken;
    const admin = await requireAdmin(req);
    if (!admin) {
      if (!expected) {
        return sendError(
          reply,
          503,
          "admin_disabled",
          "Sign in as admin at /nimad, or set ADMIN_TOKEN.",
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
