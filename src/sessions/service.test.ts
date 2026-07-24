import { describe, expect, it } from "vitest";
import {
  joinSession,
  leaveSession,
  maxPlayersFor,
  MAX_MATCHMADE_PLAYERS,
  MAX_SESSION_PLAYERS,
  recordFinish,
  updatePosition,
} from "./service.js";
import type { LiveSession } from "./types.js";

function makeSession(
  overrides: Partial<LiveSession> &
    Pick<LiveSession, "visibility" | "status">,
): LiveSession {
  return {
    id: "ABC123",
    creatorGuestToken: "creator-token-xxxxxxxx",
    creatorUserId: null,
    allowedUserIds: null,
    members: [],
    race: null,
    leaderboard: [],
    rematch: null,
    commit: null,
    reservedSeats: 0,
    tickTimer: null,
    deadlineTimer: null,
    graceTimer: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("maxPlayersFor", () => {
  it("caps Open Race at 8 and Quick Race at 6", () => {
    expect(
      maxPlayersFor(makeSession({ visibility: "public", status: "waiting" })),
    ).toBe(MAX_SESSION_PLAYERS);
    expect(
      maxPlayersFor(
        makeSession({ visibility: "matchmade", status: "waiting" }),
      ),
    ).toBe(MAX_MATCHMADE_PLAYERS);
  });
});

describe("joinSession", () => {
  it("lets guests join an open waiting session as creator", () => {
    const session = makeSession({ visibility: "public", status: "waiting" });
    const result = joinSession(session, {
      guestSessionToken: "creator-token-xxxxxxxx",
      suggestedName: "Anonymous Turbo",
      socketId: "sock-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member.isCreator).toBe(true);
    expect(result.member.displayName).toBe("Anonymous Turbo");
  });

  it("rejects challenge joins without auth / ACL", () => {
    const session = makeSession({
      visibility: "challenge",
      status: "waiting",
      allowedUserIds: ["user-a", "user-b"],
    });
    expect(
      joinSession(session, {
        guestSessionToken: "guest-xxxxxxxx",
        socketId: "s1",
      }).ok,
    ).toBe(false);
    expect(
      joinSession(session, {
        guestSessionToken: "guest-xxxxxxxx",
        userId: "user-c",
        displayUsername: "eve",
        socketId: "s1",
        lockedCarColor: true,
        carColor: "#2ee6d6",
      }).code,
    ).toBe("forbidden");
  });

  it("allows challenge participants on the ACL", () => {
    const session = makeSession({
      visibility: "challenge",
      status: "waiting",
      allowedUserIds: ["user-a", "user-b"],
      creatorUserId: "user-a",
      creatorGuestToken: "",
    });
    const result = joinSession(session, {
      guestSessionToken: "guest-a-xxxxxxxx",
      userId: "user-a",
      displayUsername: "alice",
      socketId: "s1",
      lockedCarColor: true,
      carColor: "#2ee6d6",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects matchmade joins while racing", () => {
    const session = makeSession({
      visibility: "matchmade",
      status: "racing",
      race: {
        id: "r1",
        passageId: "p1",
        passageText: "hello",
        startedAtMs: Date.now(),
        progress: {},
        finishes: [],
      },
    });
    const result = joinSession(session, {
      guestSessionToken: "guest-xxxxxxxx",
      socketId: "s1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("racing");
  });

  it("marks open mid-race joiners as pending", () => {
    const session = makeSession({ visibility: "public", status: "waiting" });
    const host = joinSession(session, {
      guestSessionToken: "creator-token-xxxxxxxx",
      socketId: "s0",
    });
    expect(host.ok).toBe(true);
    session.status = "racing";
    session.race = {
      id: "r1",
      passageId: "p1",
      passageText: "hello",
      startedAtMs: Date.now(),
      progress: {},
      finishes: [],
    };
    const result = joinSession(session, {
      guestSessionToken: "joiner-token-xxxxxxxx",
      socketId: "s1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member.pending).toBe(true);
    expect(result.promotedPending).toBe(true);
  });

  it("rejects when full", () => {
    const session = makeSession({ visibility: "public", status: "waiting" });
    for (let i = 0; i < MAX_SESSION_PLAYERS; i++) {
      const r = joinSession(session, {
        guestSessionToken: `guest-token-${i}-xxxxxxxx`,
        socketId: `s${i}`,
      });
      expect(r.ok).toBe(true);
    }
    const full = joinSession(session, {
      guestSessionToken: "overflow-token-xxxxxxxx",
      socketId: "sx",
    });
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.code).toBe("full");
  });

  it("rejoins update socket id without duplicating", () => {
    const session = makeSession({ visibility: "public", status: "waiting" });
    const first = joinSession(session, {
      guestSessionToken: "guest-token-xxxxxxxx",
      socketId: "s1",
    });
    expect(first.ok).toBe(true);
    const second = joinSession(session, {
      guestSessionToken: "guest-token-xxxxxxxx",
      socketId: "s2",
    });
    expect(second.ok).toBe(true);
    expect(session.members.filter((m) => !m.disconnected)).toHaveLength(1);
    if (!second.ok) return;
    expect(second.member.socketId).toBe("s2");
  });
});

describe("leaveSession / race progress", () => {
  it("blocks leave while racing", () => {
    const session = makeSession({ visibility: "public", status: "racing" });
    const joined = joinSession(session, {
      guestSessionToken: "guest-token-xxxxxxxx",
      socketId: "s1",
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    session.status = "racing";
    expect(leaveSession(session, joined.member.id).ok).toBe(false);
  });

  it("updatePosition is monotonic and clamped", () => {
    const session = makeSession({
      visibility: "public",
      status: "racing",
      race: {
        id: "r1",
        passageId: "p1",
        passageText: "abcd",
        startedAtMs: Date.now(),
        progress: {
          m1: { correctIndex: 1, finishedAtMs: null, disconnected: false },
        },
        finishes: [],
      },
    });
    updatePosition(session, "m1", 3);
    expect(session.race!.progress.m1!.correctIndex).toBe(3);
    updatePosition(session, "m1", 2);
    expect(session.race!.progress.m1!.correctIndex).toBe(3);
    updatePosition(session, "m1", 99);
    expect(session.race!.progress.m1!.correctIndex).toBe(4);
  });

  it("recordFinish uses server WPM and marks allDone", () => {
    const passage = "hello"; // 5 chars → 1 word
    const session = makeSession({
      visibility: "public",
      status: "racing",
      members: [
        {
          id: "m1",
          displayName: "You",
          carColor: "#2ee6d6",
          guestSessionToken: "g",
          userId: null,
          username: null,
          rating: null,
          socketId: "s1",
          isCreator: true,
          pending: false,
          disconnected: false,
        },
      ],
      race: {
        id: "r1",
        passageId: "p1",
        passageText: passage,
        startedAtMs: Date.now() - 60_000,
        progress: {
          m1: { correctIndex: 0, finishedAtMs: null, disconnected: false },
        },
        finishes: [],
      },
    });
    const strokes = Array.from({ length: 5 }, (_, i) => ({
      charIndex: i,
      timestampMs: 60_000,
    }));
    const finish = recordFinish(session, {
      memberId: "m1",
      mistakes: 0,
      keystrokes: strokes,
      durationMs: 60_000,
    });
    expect(finish).not.toBeNull();
    expect(finish!.wpm).toBeCloseTo(1, 5);
    expect(finish!.accuracy).toBe(100);
    expect(finish!.allDone).toBe(true);
  });
});
