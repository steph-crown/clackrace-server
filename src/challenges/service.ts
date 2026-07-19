import { eq, or } from "drizzle-orm";
import type { SessionUser } from "../auth/index.js";
import { db } from "../db/client.js";
import { user } from "../db/schema.js";
import { env } from "../env.js";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

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
  const trimmed = target.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "invalid_target",
      message: "Enter a username or email.",
    };
  }

  const recipient = await lookupRecipient(trimmed);

  if (!recipient) {
    if (!isEmail(trimmed)) {
      return {
        ok: false,
        code: "not_found",
        message: "No player found with that username.",
      };
    }
    // PRD §6.4.7 — no account yet: email invite to sign up into this challenge
    return inviteNewEmail(requester, trimmed.toLowerCase(), log);
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
    requesterUsername: requester.username ?? requester.name ?? "Racer",
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

  pushToUser(recipient.id, "challenge", { type: "invite", challenge });
  pushToUser(requester.id, "challenge", { type: "sent", challenge });

  let emailDelivery: string | null = null;
  if (!online) {
    emailDelivery = await deliverInviteEmail(
      requester.id,
      recipient.email,
      challenge,
      log,
      "race",
    );
  }

  scheduleExpiry(challenge.id, ttl);
  return { ok: true, challenge, emailDelivery };
}

async function inviteNewEmail(
  requester: SessionUser,
  email: string,
  log: { info: (o: unknown, msg?: string) => void },
): Promise<
  | { ok: true; challenge: ChallengeRecord; emailDelivery: string | null }
  | { ok: false; code: string; message: string }
> {
  if (requester.email.toLowerCase() === email) {
    return {
      ok: false,
      code: "self",
      message: "You can't challenge yourself.",
    };
  }

  const ttl = OFFLINE_TTL_SEC;
  const now = Date.now();
  const challenge: ChallengeRecord = {
    id: newChallengeId(),
    requesterId: requester.id,
    requesterUsername: requester.username ?? requester.name ?? "Racer",
    recipientId: null,
    recipientEmail: email,
    recipientUsername: null,
    status: "pending",
    delivery: "offline",
    createdAt: now,
    expiresAt: now + ttl * 1000,
    sessionId: null,
  };

  await saveChallenge(challenge, ttl);
  pushToUser(requester.id, "challenge", { type: "sent", challenge });

  const emailDelivery = await deliverInviteEmail(
    requester.id,
    email,
    challenge,
    log,
    "signup",
  );

  if (emailDelivery === "rate_limited") {
    return {
      ok: false,
      code: "rate_limited",
      message: "Too many invites sent. Try again later.",
    };
  }

  scheduleExpiry(challenge.id, ttl);
  return { ok: true, challenge, emailDelivery };
}

async function deliverInviteEmail(
  senderId: string,
  to: string,
  challenge: ChallengeRecord,
  log: { info: (o: unknown, msg?: string) => void },
  kind: "race" | "signup",
): Promise<string | null> {
  const allowed = await canSendInviteEmail(senderId);
  if (!allowed) return "rate_limited";
  return sendChallengeInviteEmail({
    to,
    fromUsername: challenge.requesterUsername,
    acceptPath: `${env.appUrl}/challenge/${challenge.id}`,
    kind,
    log,
  });
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
  if (c.recipientId) {
    pushToUser(c.recipientId, "challenge", { type: "expired", challenge: c });
  }
}

export async function revokeChallenge(
  requesterId: string,
  challengeId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const c = await getChallenge(challengeId);
  if (!c || c.requesterId !== requesterId) {
    return {
      ok: false,
      code: "not_found",
      message: "Challenge not found.",
    };
  }
  if (c.status !== "pending") {
    return {
      ok: false,
      code: "not_pending",
      message: "This challenge is no longer pending.",
    };
  }
  c.status = "revoked";
  await updateChallenge(c, 60);
  if (c.recipientId) {
    pushToUser(c.recipientId, "challenge", { type: "revoked", challenge: c });
  }
  return { ok: true };
}

export async function respondChallenge(
  recipient: SessionUser,
  challengeId: string,
  accept: boolean,
): Promise<
  | { ok: true; challenge: ChallengeRecord; sessionId?: string }
  | { ok: false; code: string; message: string }
> {
  const c = await getChallenge(challengeId);
  if (!c) {
    return {
      ok: false,
      code: "not_found",
      message: "Challenge not found.",
    };
  }

  const isRecipient =
    c.recipientId === recipient.id ||
    (!c.recipientId &&
      c.recipientEmail.toLowerCase() === recipient.email.toLowerCase());

  if (!isRecipient) {
    return {
      ok: false,
      code: "forbidden",
      message: "This invite isn't for you.",
    };
  }

  // Claim email invite onto this account
  if (!c.recipientId) {
    c.recipientId = recipient.id;
    c.recipientUsername = recipient.username ?? null;
  }

  const recipientId = c.recipientId;
  if (!recipientId) {
    return {
      ok: false,
      code: "forbidden",
      message: "This invite isn't for you.",
    };
  }

  if (c.status !== "pending") {
    return {
      ok: false,
      code: "not_pending",
      message: "This invite has expired or was cancelled.",
    };
  }
  if (Date.now() > c.expiresAt) {
    c.status = "expired";
    await updateChallenge(c, 60);
    return {
      ok: false,
      code: "expired",
      message: "This invite has expired.",
    };
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
    recipientId,
  });
  c.status = "accepted";
  c.sessionId = session.id;
  await updateChallenge(c, 3600);

  pushToUser(c.requesterId, "challenge", {
    type: "accepted",
    challenge: c,
    sessionId: session.id,
  });
  pushToUser(recipientId, "challenge", {
    type: "accepted",
    challenge: c,
    sessionId: session.id,
  });

  return { ok: true, challenge: c, sessionId: session.id };
}

export async function getChallengeForUser(
  user: SessionUser,
  challengeId: string,
) {
  const c = await getChallenge(challengeId);
  if (!c) return null;
  if (c.requesterId === user.id) return c;
  if (c.recipientId === user.id) return c;
  if (
    !c.recipientId &&
    c.recipientEmail.toLowerCase() === user.email.toLowerCase()
  ) {
    return c;
  }
  return null;
}

export async function listChallengesForSessionUser(u: SessionUser) {
  return listUserChallenges(u.id, u.email);
}
