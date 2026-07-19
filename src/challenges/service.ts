import { eq, or } from "drizzle-orm";
import type { SessionUser } from "../auth/index.js";
import { db } from "../db/client.js";
import { user } from "../db/schema.js";
import {
  canSendInviteEmail,
  sendChallengeInviteEmail,
} from "../notifications/email.js";
import { isUserOnline, pushToUser } from "../notifications/hub.js";
import { createChallengeSession } from "../sessions/service.js";
import {
  getChallenge,
  listUserChallenges,
  newChallengeId,
  OFFLINE_TTL_SEC,
  ONLINE_TTL_SEC,
  saveChallenge,
  updateChallenge,
  type ChallengeRecord,
} from "./store.js";

import { env } from "../env.js";

const appOrigin = env.appUrl;

export async function lookupRecipient(query: string) {
  const q = query.trim();
  if (!q) return null;
  const normalized = q.toLowerCase();
  const [row] = await db
    .select()
    .from(user)
    .where(or(eq(user.email, normalized), eq(user.username, normalized)))
    .limit(1);
  return row ?? null;
}

export async function createChallenge(
  requester: SessionUser,
  target: string,
  log: { info: (o: unknown, msg?: string) => void },
): Promise<
  | { ok: true; challenge: ChallengeRecord; emailDelivery: string | null }
  | { ok: false; code: string; message: string }
> {
  const recipient = await lookupRecipient(target);
  if (!recipient) {
    return {
      ok: false,
      code: "not_found",
      message: "No player found with that username or email.",
    };
  }
  if (recipient.id === requester.id) {
    return {
      ok: false,
      code: "self",
      message: "You can't challenge yourself.",
    };
  }

  const online = isUserOnline(recipient.id);
  const ttl = online ? ONLINE_TTL_SEC : OFFLINE_TTL_SEC;
  const now = Date.now();
  const challenge: ChallengeRecord = {
    id: newChallengeId(),
    requesterId: requester.id,
    requesterUsername:
      requester.username ?? requester.name ?? "Racer",
    recipientId: recipient.id,
    recipientEmail: recipient.email,
    recipientUsername: recipient.username,
    status: "pending",
    delivery: online ? "online" : "offline",
    createdAt: now,
    expiresAt: now + ttl * 1000,
    sessionId: null,
  };

  await saveChallenge(challenge, ttl);

  pushToUser(recipient.id, "challenge", {
    type: "invite",
    challenge,
  });
  pushToUser(requester.id, "challenge", {
    type: "sent",
    challenge,
  });

  let emailDelivery: string | null = null;
  if (!online) {
    const allowed = await canSendInviteEmail(requester.id);
    if (!allowed) {
      emailDelivery = "rate_limited";
    } else {
      emailDelivery = await sendChallengeInviteEmail({
        to: recipient.email,
        fromUsername: challenge.requesterUsername,
        acceptPath: `${appOrigin}/challenge/${challenge.id}`,
        log,
      });
    }
  }

  scheduleExpiry(challenge.id, ttl);

  return { ok: true, challenge, emailDelivery };
}

const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleExpiry(id: string, ttlSec: number) {
  const prev = expiryTimers.get(id);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    void expireChallenge(id);
  }, ttlSec * 1000 + 50);
  expiryTimers.set(id, t);
}

async function expireChallenge(id: string) {
  const c = await getChallenge(id);
  if (!c || c.status !== "pending") return;
  c.status = "expired";
  await updateChallenge(c, 60);
  pushToUser(c.requesterId, "challenge", { type: "expired", challenge: c });
  pushToUser(c.recipientId, "challenge", { type: "expired", challenge: c });
}

export async function revokeChallenge(
  requesterId: string,
  challengeId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = await getChallenge(challengeId);
  if (!c || c.requesterId !== requesterId) {
    return { ok: false, message: "Challenge not found" };
  }
  if (c.status !== "pending") {
    return { ok: false, message: "Challenge is no longer pending" };
  }
  c.status = "revoked";
  await updateChallenge(c, 60);
  pushToUser(c.recipientId, "challenge", { type: "revoked", challenge: c });
  return { ok: true };
}

export async function respondChallenge(
  recipient: SessionUser,
  challengeId: string,
  accept: boolean,
): Promise<
  | { ok: true; challenge: ChallengeRecord; sessionId?: string }
  | { ok: false; message: string }
> {
  const c = await getChallenge(challengeId);
  if (!c || c.recipientId !== recipient.id) {
    return { ok: false, message: "Challenge not found" };
  }
  if (c.status !== "pending") {
    return { ok: false, message: "This invite has expired or was cancelled." };
  }
  if (Date.now() > c.expiresAt) {
    c.status = "expired";
    await updateChallenge(c, 60);
    return { ok: false, message: "This invite has expired." };
  }

  if (!accept) {
    c.status = "declined";
    await updateChallenge(c, 120);
    pushToUser(c.requesterId, "challenge", {
      type: "declined",
      challenge: c,
    });
    return { ok: true, challenge: c };
  }

  const session = await createChallengeSession({
    requesterId: c.requesterId,
    recipientId: c.recipientId,
  });
  c.status = "accepted";
  c.sessionId = session.id;
  await updateChallenge(c, 3600);

  pushToUser(c.requesterId, "challenge", {
    type: "accepted",
    challenge: c,
    sessionId: session.id,
  });
  pushToUser(c.recipientId, "challenge", {
    type: "accepted",
    challenge: c,
    sessionId: session.id,
  });

  return { ok: true, challenge: c, sessionId: session.id };
}

export async function getChallengeForUser(
  userId: string,
  challengeId: string,
) {
  const c = await getChallenge(challengeId);
  if (!c) return null;
  if (c.requesterId !== userId && c.recipientId !== userId) return null;
  return c;
}

export { listUserChallenges };
