import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import { session, user } from "../db/schema.js";
import type { SessionUser } from "./index.js";

/**
 * Resolve a signed-in user from a Better Auth session token
 * (looked up in Postgres — reliable for Socket.IO joins across origins).
 */
export async function getUserFromSessionToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token || token.length < 8) return null;
  try {
    const [row] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        carColor: user.carColor,
        font: user.font,
        avatar: user.avatar,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      username: row.username,
      carColor: row.carColor,
      font: row.font,
      avatar: row.avatar,
    };
  } catch {
    return null;
  }
}
