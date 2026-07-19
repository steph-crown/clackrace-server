import { randomUUID } from "node:crypto";
import { getRedis } from "../redis.js";

export type ChallengeStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

export type ChallengeRecord = {
  id: string;
  requesterId: string;
  requesterUsername: string;
  /** Null until an email invitee creates an account and opens the invite. */
  recipientId: string | null;
  recipientEmail: string;
  recipientUsername: string | null;
  status: ChallengeStatus;
  delivery: "online" | "offline";
  createdAt: number;
  expiresAt: number;
  sessionId: string | null;
};

const memory = new Map<string, ChallengeRecord>();

function key(id: string) {
  return `challenge:${id}`;
}

function userPendingKey(userId: string) {
  return `challenge:user:${userId}`;
}

function emailPendingKey(email: string) {
  return `challenge:email:${email.toLowerCase()}`;
}

async function redis() {
  const r = getRedis();
  if (!r) return null;
  try {
    if (r.status !== "ready") await r.connect();
    return r;
  } catch {
    return null;
  }
}

export async function saveChallenge(
  record: ChallengeRecord,
  ttlSec: number,
): Promise<void> {
  memory.set(record.id, record);
  const r = await redis();
  if (!r) return;
  await r.set(key(record.id), JSON.stringify(record), "EX", ttlSec);
  if (record.recipientId) {
    await r.sadd(userPendingKey(record.recipientId), record.id);
    await r.expire(userPendingKey(record.recipientId), ttlSec);
  } else {
    await r.sadd(emailPendingKey(record.recipientEmail), record.id);
    await r.expire(emailPendingKey(record.recipientEmail), ttlSec);
  }
  await r.sadd(userPendingKey(record.requesterId), record.id);
  await r.expire(userPendingKey(record.requesterId), ttlSec);
}

export async function getChallenge(
  id: string,
): Promise<ChallengeRecord | null> {
  const r = await redis();
  if (r) {
    const raw = await r.get(key(id));
    if (raw) {
      const parsed = JSON.parse(raw) as ChallengeRecord;
      memory.set(id, parsed);
      return parsed;
    }
  }
  return memory.get(id) ?? null;
}

export async function updateChallenge(
  record: ChallengeRecord,
  ttlSec: number,
): Promise<void> {
  await saveChallenge(record, ttlSec);
}

export async function listUserChallenges(
  userId: string,
  email?: string | null,
): Promise<ChallengeRecord[]> {
  const r = await redis();
  const ids = new Set<string>();
  if (r) {
    for (const id of await r.smembers(userPendingKey(userId))) ids.add(id);
    if (email) {
      for (const id of await r.smembers(emailPendingKey(email))) ids.add(id);
    }
  }
  for (const c of memory.values()) {
    if (
      c.requesterId === userId ||
      c.recipientId === userId ||
      (email &&
        !c.recipientId &&
        c.recipientEmail.toLowerCase() === email.toLowerCase())
    ) {
      ids.add(c.id);
    }
  }
  const out: ChallengeRecord[] = [];
  for (const id of ids) {
    const c = await getChallenge(id);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function newChallengeId() {
  return randomUUID();
}

export const ONLINE_TTL_SEC = 60;
export const OFFLINE_TTL_SEC = 15 * 60;
