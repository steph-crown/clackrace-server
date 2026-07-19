import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "../auth/session.js";
import { db } from "../db/client.js";
import { user } from "../db/schema.js";
import { sendError } from "../lib/api-error.js";
import { CAR_COLOR_PALETTE } from "../lib/car-colors.js";
import { getStreak } from "../lib/retention.js";

const TYPING_FONTS = [
  "jetbrains-mono",
  "ibm-plex-mono",
  "space-mono",
  "system-mono",
] as const;

const patchSchema = z.object({
  username: z.string().min(3).max(24).optional(),
  carColor: z.string().min(1).max(32).optional(),
  font: z.enum(TYPING_FONTS).nullable().optional(),
});

export async function meRoutes(app: FastifyInstance) {
  app.get("/me", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in required.");
    }
    const streak = await getStreak(sessionUser.id);
    return {
      user: sessionUser,
      streak: {
        current: streak.currentStreak,
        longest: streak.longestStreak,
        lastPlayedDate: streak.lastPlayedDate,
      },
      fonts: TYPING_FONTS,
      carColors: CAR_COLOR_PALETTE,
    };
  });

  app.patch("/me", async (req, reply) => {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return sendError(reply, 401, "unauthorized", "Sign in required.");
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, "invalid_body", "Check your settings and try again.");
    }
    const body = parsed.data;

    if (body.carColor) {
      const ok = (CAR_COLOR_PALETTE as readonly string[]).includes(
        body.carColor,
      );
      if (!ok) {
        return sendError(reply, 400, "invalid_color", "Pick a color from the palette.");
      }
    }

    if (body.username) {
      const taken = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, body.username.toLowerCase()))
        .limit(1);
      if (taken[0] && taken[0].id !== sessionUser.id) {
        return sendError(reply, 409, "username_taken", "That username is taken.");
      }
    }

    const [updated] = await db
      .update(user)
      .set({
        ...(body.username
          ? {
              username: body.username.toLowerCase(),
              displayUsername: body.username,
              name: body.username,
            }
          : {}),
        ...(body.carColor ? { carColor: body.carColor } : {}),
        ...(body.font !== undefined ? { font: body.font } : {}),
        updatedAt: new Date(),
      })
      .where(eq(user.id, sessionUser.id))
      .returning();

    if (!updated) {
      return sendError(reply, 500, "update_failed", "Couldn't save settings.");
    }

    return {
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        username: updated.username,
        carColor: updated.carColor,
        font: updated.font,
        avatar: updated.avatar,
      },
    };
  });
}
