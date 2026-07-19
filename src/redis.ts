import { Redis } from "ioredis";
import { env } from "./env.js";

let redis: Redis | null = null;

/** Redis is optional at boot — challenge TTL / email rate limits use it when present. */
export function getRedis(): Redis | null {
  const url = env.redisUrl;
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
