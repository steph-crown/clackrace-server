import { hashPassword } from "better-auth/crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { auth } from "../auth/index.js";
import { env } from "../env.js";
import { db } from "./client.js";
import { account, user } from "./schema.js";

/**
 * Upsert the sole admin from env on every boot/deploy.
 * Requires ADMIN_USERNAME + ADMIN_PASSWORD (+ optional ADMIN_EMAIL).
 */
export async function seedAdminUser(): Promise<"skipped" | "ok"> {
  const username = env.adminUsername?.trim().toLowerCase();
  const password = env.adminPassword;
  if (!username || !password) {
    return "skipped";
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const email =
    env.adminEmail?.trim().toLowerCase() || `${username}@admin.clackrace.local`;

  const [existing] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.username, username))
    .limit(1);

  let userId = existing?.id;

  if (!userId) {
    const signedUp = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: username,
        username,
      },
    });
    userId = signedUp?.user?.id;
    if (!userId) throw new Error("Admin sign-up failed");
  } else {
    if (existing!.email !== email) {
      await db
        .update(user)
        .set({ email, updatedAt: new Date() })
        .where(eq(user.id, userId));
    }
    const hashed = await hashPassword(password);
    const [cred] = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, userId), eq(account.providerId, "credential")),
      )
      .limit(1);
    if (cred) {
      await db
        .update(account)
        .set({ password: hashed })
        .where(eq(account.id, cred.id));
    } else {
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  await db
    .update(user)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(user.id, userId));

  await db
    .update(user)
    .set({ role: "user", updatedAt: new Date() })
    .where(and(ne(user.id, userId), eq(user.role, "admin")));

  await db.execute(sql`
    UPDATE "user" SET role = 'user' WHERE role IS NULL OR role = ''
  `);

  return "ok";
}
