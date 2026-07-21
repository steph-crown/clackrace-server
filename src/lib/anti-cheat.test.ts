import { describe, expect, it } from "vitest";
import {
  evaluateAntiCheat,
  shouldRetainKeystrokes,
} from "./anti-cheat.js";

function evenStrokes(n: number, intervalMs: number) {
  return Array.from({ length: n }, (_, i) => ({
    charIndex: i,
    timestampMs: i * intervalMs,
  }));
}

describe("evaluateAntiCheat", () => {
  it("flags absurd WPM", () => {
    const v = evaluateAntiCheat(220, evenStrokes(20, 80));
    expect(v.shadowHeld).toBe(true);
    expect(v.flagReason).toBe("wpm_threshold");
  });

  it("allows normal human WPM with varied timing", () => {
    const strokes = Array.from({ length: 20 }, (_, i) => ({
      charIndex: i,
      timestampMs: i * 100 + (i % 3) * 17,
    }));
    const v = evaluateAntiCheat(80, strokes);
    expect(v.shadowHeld).toBe(false);
    expect(v.flagReason).toBeNull();
  });

  it("flags near-zero variance macros", () => {
    const v = evaluateAntiCheat(100, evenStrokes(20, 50));
    expect(v.shadowHeld).toBe(true);
    expect(v.flagReason).toBe("timing_variance");
  });

  it("skips variance check on short logs", () => {
    const v = evaluateAntiCheat(100, evenStrokes(5, 50));
    expect(v.shadowHeld).toBe(false);
  });
});

describe("shouldRetainKeystrokes", () => {
  it("retains shadow, leaderboard, PB, or claimable guest runs", () => {
    expect(
      shouldRetainKeystrokes({
        shadowHeld: true,
        leaderboardEligible: false,
        isPersonalBest: false,
      }),
    ).toBe(true);
    expect(
      shouldRetainKeystrokes({
        shadowHeld: false,
        leaderboardEligible: true,
        isPersonalBest: false,
      }),
    ).toBe(true);
    expect(
      shouldRetainKeystrokes({
        shadowHeld: false,
        leaderboardEligible: false,
        isPersonalBest: true,
      }),
    ).toBe(true);
    expect(
      shouldRetainKeystrokes({
        shadowHeld: false,
        leaderboardEligible: false,
        isPersonalBest: false,
        claimableGuest: true,
      }),
    ).toBe(true);
    expect(
      shouldRetainKeystrokes({
        shadowHeld: false,
        leaderboardEligible: false,
        isPersonalBest: false,
      }),
    ).toBe(false);
  });
});
