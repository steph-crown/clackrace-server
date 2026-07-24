import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { user } from "../db/schema.js";
import { getUserElo } from "./elo.js";
import {
  getOverallPersonalBest,
  getStatsHistory,
  reconcilePersonalBests,
} from "./personal-bests.js";

export type PublicStatsPayload = {
  userId: string;
  username: string;
  carColor: string;
  elo: { rating: number; racesCounted: number; kFactorTier: string };
  series: { wpm: number; accuracy: number; at: string; mode: string }[];
  personalBest: {
    wpm: number;
    accuracy: number;
    mode: string;
    achievedAt: string;
  } | null;
  mistypeHeatmap: Record<string, number>;
};

export async function buildStatsForUserId(
  userId: string,
  opts?: { reconcile?: boolean },
): Promise<Omit<PublicStatsPayload, "userId" | "username" | "carColor">> {
  if (opts?.reconcile !== false) {
    await reconcilePersonalBests(userId);
  }

  const [history, pb, elo] = await Promise.all([
    getStatsHistory(userId),
    getOverallPersonalBest(userId),
    getUserElo(userId),
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
}

export async function getPublicStatsByUsername(
  rawUsername: string,
): Promise<PublicStatsPayload | null> {
  const username = rawUsername.trim().toLowerCase();
  if (!username) return null;

  const [row] = await db
    .select({
      id: user.id,
      username: user.username,
      name: user.name,
      carColor: user.carColor,
    })
    .from(user)
    .where(eq(user.username, username))
    .limit(1);

  if (!row?.username) return null;

  const stats = await buildStatsForUserId(row.id, { reconcile: false });
  return {
    userId: row.id,
    username: row.username,
    carColor: row.carColor ?? "#2ee6d6",
    ...stats,
  };
}
