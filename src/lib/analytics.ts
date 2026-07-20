import { db } from "../db/client.js";
import { analyticsEvents } from "../db/schema.js";

export type TrackEventInput = {
  name: string;
  userId?: string | null;
  guestSessionToken?: string | null;
  sessionId?: string | null;
  props?: Record<string, unknown>;
  path?: string | null;
};

/** Append-only product analytics (never throws to callers). */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  const name = input.name.trim();
  if (!name || name.length > 96) return;
  try {
    await db.insert(analyticsEvents).values({
      name,
      userId: input.userId ?? null,
      guestSessionToken: input.guestSessionToken ?? null,
      sessionId: input.sessionId ?? null,
      props: input.props ?? {},
      path: input.path ?? null,
    });
  } catch (err) {
    console.error("[analytics] insert failed", name, err);
  }
}
