import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  keystrokeLogs,
  passages,
  raceParticipants,
  raceSessions,
  races,
} from "../db/schema.js";
import { assignUniqueName } from "../lib/anonymous-names.js";
import { pickGuestCarColor } from "../lib/car-colors.js";
import {
  accuracyFromMistakes,
  wpmFromKeystrokes,
} from "../lib/stats.js";
import { generateSessionCode, getLiveSession, setLiveSession } from "./store.js";
import { clearRaceTimers } from "./timeouts.js";
import type {
  LiveMember,
  LiveSession,
  PublicMember,
  SessionLeaderboardEntry,
  SessionSnapshot,
} from "./types.js";

export const MAX_SESSION_PLAYERS = 8;

export async function createPublicSession(guestSessionToken: string) {
  const id = generateSessionCode();
  await db.insert(raceSessions).values({
    id,
    visibility: "public",
    creatorGuestToken: guestSessionToken,
    status: "waiting",
  });

  const live: LiveSession = {
    id,
    visibility: "public",
    status: "waiting",
    creatorGuestToken: guestSessionToken,
    members: [],
    race: null,
    leaderboard: [],
    tickTimer: null,
    deadlineTimer: null,
    graceTimer: null,
    createdAt: Date.now(),
  };
  setLiveSession(live);
  return { id };
}

export async function ensureLiveSession(
  id: string,
): Promise<LiveSession | null> {
  const existing = getLiveSession(id);
  if (existing) return existing;

  const [row] = await db
    .select()
    .from(raceSessions)
    .where(eq(raceSessions.id, id.toUpperCase()))
    .limit(1);
  if (!row || row.status === "ended") return null;
  if (row.visibility !== "public") return null;

  const live: LiveSession = {
    id: row.id,
    visibility: "public",
    status: row.status === "racing" ? "waiting" : row.status,
    creatorGuestToken: row.creatorGuestToken ?? "",
    members: [],
    race: null,
    leaderboard: [],
    tickTimer: null,
    deadlineTimer: null,
    graceTimer: null,
    createdAt: row.createdAt.getTime(),
  };
  setLiveSession(live);
  return live;
}

export function publicMembers(session: LiveSession): PublicMember[] {
  return session.members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    carColor: m.carColor,
    isCreator: m.isCreator,
    pending: m.pending,
    disconnected: m.disconnected,
  }));
}

export function snapshotFor(
  session: LiveSession,
  memberId: string | null,
): SessionSnapshot {
  const you = memberId
    ? session.members.find((m) => m.id === memberId)
    : null;

  return {
    id: session.id,
    status: session.status,
    members: publicMembers(session),
    race: session.race
      ? {
          id: session.race.id,
          passageId: session.race.passageId,
          passageText: session.race.passageText,
          startedAtMs: session.race.startedAtMs,
          positions: Object.fromEntries(
            Object.entries(session.race.progress).map(([id, p]) => [
              id,
              session.race!.passageText.length
                ? p.correctIndex / session.race!.passageText.length
                : 0,
            ]),
          ),
        }
      : null,
    leaderboard: session.leaderboard,
    you: you
      ? {
          memberId: you.id,
          displayName: you.displayName,
          isCreator: you.isCreator,
          pending: you.pending,
        }
      : null,
  };
}

export function takenNames(session: LiveSession): Set<string> {
  return new Set(
    session.members
      .filter((m) => !m.disconnected)
      .map((m) => m.displayName),
  );
}

export type JoinResult =
  | { ok: true; member: LiveMember; promotedPending: boolean }
  | {
      ok: false;
      code: "full" | "ended" | "not_found" | "already_joined";
      message: string;
    };

