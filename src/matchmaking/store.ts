import { randomUUID } from "node:crypto";
import { getRedis } from "../redis.js";

export const SEARCH_TIMEOUT_MS = 60_000;
export const COMMIT_MS = 10_000;

export type QueueTicket = {
  id: string;
  guestSessionToken: string;
  userId: string | null;
  enqueuedAt: number;
  requeued: boolean;
  /** Set when assigned */
  sessionId: string | null;
};

const memoryQueue = new Map<string, QueueTicket>();
/** sessionId → open for fill */
const openSessions = new Set<string>();

const QUEUE_KEY = "mm:queue";
const PLAYER_PREFIX = "mm:player:";
const OPEN_KEY = "mm:open_sessions";

export function newTicketId() {
  return randomUUID();
}

export async function enqueueTicket(
  ticket: QueueTicket,
): Promise<void> {
  memoryQueue.set(ticket.id, ticket);
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.zadd(QUEUE_KEY, ticket.enqueuedAt, ticket.id);
    await redis.set(
      `${PLAYER_PREFIX}${ticket.id}`,
      JSON.stringify(ticket),
      "PX",
      SEARCH_TIMEOUT_MS + 5_000,
    );
  } catch {
    /* memory fallback */
  }
}

export async function getTicket(id: string): Promise<QueueTicket | null> {
  const mem = memoryQueue.get(id);
  if (mem) return mem;
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status !== "ready") await redis.connect();
    const raw = await redis.get(`${PLAYER_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw) as QueueTicket;
  } catch {
    return null;
  }
}

export async function removeTicket(id: string): Promise<void> {
  memoryQueue.delete(id);
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.zrem(QUEUE_KEY, id);
    await redis.del(`${PLAYER_PREFIX}${id}`);
  } catch {
    /* ignore */
  }
}

export async function listQueuedOldest(): Promise<QueueTicket[]> {
  return [...memoryQueue.values()]
    .filter((t) => !t.sessionId)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

export async function markAssigned(
  ticketId: string,
  sessionId: string,
): Promise<void> {
  const t = await getTicket(ticketId);
  if (!t) return;
  t.sessionId = sessionId;
  memoryQueue.set(ticketId, t);
  const redis = getRedis();
  if (redis) {
    try {
      if (redis.status !== "ready") await redis.connect();
      await redis.zrem(QUEUE_KEY, ticketId);
      await redis.set(
        `${PLAYER_PREFIX}${ticketId}`,
        JSON.stringify(t),
        "PX",
        30_000,
      );
    } catch {
      /* ignore */
    }
  }
  // Drop from searching queue view after a short grace for client poll
  setTimeout(() => {
    void removeTicket(ticketId);
  }, 30_000);
}

export function markSessionOpen(sessionId: string) {
  openSessions.add(sessionId);
  void (async () => {
    const redis = getRedis();
    if (!redis) return;
    try {
      if (redis.status !== "ready") await redis.connect();
      await redis.sadd(OPEN_KEY, sessionId);
    } catch {
      /* ignore */
    }
  })();
}

export function markSessionClosed(sessionId: string) {
  openSessions.delete(sessionId);
  void (async () => {
    const redis = getRedis();
    if (!redis) return;
    try {
      if (redis.status !== "ready") await redis.connect();
      await redis.srem(OPEN_KEY, sessionId);
    } catch {
      /* ignore */
    }
  })();
}

export function listOpenSessionIds(): string[] {
  return [...openSessions];
}
