import { describe, expect, it } from "vitest";
import { takeRequeueSlot } from "./requeue.js";

describe("takeRequeueSlot", () => {
  it("allows one requeue per guest token", () => {
    const token = `guest-requeue-${Math.random().toString(36).slice(2)}`;
    expect(takeRequeueSlot(token)).toBe(true);
    expect(takeRequeueSlot(token)).toBe(false);
  });
});
