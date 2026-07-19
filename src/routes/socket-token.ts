import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/index.js";
import { sendError } from "../lib/api-error.js";

/**
 * Returns the session token for Socket.IO join (cookies stay on :3000;
 * the socket connects to :4000 and needs an explicit token).
 */
export async function socketTokenRoutes(app: FastifyInstance) {
  app.get("/auth/socket-token", async (req, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.session?.token) {
      return sendError(reply, 401, "unauthorized", "Sign in required.");
    }
    return { token: session.session.token };
  });
}
