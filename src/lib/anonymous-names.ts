export const ANONYMOUS_NAMES = [
  "Anonymous Racer",
  "Anonymous Nitro",
  "Anonymous Drifter",
  "Anonymous Turbo",
  "Anonymous Rookie",
  "Anonymous Ghost",
  "Anonymous Speedster",
  "Anonymous Throttle",
  "Anonymous Ace",
  "Anonymous Pitstop",
  "Anonymous Ridge",
  "Anonymous Ember",
  "Anonymous Blitz",
  "Anonymous Comet",
  "Anonymous Rally",
] as const;

function uniquify(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Guests: themed Anonymous pool (client suggests, server confirms).
 * Signed-in: real username, uniquified only if a collision exists in-session.
 */
export function assignDisplayName(
  opts: {
    signedInUsername?: string | null;
    suggestedGuestName?: string | null;
  },
  taken: Set<string>,
): string {
  const signed = opts.signedInUsername?.trim();
  if (signed) return uniquify(signed, taken);
  return assignUniqueAnonymous(opts.suggestedGuestName ?? undefined, taken);
}

/** Client suggests; server confirms or reassigns — never duplicates in-session. */
export function assignUniqueName(
  suggested: string | undefined,
  taken: Set<string>,
): string {
  return assignUniqueAnonymous(suggested, taken);
}

function assignUniqueAnonymous(
  suggested: string | undefined,
  taken: Set<string>,
): string {
  const pool = [...ANONYMOUS_NAMES];
  if (
    suggested &&
    pool.includes(suggested as (typeof ANONYMOUS_NAMES)[number]) &&
    !taken.has(suggested)
  ) {
    return suggested;
  }
  const shuffled = pool.sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (!taken.has(name)) return name;
  }
  let n = 2;
  while (taken.has(`Anonymous Racer ${n}`)) n++;
  return `Anonymous Racer ${n}`;
}
