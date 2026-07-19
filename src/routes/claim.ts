import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import { sendError } from "../lib/api-error.js";
import { claimGuestRuns, getStreak } from "../lib/retention.js";

/** POST /account/claim — reattach guest race rows to the signed-in user. */
export async function claimRoutes(app: FastifyInstance) {
  app.post("/account/claim", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in required.");
    }
    const parsed = z
      .object({ guestSessionToken: z.string().min(8).max(128) })
      .safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, "invalid_body", "Missing guest session.");
    }

    const result = await claimGuestRuns(
      sessionUser.id,
      parsed.data.guestSessionToken,
    );
    const streak = await getStreak(sessionUser.id);

    return {
      claimed: result.claimed,
      streak: {
        current: streak.currentStreak,
        longest: streak.longestStreak,
      },
    };
  });
}
