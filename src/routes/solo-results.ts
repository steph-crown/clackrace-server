import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  keystrokeLogs,
  passages,
  raceParticipants,
  races,
} from "../db/schema.js";
import { accuracyFromMistakes, wpmFromKeystrokes } from "../lib/stats.js";

const bodySchema = z.object({
  passageId: z.string().min(1),
  guestSessionToken: z.string().min(8).max(128),
  carColor: z.string().min(1).max(32),
  finalWpm: z.number().nonnegative(),
  finalAccuracy: z.number().min(0).max(100),
  placement: z.number().int().positive(),
  participantCount: z.number().int().positive().max(8),
  cpuDifficulty: z.enum(["easy", "medium", "hard"]),
  cpuCount: z.number().int().min(1).max(7),
  durationMs: z.number().nonnegative(),
  mistakes: z.number().int().nonnegative(),
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

    // Soft sanity: reject absurd client inflation (still store authoritative)
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

    const [race] = await db
      .insert(races)
      .values({
        sessionId: null,
        passageId: passage.id,
        mode: "solo_cpu",
        startedAt,
        endedAt,
      })
      .returning({ id: races.id });

    if (!race) {
      return reply.code(500).send({ error: "Failed to create race" });
    }

    const [participant] = await db
      .insert(raceParticipants)
      .values({
        raceId: race.id,
        userId: null,
        anonymousName: null,
        guestSessionToken: body.guestSessionToken,
        carColor: body.carColor,
        isCpu: false,
        cpuDifficulty: body.cpuDifficulty,
        finalWpm: authoritativeWpm,
        finalAccuracy: authoritativeAccuracy,
        placement: body.placement,
        disconnected: false,
      })
      .returning({ id: raceParticipants.id });

    if (!participant) {
      return reply.code(500).send({ error: "Failed to create participant" });
    }

    // Solo CPU runs: keep keystrokes for future ghost/PB (Phase 7). Cheap for now.
    if (body.keystrokes.length > 0) {
      await db.insert(keystrokeLogs).values({
        raceParticipantId: participant.id,
        strokes: body.keystrokes,
      });
    }

    return {
      raceId: race.id,
      participantId: participant.id,
      finalWpm: authoritativeWpm,
      finalAccuracy: authoritativeAccuracy,
    };
  });
}
