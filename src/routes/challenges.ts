import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import {
  createChallenge,
  getChallengeForUser,
  listChallengesForSessionUser,
  respondChallenge,
  revokeChallenge,
} from "../challenges/service.js";
import { sendError } from "../lib/api-error.js";

export async function challengesRoutes(app: FastifyInstance) {
  app.post("/challenges", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in required.");
    }
    const parsed = z
      .object({ target: z.string().min(1).max(254) })
      .safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        "invalid_target",
        "Enter a username or email.",
      );
    }
    const result = await createChallenge(
      sessionUser,
      parsed.data.target,
      app.log,
    );
    if (!result.ok) {
      return sendError(reply, 400, result.code, result.message);
    }
    return {
      challenge: result.challenge,
      emailDelivery: result.emailDelivery,
    };
  });

  app.get("/challenges", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in required.");
    }
    const challenges = await listChallengesForSessionUser(sessionUser);
    return { challenges };
  });

  app.get<{ Params: { id: string } }>(
    "/challenges/:id",
    async (req, reply) => {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return sendError(reply, 401, "unauthorized", "Sign in required.");
      }
      const challenge = await getChallengeForUser(
        sessionUser,
        req.params.id,
      );
      if (!challenge) {
        return sendError(reply, 404, "not_found", "Challenge not found.");
      }
      return { challenge };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/challenges/:id/revoke",
    async (req, reply) => {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return sendError(reply, 401, "unauthorized", "Sign in required.");
      }
      const result = await revokeChallenge(sessionUser.id, req.params.id);
      if (!result.ok) {
        return sendError(reply, 400, result.code, result.message);
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/challenges/:id/respond",
    async (req, reply) => {
      const sessionUser = await getSessionUser(req);
      if (!sessionUser) {
        return sendError(reply, 401, "unauthorized", "Sign in required.");
      }
      const parsed = z
        .object({ accept: z.boolean() })
        .safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, 400, "invalid_body", "Choose accept or decline.");
      }
      const result = await respondChallenge(
        sessionUser,
        req.params.id,
        parsed.data.accept,
      );
      if (!result.ok) {
        return sendError(reply, 400, result.code, result.message);
      }
      return {
        ok: true,
        challenge: result.challenge,
        sessionId: result.sessionId ?? null,
      };
    },
  );
}
