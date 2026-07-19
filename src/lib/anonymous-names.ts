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

/** Client suggests; server confirms or reassigns — never duplicates in-session. */
export function assignUniqueName(
  suggested: string | undefined,
  taken: Set<string>,
): string {
  const pool = [...ANONYMOUS_NAMES];
  if (suggested && pool.includes(suggested as (typeof ANONYMOUS_NAMES)[number]) && !taken.has(suggested)) {
    return suggested;
  }
  const shuffled = pool.sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (!taken.has(name)) return name;
  }
  // Exhausted themed pool (8 max players, 15 names — shouldn't happen)
  let n = 2;
  while (taken.has(`Anonymous Racer ${n}`)) n++;
  return `Anonymous Racer ${n}`;
}