export function joinSession(
  session: LiveSession,
  opts: {
    guestSessionToken: string;
    suggestedName?: string;
    /**
     * Only honored when `lockedCarColor` is true (signed-in profile color).
     * Guests always get a unique-in-session color from the palette.
     */
    carColor?: string;
    lockedCarColor?: boolean;
    socketId: string;
  },
): JoinResult {
  if (session.status === "ended") {
    return { ok: false, code: "ended", message: "This race session has ended." };
  }

  const existing = session.members.find(
    (m) => m.guestSessionToken === opts.guestSessionToken && !m.disconnected,
  );
  if (existing) {
    existing.socketId = opts.socketId;
    return { ok: true, member: existing, promotedPending: false };
  }

  const activeCount = session.members.filter((m) => !m.disconnected).length;
  if (activeCount >= MAX_SESSION_PLAYERS) {
    return { ok: false, code: "full", message: "This race is full." };
  }

  const isCreator =
    opts.guestSessionToken === session.creatorGuestToken &&
    !session.members.some((m) => m.isCreator && !m.disconnected);

  const name = assignUniqueName(opts.suggestedName, takenNames(session));
  const takenColors = session.members
    .filter((m) => !m.disconnected)
    .map((m) => m.carColor);
  const carColor =
    opts.lockedCarColor && opts.carColor
      ? opts.carColor
      : pickGuestCarColor(takenColors);
  const pending = session.status === "racing";

  const member: LiveMember = {
    id: randomUUID(),
    displayName: name,
    carColor,
    guestSessionToken: opts.guestSessionToken,
    socketId: opts.socketId,
    isCreator,
    pending,
    disconnected: false,
  };
  session.members.push(member);
  return { ok: true, member, promotedPending: pending };
}

export function leaveSession(
  session: LiveSession,
  memberId: string,
): { ok: true } | { ok: false; message: string } {
  if (session.status === "racing") {
    return {
      ok: false,
      message: "Leaving is only allowed between races.",
    };
  }
  const member = session.members.find((m) => m.id === memberId);
  if (!member) return { ok: true };
  member.disconnected = true;
  member.socketId = null;
  return { ok: true };
}

export function forfeitMember(session: LiveSession, memberId: string): void {
  const member = session.members.find((m) => m.id === memberId);
  if (!member) return;
  member.disconnected = true;
  member.socketId = null;
  if (session.race?.progress[memberId]) {
    session.race.progress[memberId]!.disconnected = true;
  }
}

export async function pickPassage() {
  const rows = await db.select().from(passages);
  if (rows.length === 0) throw new Error("No passages seeded");
  return rows[Math.floor(Math.random() * rows.length)]!;
}

export async function beginRace(session: LiveSession): Promise<LiveSession["race"]> {
  const passage = await pickPassage();
  const raceId = randomUUID();

  // Pending joiners become active for this race
  for (const m of session.members) {
    if (m.pending && !m.disconnected) m.pending = false;
  }

  const participants = session.members.filter((m) => !m.disconnected);

  const race = {
    id: raceId,
    passageId: passage.id,
    passageText: passage.text,
    startedAtMs: Date.now(),
    progress: Object.fromEntries(
      participants.map((m) => [
        m.id,
        { correctIndex: 0, finishedAtMs: null, disconnected: false },
      ]),
    ),
    finishes: [],
  };

  session.race = race;
  session.status = "racing";

  await db
    .update(raceSessions)
    .set({ status: "racing" })
    .where(eq(raceSessions.id, session.id));

  await db.insert(races).values({
    id: raceId,
    sessionId: session.id,
    passageId: passage.id,
    mode: "public_multiplayer",
    startedAt: new Date(),
  });

  return race;
}

export function updatePosition(
  session: LiveSession,
  memberId: string,
  correctIndex: number,
): void {
  if (!session.race || session.status !== "racing") return;
  const p = session.race.progress[memberId];
  if (!p || p.disconnected || p.finishedAtMs != null) return;
  const max = session.race.passageText.length;
  p.correctIndex = Math.max(p.correctIndex, Math.min(max, correctIndex));
}

export type FinishInput = {
  memberId: string;
  mistakes: number;
  keystrokes: { charIndex: number; timestampMs: number }[];
  durationMs: number;
};

export function recordFinish(
  session: LiveSession,
  input: FinishInput,
): {
  wpm: number;
  accuracy: number;
  allDone: boolean;
} | null {
  if (!session.race) return null;
  const p = session.race.progress[input.memberId];
  if (!p || p.finishedAtMs != null || p.disconnected) return null;

  const passageLen = session.race.passageText.length;
  const wpm = wpmFromKeystrokes(input.keystrokes, passageLen);
  const correctChars = Math.min(input.keystrokes.length, passageLen);
  const accuracy = accuracyFromMistakes(correctChars, input.mistakes);

  p.correctIndex = passageLen;
  p.finishedAtMs = Date.now() - session.race.startedAtMs;

  session.race.finishes.push({
    memberId: input.memberId,
    wpm,
    accuracy,
    durationMs: input.durationMs,
    mistakes: input.mistakes,
    keystrokes: input.keystrokes,
  });

  const racingMembers = session.members.filter(
    (m) =>
      !m.disconnected &&
      !m.pending &&
      session.race!.progress[m.id] &&
      !session.race!.progress[m.id]!.disconnected,
  );
  const allDone = racingMembers.every(
    (m) => session.race!.progress[m.id]?.finishedAtMs != null,
  );

  return { wpm, accuracy, allDone };
}

