import { describe, expect, it } from "vitest";
import {
  CAR_COLOR_PALETTE,
  pickGuestCarColor,
  pickRandomCarColor,
} from "./car-colors.js";

describe("car colors", () => {
  it("pickRandomCarColor stays in palette", () => {
    for (let i = 0; i < 20; i++) {
      expect(CAR_COLOR_PALETTE).toContain(pickRandomCarColor());
    }
  });

  it("avoids taken colors (case-insensitive)", () => {
    const taken = [CAR_COLOR_PALETTE[0]!.toUpperCase()];
    const color = pickGuestCarColor(taken);
    expect(color.toLowerCase()).not.toBe(taken[0]!.toLowerCase());
  });

  it("still returns a palette color when all taken", () => {
    const color = pickGuestCarColor(CAR_COLOR_PALETTE);
    expect(CAR_COLOR_PALETTE).toContain(color);
  });
});
