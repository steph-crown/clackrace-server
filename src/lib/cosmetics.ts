/** Cosmetic badge ids stored in user.avatar as JSON. */

export type CosmeticBadge = "streak-7" | "streak-30" | "streak-100" | "champion-crown";

export type CosmeticsPayload = {
  badges: CosmeticBadge[];
};

export const STREAK_MILESTONES = [7, 30, 100] as const;

export function parseCosmetics(raw: string | null | undefined): CosmeticsPayload {
  if (!raw) return { badges: [] };
  try {
    const parsed = JSON.parse(raw) as CosmeticsPayload;
    if (!parsed || !Array.isArray(parsed.badges)) return { badges: [] };
    return {
      badges: parsed.badges.filter((b): b is CosmeticBadge =>
        ["streak-7", "streak-30", "streak-100", "champion-crown"].includes(b),
      ),
    };
  } catch {
    return { badges: [] };
  }
}

export function serializeCosmetics(p: CosmeticsPayload): string {
  return JSON.stringify({ badges: [...new Set(p.badges)] });
}

export function badgesForStreak(streak: number): CosmeticBadge[] {
  const out: CosmeticBadge[] = [];
  if (streak >= 7) out.push("streak-7");
  if (streak >= 30) out.push("streak-30");
  if (streak >= 100) out.push("streak-100");
  return out;
}
