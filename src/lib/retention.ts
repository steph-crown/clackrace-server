import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  dailyChampions,
  leaderboardEntries,
  raceParticipants,
  races,
  streaks,
  user,
} from "../db/schema.js";
import {
  badgesForStreak,
  parseCosmetics,
  serializeCosmetics,
  type CosmeticBadge,
} from "./cosmetics.js";

async function unlockBadges(userId: string, add: CosmeticBadge[]) {
  if (add.length === 0) return;
  const [row] = await db
    .select({ avatar: user.avatar })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const current = parseCosmetics(row?.avatar);
  const next = [...new Set([...current.badges, ...add])];
  if (next.length === current.badges.length) return;
  await db
    .update(user)
    .set({
      avatar: serializeCosmetics({ badges: next }),
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId));
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcWeek(d = new Date()): Date {
  const day = d.getUTCDay(); // 0 Sun
  const diff = (day + 6) % 7; // Monday-start
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

async function upsertScope(
  userId: string,
  scope: "all_time" | "daily" | "weekly",
  wpm: number,
  achievedAt: Date,
) {
  const existing = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.userId, userId),
        eq(leaderboardEntries.scope, scope),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (!row) {
    await db.insert(leaderboardEntries).values({
      userId,
      scope,
      bestWpm: wpm,
      achievedAt,
    });
    return;
  }
  if (wpm > row.bestWpm) {
    await db
      .update(leaderboardEntries)
      .set({ bestWpm: wpm, achievedAt })
      .where(eq(leaderboardEntries.id, row.id));
  }
}

export async function recordSignedInResult(
  userId: string,
  wpm: number,
  achievedAt = new Date(),
  opts?: { shadowHeld?: boolean },
): Promise<void> {
  if (wpm <= 0) return;
  // Shadow-held runs still bump streak (play happened) but skip public boards.
  if (opts?.shadowHeld) {
    await bumpStreak(userId, utcDay(achievedAt));
    return;
  }

  await upsertScope(userId, "all_time", wpm, achievedAt);

  // Daily / weekly: replace-or-insert for this period by checking achievedAt window
  const day = utcDay(achievedAt);
  const [daily] = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.userId, userId),
        eq(leaderboardEntries.scope, "daily"),
      ),
    )
    .limit(1);
  if (!daily || utcDay(daily.achievedAt) !== day || wpm > daily.bestWpm) {
    if (daily) {
      await db
        .update(leaderboardEntries)
        .set({ bestWpm: wpm, achievedAt })
        .where(eq(leaderboardEntries.id, daily.id));
    } else {
      await db.insert(leaderboardEntries).values({
        userId,
        scope: "daily",
        bestWpm: wpm,
        achievedAt,
      });
    }
  }

  const weekStart = startOfUtcWeek(achievedAt).getTime();
  const [weekly] = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.userId, userId),
        eq(leaderboardEntries.scope, "weekly"),
      ),
    )
    .limit(1);
  if (
    !weekly ||
    weekly.achievedAt.getTime() < weekStart ||
    wpm > weekly.bestWpm
  ) {
    if (weekly) {
      await db
        .update(leaderboardEntries)
        .set({ bestWpm: wpm, achievedAt })
        .where(eq(leaderboardEntries.id, weekly.id));
    } else {
      await db.insert(leaderboardEntries).values({
        userId,
        scope: "weekly",
        bestWpm: wpm,
        achievedAt,
      });
    }
  }

  await bumpStreak(userId, day);
  await maybeSetDailyChampion(userId, wpm, day);
}

