import type { FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth, type SessionUser } from "./index.js";

export async function getSessionUser(
  req: FastifyRequest,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user) return null;
  const u = session.user as SessionUser & { username?: string | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username ?? null,
    carColor: u.carColor ?? "#2ee6d6",
    font: u.font ?? null,
    avatar: u.avatar ?? null,
  };
}
