import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createPublicSession,
  ensureLiveSession,
  maxPlayersFor,
  publicMembers,
  takenNames,
} from "../sessions/service.js";

export async function sessionsRoutes(app: FastifyInstance) {
  app.post("/sessions/public", async (req, reply) => {
    const parsed = z
      .object({ guestSessionToken: z.string().min(8).max(128) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "guestSessionToken required" });
    }
    const { id } = await createPublicSession(parsed.data.guestSessionToken);
    return {
      id,
      sharePath: `/play/${id}`,
    };
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const session = await ensureLiveSession(req.params.id);
    if (!session || session.status === "ended") {
      return reply.code(404).send({ error: "Race session not found" });
    }
    // Challenge: don't leak roster / joinability to third parties via REST.
    if (session.visibility === "challenge") {
      return {
        id: session.id,
        status: session.status,
        visibility: session.visibility,
        members: [],
        takenNames: [],
        leaderboard: [],
        rematch: null,
        playerCount: 0,
        maxPlayers: 2,
      };
    }
    return {
      id: session.id,
      status: session.status,
      visibility: session.visibility,
      members: publicMembers(session),
      takenNames: [...takenNames(session)],
      leaderboard: session.leaderboard,
      rematch: session.rematch,
      playerCount: session.members.filter((m) => !m.disconnected).length,
      maxPlayers: maxPlayersFor(session),
    };
  });
}
