import { env } from "../env.js";
import { getRedis } from "../redis.js";

const EMAIL_LIMIT_PER_HOUR = 5;

export async function canSendInviteEmail(senderId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    if (redis.status !== "ready") await redis.connect();
    const key = `challenge:email:${senderId}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3600);
    return n <= EMAIL_LIMIT_PER_HOUR;
  } catch {
    return true;
  }
}

/**
 * Offline challenge invites.
 * - No RESEND_API_KEY → log accept URL (local/dev, no signup required).
 * - With key → Resend free tier (https://resend.com).
 */
export async function sendChallengeInviteEmail(opts: {
  to: string;
  fromUsername: string;
  acceptPath: string;
  log: { info: (o: unknown, msg?: string) => void };
}): Promise<"sent" | "logged" | "rate_limited"> {
  if (!env.resendApiKey) {
    opts.log.info(
      { to: opts.to, acceptPath: opts.acceptPath },
      "Challenge invite (no RESEND_API_KEY) — accept URL logged",
    );
    return "logged";
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: opts.to,
      subject: `${opts.fromUsername} challenged you on ClackRace`,
      html: `<p><strong>${opts.fromUsername}</strong> challenged you to a typing race.</p>
<p><a href="${opts.acceptPath}">Accept the challenge</a></p>
<p>This invite expires soon.</p>`,
    }),
  });

  if (!res.ok) {
    opts.log.info(
      { status: res.status, to: opts.to, acceptPath: opts.acceptPath },
      "Resend failed — accept URL logged",
    );
    return "logged";
  }
  return "sent";
}