export async function completeRace(session: LiveSession) {
  if (!session.race) return null;
  clearRaceTimers(session);
  const race = session.race;

  const results = Object.entries(race.progress)
    .map(([memberId, prog]) => {
      const member = session.members.find((m) => m.id === memberId);
      const finish = race.finishes.find((f) => f.memberId === memberId);
      return {
        memberId,
        displayName: member?.displayName ?? "Unknown",
        carColor: member?.carColor ?? "#2ee6d6",
        wpm: finish?.wpm ?? 0,
        accuracy: finish?.accuracy ?? 0,
        finished: prog.finishedAtMs != null,
        finishedAtMs: prog.finishedAtMs,
        disconnected: prog.disconnected,
        progress: race.passageText.length
          ? prog.correctIndex / race.passageText.length
          : 0,
      };
    })
    .filter((r) => !r.disconnected)
    .sort((a, b) => {
      if (a.finished && b.finished)
        return (a.finishedAtMs ?? 0) - (b.finishedAtMs ?? 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    })
    .map((r, i) => ({ ...r, placement: i + 1 }));

  // Persist participants (guests included) for session leaderboard / claim
  for (const r of results) {
    const member = session.members.find((m) => m.id === r.memberId);
    if (!member) continue;
    const finish = race.finishes.find((f) => f.memberId === r.memberId);

    const [participant] = await db
      .insert(raceParticipants)
      .values({
        raceId: race.id,
        userId: null,
        anonymousName: member.displayName,
        guestSessionToken: member.guestSessionToken,
        carColor: member.carColor,
        isCpu: false,
        finalWpm: r.finished ? r.wpm : null,
        finalAccuracy: r.finished ? r.accuracy : null,
        placement: r.finished ? r.placement : null,
        disconnected: false,
      })
      .returning({ id: raceParticipants.id });

    if (participant && finish && finish.keystrokes.length > 0) {
      await db.insert(keystrokeLogs).values({
        raceParticipantId: participant.id,
        strokes: finish.keystrokes,
      });
    }

    if (r.finished && r.wpm > 0) {
      upsertLeaderboard(session, member, r.wpm);
    }
  }

  await db
    .update(races)
    .set({ endedAt: new Date() })
    .where(eq(races.id, race.id));

  await db
    .update(raceSessions)
    .set({ status: "waiting" })
    .where(eq(raceSessions.id, session.id));

  session.race = null;
  session.status = "waiting";

  // Promote anyone still pending
  for (const m of session.members) {
    if (m.pending && !m.disconnected) m.pending = false;
  }

  return { results, leaderboard: session.leaderboard };
}

function upsertLeaderboard(
  session: LiveSession,
  member: LiveMember,
  wpm: number,
): void {
  const existing = session.leaderboard.find((e) => e.memberId === member.id);
  if (existing) {
    existing.bestWpm = Math.max(existing.bestWpm, wpm);
    existing.racesPlayed += 1;
    existing.displayName = member.displayName;
  } else {
    const entry: SessionLeaderboardEntry = {
      memberId: member.id,
      displayName: member.displayName,
      bestWpm: wpm,
      racesPlayed: 1,
    };
    session.leaderboard.push(entry);
  }
  session.leaderboard.sort((a, b) => b.bestWpm - a.bestWpm);
}

export async function endSession(session: LiveSession): Promise<void> {
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
  clearRaceTimers(session);
  session.status = "ended";
  session.race = null;
  await db
    .update(raceSessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(raceSessions.id, session.id));
}

export function isCreator(session: LiveSession, memberId: string): boolean {
  return session.members.some((m) => m.id === memberId && m.isCreator);
}
