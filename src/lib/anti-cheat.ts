export type AntiCheatVerdict = {
  shadowHeld: boolean;
  flagReason: string | null;
};

const WPM_THRESHOLD = 220;
/** Near-zero inter-keystroke variance → likely macro. */
const MIN_INTERVALS_FOR_VARIANCE = 12;
const VARIANCE_FLOOR_MS2 = 4;

/**
 * Flag suspicious runs for shadow-hold (hidden from public boards).
 * Does not block persistence of the race itself.
 */
export function evaluateAntiCheat(
  wpm: number,
  keystrokes: { charIndex: number; timestampMs: number }[],
): AntiCheatVerdict {
  if (wpm >= WPM_THRESHOLD) {
    return { shadowHeld: true, flagReason: "wpm_threshold" };
  }

  if (keystrokes.length >= MIN_INTERVALS_FOR_VARIANCE + 1) {
    const intervals: number[] = [];
    for (let i = 1; i < keystrokes.length; i++) {
      const dt =
        keystrokes[i]!.timestampMs - keystrokes[i - 1]!.timestampMs;
      if (dt > 0 && dt < 2000) intervals.push(dt);
    }
    if (intervals.length >= MIN_INTERVALS_FOR_VARIANCE) {
      const mean =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance =
        intervals.reduce((a, b) => a + (b - mean) ** 2, 0) /
        intervals.length;
      if (variance < VARIANCE_FLOOR_MS2 && mean < 120) {
        return { shadowHeld: true, flagReason: "timing_variance" };
      }
    }
  }

  return { shadowHeld: false, flagReason: null };
}

/** Keep keystroke logs for leaderboard, flagged, PB, or claimable guest runs. */
export function shouldRetainKeystrokes(opts: {
  shadowHeld: boolean;
  leaderboardEligible: boolean;
  isPersonalBest: boolean;
  /** Guest finish with a session token — needed so claim can rebuild PB/ghost. */
  claimableGuest?: boolean;
}): boolean {
  return (
    opts.shadowHeld ||
    opts.leaderboardEligible ||
    opts.isPersonalBest ||
    !!opts.claimableGuest
  );
}
