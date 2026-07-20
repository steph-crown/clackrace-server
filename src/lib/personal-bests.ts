import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  passages,
  personalBests,
  raceParticipants,
  races,
} from "../db/schema.js";

type Difficulty = "easy" | "medium" | "hard";

export async function maybeUpdatePersonalBest(opts: {
  userId: string;
  participantId: string;
  passageId: string;
  wpm: number;
  accuracy: number;
  keystrokes: { charIndex: number; timestampMs: number }[];
  shadowHeld: boolean;
}): Promise<boolean> {
  if (opts.shadowHeld || opts.wpm <= 0 || opts.keystrokes.length === 0) {
    return false;
  }

  const [passage] = await db
    .select()
    .from(passages)
    .where(eq(passages.id, opts.passageId))
    .limit(1);
  if (!passage) return false;

  const difficulty = passage.difficulty as Difficulty;
  const [existing] = await db
    .select()
    .from(personalBests)
    .where(
      and(
        eq(personalBests.userId, opts.userId),
        eq(personalBests.difficulty, difficulty),
      ),
    )
    .limit(1);

  if (existing && opts.wpm <= existing.bestWpm) return false;

  if (existing) {
    await db
      .update(personalBests)
      .set({
        bestWpm: opts.wpm,
        bestAccuracy: opts.accuracy,
        raceParticipantId: opts.participantId,
        passageId: opts.passageId,
        strokes: opts.keystrokes,
        achievedAt: new Date(),
      })
      .where(eq(personalBests.id, existing.id));
  } else {
    await db.insert(personalBests).values({
      userId: opts.userId,
      difficulty,
      bestWpm: opts.wpm,
      bestAccuracy: opts.accuracy,
      raceParticipantId: opts.participantId,
      passageId: opts.passageId,
      strokes: opts.keystrokes,
      achievedAt: new Date(),
    });
  }
  return true;
}

export async function getPersonalBests(userId: string) {
  return db
    .select({
      difficulty: personalBests.difficulty,
      bestWpm: personalBests.bestWpm,
      bestAccuracy: personalBests.bestAccuracy,
      passageId: personalBests.passageId,
      achievedAt: personalBests.achievedAt,
    })
    .from(personalBests)
    .where(eq(personalBests.userId, userId))
    .orderBy(desc(personalBests.bestWpm));
}

export async function getGhostForDifficulty(
  userId: string,
  difficulty: Difficulty,
) {
  const [row] = await db
    .select({
      bestWpm: personalBests.bestWpm,
      bestAccuracy: personalBests.bestAccuracy,
      passageId: personalBests.passageId,
      strokes: personalBests.strokes,
      passageText: passages.text,
      difficulty: personalBests.difficulty,
    })
    .from(personalBests)
    .innerJoin(passages, eq(personalBests.passageId, passages.id))
    .where(
      and(
        eq(personalBests.userId, userId),
        eq(personalBests.difficulty, difficulty),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getStatsHistory(userId: string, limit = 40) {
  return db
    .select({
      wpm: raceParticipants.finalWpm,
      accuracy: raceParticipants.finalAccuracy,
      mistypeCounts: raceParticipants.mistypeCounts,
      startedAt: races.startedAt,
      mode: races.mode,
      shadowHeld: raceParticipants.shadowHeld,
    })
    .from(raceParticipants)
    .innerJoin(races, eq(raceParticipants.raceId, races.id))
    .where(eq(raceParticipants.userId, userId))
    .orderBy(desc(races.startedAt))
    .limit(limit);
}
