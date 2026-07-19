import { Redis } from "ioredis";

let redis: Redis | null = null;

/** Redis is optional at boot for Phase 3 — live session state arrives in Phase 4. */
export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function pingRedis(): Promise<"ok" | "skipped" | "down"> {
  const client = getRedis();
  if (!client) return "skipped";
  try {
    if (client.status !== "ready") await client.connect();
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : "down";
  } catch {
    return "down";
  }
}