export async function bumpStreak(userId: string, day: string): Promise<void> {
  const [row] = await db
    .select()
    .from(streaks)
    .where(eq(streaks.userId, userId))
    .limit(1);

  if (!row) {
    await db.insert(streaks).values({
      userId,
      currentStreak: 1,
      longestStreak: 1,
      lastPlayedDate: day,
    });
    await unlockBadges(userId, badgesForStreak(1));
    return;
  }

  if (row.lastPlayedDate === day) return;

  const yesterday = new Date(`${day}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const y = yesterday.toISOString().slice(0, 10);

  const next =
    row.lastPlayedDate === y ? row.currentStreak + 1 : 1;
  await db
    .update(streaks)
    .set({
      currentStreak: next,
      longestStreak: Math.max(row.longestStreak, next),
      lastPlayedDate: day,
    })
    .where(eq(streaks.userId, userId));
  await unlockBadges(userId, badgesForStreak(Math.max(row.longestStreak, next)));
}

async function maybeSetDailyChampion(
  userId: string,
  wpm: number,
  day: string,
): Promise<void> {
  const [champ] = await db
    .select()
    .from(dailyChampions)
    .where(eq(dailyChampions.day, day))
    .limit(1);
  if (!champ) {
    await db.insert(dailyChampions).values({ day, userId, bestWpm: wpm });
    await unlockBadges(userId, ["champion-crown"]);
    return;
  }
  if (wpm > champ.bestWpm) {
    await db
      .update(dailyChampions)
      .set({ userId, bestWpm: wpm })
      .where(eq(dailyChampions.day, day));
    await unlockBadges(userId, ["champion-crown"]);
  }
}

export async function claimGuestRuns(
  userId: string,
  guestSessionToken: string,
): Promise<{ claimed: number }> {
  const rows = await db
    .select({
      id: raceParticipants.id,
      finalWpm: raceParticipants.finalWpm,
      shadowHeld: raceParticipants.shadowHeld,
      createdAt: raceParticipants.createdAt,
      raceStartedAt: races.startedAt,
    })
    .from(raceParticipants)
    .leftJoin(races, eq(raceParticipants.raceId, races.id))
    .where(
      and(
        eq(raceParticipants.guestSessionToken, guestSessionToken),
        sql`${raceParticipants.userId} is null`,
      ),
    );

  if (rows.length === 0) return { claimed: 0 };

  await db
    .update(raceParticipants)
    .set({ userId })
    .where(
      and(
        eq(raceParticipants.guestSessionToken, guestSessionToken),
        sql`${raceParticipants.userId} is null`,
      ),
    );

  // Apply chronologically so streak backfill doesn't reset on out-of-order days.
  const ordered = [...rows].sort(
    (a, b) =>
      (a.raceStartedAt ?? a.createdAt).getTime() -
      (b.raceStartedAt ?? b.createdAt).getTime(),
  );

  for (const r of ordered) {
    if (r.finalWpm != null && r.finalWpm > 0) {
      await recordSignedInResult(
        userId,
        r.finalWpm,
        r.raceStartedAt ?? r.createdAt,
        { shadowHeld: !!r.shadowHeld },
      );
    }
  }

  return { claimed: rows.length };
}

export async function getLeaderboard(scope: "all_time" | "daily" | "weekly") {
  const weekStart = startOfUtcWeek();
  const today = utcDay();
  const dayStart = new Date(`${today}T00:00:00.000Z`);

  const rows = await db
    .select({
      userId: leaderboardEntries.userId,
      bestWpm: leaderboardEntries.bestWpm,
      achievedAt: leaderboardEntries.achievedAt,
      username: user.username,
      name: user.name,
      carColor: user.carColor,
    })
    .from(leaderboardEntries)
    .innerJoin(user, eq(leaderboardEntries.userId, user.id))
    .where(
      scope === "daily"
        ? and(
            eq(leaderboardEntries.scope, scope),
            gte(leaderboardEntries.achievedAt, dayStart),
          )
        : scope === "weekly"
          ? and(
              eq(leaderboardEntries.scope, scope),
              gte(leaderboardEntries.achievedAt, weekStart),
            )
          : eq(leaderboardEntries.scope, scope),
    )
    .orderBy(desc(leaderboardEntries.bestWpm))
    .limit(50);

  return rows;
}

export async function getDailyChampion() {
  const day = utcDay();
  const [champ] = await db
    .select({
      day: dailyChampions.day,
      userId: dailyChampions.userId,
      bestWpm: dailyChampions.bestWpm,
      username: user.username,
      name: user.name,
      carColor: user.carColor,
    })
    .from(dailyChampions)
    .innerJoin(user, eq(dailyChampions.userId, user.id))
    .where(eq(dailyChampions.day, day))
    .limit(1);
  return champ ?? null;
}

export async function getStreak(userId: string) {
  const [row] = await db
    .select()
    .from(streaks)
    .where(eq(streaks.userId, userId))
    .limit(1);
  return (
    row ?? {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastPlayedDate: null as string | null,
    }
  );
}
