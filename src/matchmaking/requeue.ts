/** Track one-shot commit-abort requeues per guest token (PRD §6.3.1). */

const requeuedOnce = new Map<string, number>();
const TTL_MS = 10 * 60_000;

export function takeRequeueSlot(guestSessionToken: string): boolean {
  const now = Date.now();
  // Opportunistic cleanup
  for (const [k, exp] of requeuedOnce) {
    if (exp < now) requeuedOnce.delete(k);
  }
  if (requeuedOnce.has(guestSessionToken)) return false;
  requeuedOnce.set(guestSessionToken, now + TTL_MS);
  return true;
}
