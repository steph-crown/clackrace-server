import type { FastifyInstance } from "fastify";
import { getSessionUser } from "../auth/session.js";
import { addSseClient } from "../notifications/hub.js";

export async function notificationsRoutes(app: FastifyInstance) {
  app.get("/notifications/stream", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const remove = addSseClient({
      userId: sessionUser.id,
      write: (chunk) => res.write(chunk),
      close: () => res.end(),
    });

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      remove();
    });
  });
}
