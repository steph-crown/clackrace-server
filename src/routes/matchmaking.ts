import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import { trackEvent } from "../lib/analytics.js";
import { sendError } from "../lib/api-error.js";
import {
  cancelTicket,
  enqueue,
  pollTicket,
} from "../matchmaking/service.js";

export async function matchmakingRoutes(app: FastifyInstance) {
  app.post("/matchmaking/enqueue", async (req, reply) => {
    const parsed = z
      .object({
        guestSessionToken: z.string().min(8).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, "invalid", "Missing guest session.");
    }
    const sessionUser = await getSessionUser(req);
    const result = await enqueue({
      guestSessionToken: parsed.data.guestSessionToken,
      userId: sessionUser?.id ?? null,
    });
    if (!result.ok) {
      return sendError(reply, 400, result.code, result.message);
    }
    void trackEvent({
      name: "quick.queue_enter",
      userId: sessionUser?.id ?? null,
      guestSessionToken: parsed.data.guestSessionToken,
      sessionId: result.sessionId,
      props: { status: result.status },
    });
    return result;
  });

  app.get("/matchmaking/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = await pollTicket(id);
    return status;
  });

  app.post("/matchmaking/tickets/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    await cancelTicket(id);
    return { ok: true };
  });
}
