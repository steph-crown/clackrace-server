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
  kind: "race" | "signup";
  log: { info: (o: unknown, msg?: string) => void };
}): Promise<"sent" | "logged" | "rate_limited"> {
  const subject =
    opts.kind === "signup"
      ? `${opts.fromUsername} invited you to race on ClackRace`
      : `${opts.fromUsername} challenged you on ClackRace`;

  const reportBlock = `<p style="margin-top:24px;font-size:12px;color:#666">Didn't expect this? <a href="mailto:hello@clackrace.com?subject=${encodeURIComponent(`Report challenge from ${opts.fromUsername}`)}&body=${encodeURIComponent(`Please review or block invites from ${opts.fromUsername}.\n\nRecipient: ${opts.to}`)}">Report or block</a> this sender.</p>`;

  const html =
    opts.kind === "signup"
      ? `<p><strong>${opts.fromUsername}</strong> challenged you to a typing race on ClackRace.</p>
<p>Create a free account to accept — you'll land right in the challenge.</p>
<p><a href="${opts.acceptPath}">Sign up &amp; accept</a></p>
<p>This invite expires soon.</p>
${reportBlock}`
      : `<p><strong>${opts.fromUsername}</strong> challenged you to a typing race.</p>
<p><a href="${opts.acceptPath}">Accept the challenge</a></p>
<p>This invite expires soon.</p>
${reportBlock}`;

  if (!env.resendApiKey) {
    opts.log.info(
      { to: opts.to, acceptPath: opts.acceptPath, kind: opts.kind },
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
      subject,
      html,
    }),
  });

  if (!res.ok) {
    opts.log.info(
      {
        status: res.status,
        to: opts.to,
        acceptPath: opts.acceptPath,
        kind: opts.kind,
      },
      "Resend failed — accept URL logged",
    );
    return "logged";
  }
  return "sent";
}
