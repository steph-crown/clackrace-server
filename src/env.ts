import "dotenv/config";

/**
 * Central env access — import from here instead of scattering process.env.
 * Keep `.env.example` in sync when adding keys.
 */

function splitOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const isProd = process.env.NODE_ENV === "production";

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (isProd) {
    throw new Error("BETTER_AUTH_SECRET is required in production");
  }
  return "dev-only-clackrace-auth-secret-change-me";
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL,
  /** App origin(s) allowed for CORS / trusted cookies */
  corsOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...splitOrigins(process.env.CORS_ORIGIN),
  ],
  /**
   * Public Next origin (auth cookies stay first-party via proxy).
   * Prefer BETTER_AUTH_URL; AUTH_URL is an accepted alias.
   */
  appUrl:
    process.env.BETTER_AUTH_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000",
  betterAuthSecret: authSecret(),
  /** Optional — challenge invite emails via Resend free tier */
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? "ClackRace <onboarding@resend.dev>",
} as const;

