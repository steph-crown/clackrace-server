import { describe, expect, it } from "vitest";
import {
  badgesForStreak,
  parseCosmetics,
  serializeCosmetics,
} from "./cosmetics.js";

describe("cosmetics", () => {
  it("parses empty / invalid safely", () => {
    expect(parseCosmetics(null).badges).toEqual([]);
    expect(parseCosmetics("not-json").badges).toEqual([]);
    expect(parseCosmetics("{}").badges).toEqual([]);
  });

  it("filters unknown badges; serialize dedupes", () => {
    const parsed = parseCosmetics(
      JSON.stringify({ badges: ["streak-7", "nope", "streak-7"] }),
    );
    expect(parsed.badges).toEqual(["streak-7", "streak-7"]);
    expect(serializeCosmetics({ badges: ["streak-7", "streak-7"] })).toBe(
      JSON.stringify({ badges: ["streak-7"] }),
    );
  });

  it("unlocks streak milestones", () => {
    expect(badgesForStreak(6)).toEqual([]);
    expect(badgesForStreak(7)).toEqual(["streak-7"]);
    expect(badgesForStreak(30)).toEqual(["streak-7", "streak-30"]);
    expect(badgesForStreak(100)).toEqual([
      "streak-7",
      "streak-30",
      "streak-100",
    ]);
  });
});
