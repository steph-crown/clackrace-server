import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_NAMES,
  assignDisplayName,
  assignUniqueName,
} from "./anonymous-names.js";

describe("assignUniqueName / assignDisplayName", () => {
  it("accepts a free suggested guest name from the pool", () => {
    const name = assignUniqueName("Anonymous Turbo", new Set());
    expect(name).toBe("Anonymous Turbo");
  });

  it("reassigns when suggested is taken", () => {
    const taken = new Set<string>(["Anonymous Turbo"]);
    const name = assignUniqueName("Anonymous Turbo", taken);
    expect(name).not.toBe("Anonymous Turbo");
    expect(ANONYMOUS_NAMES.includes(name as (typeof ANONYMOUS_NAMES)[number]) || name.startsWith("Anonymous Racer")).toBe(true);
  });

  it("uniquifies signed-in usernames on collision", () => {
    const taken = new Set(["alice"]);
    expect(
      assignDisplayName({ signedInUsername: "alice" }, taken),
    ).toBe("alice 2");
  });

  it("keeps signed-in username when free", () => {
    expect(
      assignDisplayName({ signedInUsername: "bob" }, new Set()),
    ).toBe("bob");
  });

  it("falls back to Anonymous Racer N when pool exhausted", () => {
    const taken = new Set<string>(ANONYMOUS_NAMES);
    const name = assignUniqueName(undefined, taken);
    expect(name).toMatch(/^Anonymous Racer \d+$/);
  });
});
