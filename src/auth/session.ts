import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../db/client.js";
import { user } from "../db/schema.js";
import { auth, type SessionUser } from "./index.js";

export async function getSessionUser(
  req: FastifyRequest,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user) return null;
  const u = session.user as SessionUser & { username?: string | null };

  const [row] = await db
    .select({
      carColor: user.carColor,
      font: user.font,
      avatar: user.avatar,
      username: user.username,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, u.id))
    .limit(1);

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: row?.username ?? u.username ?? null,
    carColor: row?.carColor ?? u.carColor ?? "#2ee6d6",
    font: row?.font ?? u.font ?? null,
    avatar: row?.avatar ?? u.avatar ?? null,
    role: row?.role ?? "user",
  };
}

export async function requireAdmin(
  req: FastifyRequest,
): Promise<SessionUser | null> {
  const u = await getSessionUser(req);
  if (!u || u.role !== "admin") return null;
  return u;
}
