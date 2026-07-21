import { describe, expect, it } from "vitest";
import { accuracyFromMistakes, wpmFromKeystrokes } from "./stats.js";

describe("wpmFromKeystrokes", () => {
  it("returns 0 for empty keystrokes or invalid passage", () => {
    expect(wpmFromKeystrokes([], 100)).toBe(0);
    expect(
      wpmFromKeystrokes([{ charIndex: 0, timestampMs: 1000 }], 0),
    ).toBe(0);
  });

  it("returns 0 when duration is 0", () => {
    expect(
      wpmFromKeystrokes([{ charIndex: 0, timestampMs: 0 }], 10),
    ).toBe(0);
  });

  it("computes classic WPM (chars/5 per minute)", () => {
    // 50 correct chars in 60s → 10 WPM
    const strokes = Array.from({ length: 50 }, (_, i) => ({
      charIndex: i,
      timestampMs: 60_000,
    }));
    expect(wpmFromKeystrokes(strokes, 50)).toBeCloseTo(10, 5);
  });

  it("caps correct chars to passage length", () => {
    const strokes = Array.from({ length: 20 }, (_, i) => ({
      charIndex: i,
      timestampMs: 60_000,
    }));
    expect(wpmFromKeystrokes(strokes, 10)).toBeCloseTo(2, 5);
  });
});

describe("accuracyFromMistakes", () => {
  it("returns 100 when no attempts", () => {
    expect(accuracyFromMistakes(0, 0)).toBe(100);
  });

  it("computes correct / attempts", () => {
    expect(accuracyFromMistakes(9, 1)).toBeCloseTo(90, 5);
  });
});
