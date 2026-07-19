/**
 * Palette for car bodies. Guests get a unique-in-session color from here.
 * Signed-in users keep their saved color even if it collides.
 */
export const CAR_COLOR_PALETTE = [
  "#2ee6d6", // cyan
  "#ff3d8a", // magenta
  "#f5c518", // signal yellow
  "#7c6cff", // violet
  "#ff7a45", // orange
  "#3dd68c", // green
  "#4da3ff", // sky
  "#e8e6e1", // chalk
  "#ff5c5c", // coral red
  "#a78bfa", // soft purple
  "#22d3ee", // bright teal
  "#f472b6", // pink
  "#84cc16", // lime
  "#fb923c", // amber orange
  "#38bdf8", // light blue
  "#e879f9", // fuchsia
  "#facc15", // gold
  "#34d399", // mint
  "#f87171", // rose
  "#60a5fa", // blue
  "#c084fc", // orchid
  "#2dd4bf", // seafoam
  "#fdba74", // peach
  "#a3e635", // chartreuse
  "#f43f5e", // crimson
  "#818cf8", // indigo
  "#14b8a6", // dark teal
  "#eab308", // mustard
  "#d946ef", // hot pink
  "#0ea5e9", // azure
  "#65a30d", // olive
  "#ea580c", // burnt orange
] as const;

/** Random palette color for new accounts (settings can change later). */
export function pickRandomCarColor(): string {
  return CAR_COLOR_PALETTE[
    Math.floor(Math.random() * CAR_COLOR_PALETTE.length)
  ]!;
}

export function pickGuestCarColor(taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toLowerCase()));
  const available = CAR_COLOR_PALETTE.filter(
    (c) => !used.has(c.toLowerCase()),
  );
  const pool = available.length > 0 ? available : [...CAR_COLOR_PALETTE];
  return pool[Math.floor(Math.random() * pool.length)]!;
}
