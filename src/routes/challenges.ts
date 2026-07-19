import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import {
  createChallenge,
  getChallengeForUser,
  listUserChallenges,
  respondChallenge,
  revokeChallenge,
} from "../challenges/service.js";

export async function challengesRoutes(app: FastifyInstance) {
  app.post("/challenges", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return reply.code(401).send({ error: "Sign in required" });
    }
    const parsed = z
      .object({ target: z.string().min(1).max(254) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "target required" });
    }
    const result = await createChallenge(
      sessionUser,
      parsed.data.target,
      app.log,
    );
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return {
      challenge: result.challenge,
      emailDelivery: result.emailDelivery,
    };
  });

  app.get("/challenges", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return reply.code(401).send({ error: "Sign in required" });
    }
    const challenges = await listUserChallenges(sessionUser.id);
    return { challenges };
  });

  app.get<{ Params: { id: string } }>(
    "/challenges/:id",
    async (req, reply) => {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return reply.code(401).send({ error: "Sign in required" });
      }
      const challenge = await getChallengeForUser(
        sessionUser.id,
        req.params.id,
      );
      if (!challenge) {
        return reply.code(404).send({ error: "Not found" });
      }
      return { challenge };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/challenges/:id/revoke",
    async (req, reply) => {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return reply.code(401).send({ error: "Sign in required" });
      }
      const result = await revokeChallenge(sessionUser.id, req.params.id);
      if (!result.ok) {
        return reply.code(400).send(result);
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/challenges/:id/respond",
    async (req, reply) => {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return reply.code(401).send({ error: "Sign in required" });
      }
      const parsed = z
        .object({ accept: z.boolean() })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "accept required" });
      }
      const result = await respondChallenge(
        sessionUser,
        req.params.id,
        parsed.data.accept,
      );
      if (!result.ok) {
        return reply.code(400).send(result);
      }
      return {
        ok: true,
        challenge: result.challenge,
        sessionId: result.sessionId ?? null,
      };
    },
  );
}
