import { describe, expect, it } from "vitest";
import {
  GRACE_AFTER_PENULTIMATE_MS,
  hardCapMsForPassage,
} from "./timeouts.js";

describe("hardCapMsForPassage", () => {
  it("enforces a 90s minimum", () => {
    expect(hardCapMsForPassage("hi")).toBeGreaterThanOrEqual(90_000);
  });

  it("grows with longer passages", () => {
    const short = hardCapMsForPassage("a".repeat(50));
    const long = hardCapMsForPassage("a".repeat(500));
    expect(long).toBeGreaterThan(short);
  });
});

describe("grace constant", () => {
  it("is 45 seconds per PRD", () => {
    expect(GRACE_AFTER_PENULTIMATE_MS).toBe(45_000);
  });
});
