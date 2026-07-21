import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import { db } from "../db/client.js";
import {
  keystrokeLogs,
  passages,
  raceParticipants,
  races,
} from "../db/schema.js";
import {
  evaluateAntiCheat,
  shouldRetainKeystrokes,
} from "../lib/anti-cheat.js";
import { maybeUpdatePersonalBest } from "../lib/personal-bests.js";
import { accuracyFromMistakes, wpmFromKeystrokes } from "../lib/stats.js";
import { assignUniqueName } from "../lib/anonymous-names.js";
import { recordSignedInResult } from "../lib/retention.js";

const bodySchema = z.object({
  passageId: z.string().min(1),
  guestSessionToken: z.string().min(8).max(128),
  carColor: z.string().min(1).max(32),
  finalWpm: z.number().nonnegative(),
  finalAccuracy: z.number().min(0).max(100),
  placement: z.number().int().positive(),
  participantCount: z.number().int().positive().max(8),
  cpuDifficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
  cpuCount: z.number().int().min(0).max(7).optional(),
  mode: z.enum(["solo_cpu", "solo_ghost"]).optional(),
  durationMs: z.number().nonnegative(),
  mistakes: z.number().int().nonnegative(),
  mistypeCounts: z.record(z.number()).optional(),
  keystrokes: z.array(
    z.object({
      charIndex: z.number().int().nonnegative(),
      timestampMs: z.number().int().nonnegative(),
    }),
  ),
  passageLength: z.number().int().positive(),
});

export async function soloResultsRoutes(app: FastifyInstance) {
  app.post("/races/solo/results", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;
    const sessionUser = await getSessionUser(req);

    const [passage] = await db
      .select()
      .from(passages)
      .where(eq(passages.id, body.passageId))
      .limit(1);

    if (!passage) {
      return reply.code(400).send({ error: "Unknown passageId" });
    }

    if (body.passageLength !== passage.text.length) {
      return reply.code(400).send({ error: "passageLength mismatch" });
    }

    const authoritativeWpm = wpmFromKeystrokes(
      body.keystrokes,
      passage.text.length,
    );
    const correctChars = Math.min(
      body.keystrokes.length,
      passage.text.length,
    );
    const authoritativeAccuracy = accuracyFromMistakes(
      correctChars,
      body.mistakes,
    );

    if (body.finalWpm > authoritativeWpm + 40 && authoritativeWpm > 0) {
      app.log.warn(
        {
          clientWpm: body.finalWpm,
          authoritativeWpm,
        },
        "solo result WPM mismatch",
      );
    }

    const startedAt = new Date(Date.now() - Math.round(body.durationMs));
    const endedAt = new Date();

    const verdict = evaluateAntiCheat(authoritativeWpm, body.keystrokes);
    const mode = body.mode ?? "solo_cpu";

    const [race] = await db
      .insert(races)
      .values({
        sessionId: null,
        passageId: passage.id,
        mode,
        startedAt,
        endedAt,
      })
      .returning({ id: races.id });

    if (!race) {
      return reply.code(500).send({ error: "Failed to create race" });
    }

    const carColor = sessionUser?.carColor ?? body.carColor;

    const [participant] = await db
      .insert(raceParticipants)
      .values({
        raceId: race.id,
        userId: sessionUser?.id ?? null,
        anonymousName: sessionUser
          ? null
          : assignUniqueName(undefined, new Set()),
        guestSessionToken: body.guestSessionToken,
        carColor,
        isCpu: false,
        cpuDifficulty: body.cpuDifficulty ?? null,
        finalWpm: authoritativeWpm,
        finalAccuracy: authoritativeAccuracy,
        placement: body.placement,
        disconnected: false,
        shadowHeld: verdict.shadowHeld,
        flagReason: verdict.flagReason,
        mistypeCounts: body.mistypeCounts ?? null,
      })
      .returning({ id: raceParticipants.id });

    if (!participant) {
      return reply.code(500).send({ error: "Failed to create participant" });
    }

    let isPb = false;
    if (sessionUser && authoritativeWpm > 0 && body.keystrokes.length > 0) {
      isPb = await maybeUpdatePersonalBest({
        userId: sessionUser.id,
        participantId: participant.id,
        passageId: passage.id,
        wpm: authoritativeWpm,
        accuracy: authoritativeAccuracy,
        keystrokes: body.keystrokes,
        shadowHeld: verdict.shadowHeld,
      });
    }

    if (
      body.keystrokes.length > 0 &&
      shouldRetainKeystrokes({
        shadowHeld: verdict.shadowHeld,
        leaderboardEligible: !!sessionUser && !verdict.shadowHeld,
        isPersonalBest: isPb,
        claimableGuest: !sessionUser && !verdict.shadowHeld,
      })
    ) {
      await db.insert(keystrokeLogs).values({
        raceParticipantId: participant.id,
        strokes: body.keystrokes,
      });
    }

    if (sessionUser && authoritativeWpm > 0) {
      await recordSignedInResult(sessionUser.id, authoritativeWpm, endedAt, {
        shadowHeld: verdict.shadowHeld,
      });
    }

    return {
      raceId: race.id,
      participantId: participant.id,
      finalWpm: authoritativeWpm,
      finalAccuracy: authoritativeAccuracy,
      shadowHeld: verdict.shadowHeld,
    };
  });
}
