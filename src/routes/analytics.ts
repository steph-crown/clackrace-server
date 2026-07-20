import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import { trackEvent } from "../lib/analytics.js";
import { sendError } from "../lib/api-error.js";

const bodySchema = z.object({
  name: z.string().min(1).max(96),
  guestSessionToken: z.string().min(8).max(128).optional(),
  sessionId: z.string().max(64).optional(),
  props: z.record(z.unknown()).optional(),
  path: z.string().max(512).optional(),
});

const batchSchema = z.object({
  events: z.array(bodySchema).min(1).max(40),
});

/** Public ingest — client funnels. Auth optional. */
export async function analyticsRoutes(app: FastifyInstance) {
  app.post("/analytics/events", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, "invalid", "Invalid event.");
    }
    const sessionUser = await getSessionUser(req);
    const e = parsed.data;
    await trackEvent({
      name: e.name,
      userId: sessionUser?.id ?? null,
      guestSessionToken: e.guestSessionToken ?? null,
      sessionId: e.sessionId ?? null,
      props: e.props,
      path: e.path ?? null,
    });
    return { ok: true };
  });

  app.post("/analytics/events/batch", async (req, reply) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, "invalid", "Invalid batch.");
    }
    const sessionUser = await getSessionUser(req);
    await Promise.all(
      parsed.data.events.map((e) =>
        trackEvent({
          name: e.name,
          userId: sessionUser?.id ?? null,
          guestSessionToken: e.guestSessionToken ?? null,
          sessionId: e.sessionId ?? null,
          props: e.props,
          path: e.path ?? null,
        }),
      ),
    );
    return { ok: true, count: parsed.data.events.length };
  });
}
