import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { eloRatings, user } from "../db/schema.js";

const BASE = 1000;
const K_PROVISIONAL = 40;
const K_ESTABLISHED = 20;
const PROVISIONAL_RACES = 20;

export type EloCompetitor = {
  userId: string;
  placement: number;
};

async function getOrCreateRating(userId: string) {
  const [row] = await db
    .select()
    .from(eloRatings)
    .where(eq(eloRatings.userId, userId))
    .limit(1);
  if (row) return row;
  const [created] = await db
    .insert(eloRatings)
    .values({
      userId,
      rating: BASE,
      racesCounted: 0,
      kFactorTier: "provisional",
    })
    .returning();
  return created!;
}

function scoreFromPlacement(placement: number, fieldSize: number): number {
  if (fieldSize <= 1) return 0.5;
  // 1st → 1, last → 0, linear (placement is among ELO-eligible only)
  return (fieldSize - placement) / (fieldSize - 1);
}

/**
 * Update ELO for a race with 2+ logged-in humans (PRD §9).
 * CPU / solo races must not call this.
 * Re-ranks by finish order among competitors only (ignores guest placements).
 */
export async function updateEloForRace(
  competitors: EloCompetitor[],
): Promise<void> {
  if (competitors.length < 2) return;

  const ranked = [...competitors].sort((a, b) => a.placement - b.placement);
  const fieldSize = ranked.length;
  const eloPlace = new Map<string, number>();
  ranked.forEach((c, i) => eloPlace.set(c.userId, i + 1));

  const ratings = new Map<string, Awaited<ReturnType<typeof getOrCreateRating>>>();
  for (const c of competitors) {
    ratings.set(c.userId, await getOrCreateRating(c.userId));
  }

  const updates: {
    userId: string;
    rating: number;
    racesCounted: number;
    kFactorTier: string;
  }[] = [];

  for (const c of competitors) {
    const me = ratings.get(c.userId)!;
    const others = competitors.filter((o) => o.userId !== c.userId);
    const oppAvg =
      others.reduce(
        (sum, o) => sum + (ratings.get(o.userId)?.rating ?? BASE),
        0,
      ) / others.length;
    const E = 1 / (1 + 10 ** ((oppAvg - me.rating) / 400));
    const S = scoreFromPlacement(eloPlace.get(c.userId)!, fieldSize);
    const K =
      me.racesCounted < PROVISIONAL_RACES ? K_PROVISIONAL : K_ESTABLISHED;
    const nextRating = me.rating + K * (S - E);
    const racesCounted = me.racesCounted + 1;
    updates.push({
      userId: c.userId,
      rating: Math.round(nextRating * 10) / 10,
      racesCounted,
      kFactorTier:
        racesCounted < PROVISIONAL_RACES ? "provisional" : "established",
    });
  }

  for (const u of updates) {
    await db
      .update(eloRatings)
      .set({
        rating: u.rating,
        racesCounted: u.racesCounted,
        kFactorTier: u.kFactorTier,
      })
      .where(eq(eloRatings.userId, u.userId));
  }
}

export async function getEloLadder(limit = 50) {
  return db
    .select({
      userId: eloRatings.userId,
      rating: eloRatings.rating,
      racesCounted: eloRatings.racesCounted,
      kFactorTier: eloRatings.kFactorTier,
      username: user.username,
      name: user.name,
      carColor: user.carColor,
    })
    .from(eloRatings)
    .innerJoin(user, eq(eloRatings.userId, user.id))
    .orderBy(desc(eloRatings.rating))
    .limit(limit);
}

export async function getUserElo(userId: string) {
  return getOrCreateRating(userId);
}
