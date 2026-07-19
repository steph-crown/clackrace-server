import type { Server } from "socket.io";
import type { LiveSession } from "./types.js";

/** Local forfeit — kept here to avoid a service ↔ timeouts import cycle. */
function forfeitMember(session: LiveSession, memberId: string): void {
  const member = session.members.find((m) => m.id === memberId);
  if (!member) return;
  member.disconnected = true;
  member.socketId = null;
  if (session.race?.progress[memberId]) {
    session.race.progress[memberId]!.disconnected = true;
  }
}

/** Floor typing speed used to size the hard race deadline. */
const FLOOR_WPM = 25;
/** Extra buffer on top of floor-duration estimate. */
const HARD_CAP_BUFFER_MS = 30_000;
/** Minimum hard race length so short passages aren't too harsh. */
const HARD_CAP_MIN_MS = 90_000;
/** After penultimate finisher, remaining racers get this grace window. */
export const GRACE_AFTER_PENULTIMATE_MS = 45_000;

export function hardCapMsForPassage(passageText: string): number {
  const words = Math.max(1, passageText.length / 5);
  const estimateMs = (words / FLOOR_WPM) * 60_000;
  return Math.max(HARD_CAP_MIN_MS, Math.round(estimateMs + HARD_CAP_BUFFER_MS));
}

export function clearRaceTimers(session: LiveSession): void {
  if (session.deadlineTimer) {
    clearTimeout(session.deadlineTimer);
    session.deadlineTimer = null;
  }
  if (session.graceTimer) {
    clearTimeout(session.graceTimer);
    session.graceTimer = null;
  }
}

function unfinishedActiveIds(session: LiveSession): string[] {
  if (!session.race) return [];
  return Object.entries(session.race.progress)
    .filter(([, p]) => !p.disconnected && p.finishedAtMs == null)
    .map(([id]) => id);
}

function forfeitUnfinished(session: LiveSession): string[] {
  const ids = unfinishedActiveIds(session);
  for (const id of ids) {
    forfeitMember(session, id);
  }
  return ids;
}

type CompleteFn = (io: Server, session: LiveSession) => Promise<void>;

/**
 * Hard deadline for the whole race + grace after penultimate finisher.
 * Call `onFinishProgress` whenever someone finishes so grace can arm.
 */
export function scheduleRaceTimeouts(
  io: Server,
  session: LiveSession,
  maybeComplete: CompleteFn,
): void {
  clearRaceTimers(session);
  if (!session.race) return;

  const hardMs = hardCapMsForPassage(session.race.passageText);
  session.deadlineTimer = setTimeout(() => {
    if (session.status !== "racing" || !session.race) return;
    const forfeited = forfeitUnfinished(session);
    if (forfeited.length > 0) {
      io.to(`session:${session.id}`).emit("session:toast", {
        message: "Timed out — race closed",
      });
    }
    void maybeComplete(io, session);
  }, hardMs);
}

/** Arm 45s grace once only one active racer remains unfinished. */
export function maybeArmPenultimateGrace(
  io: Server,
  session: LiveSession,
  maybeComplete: CompleteFn,
): void {
  if (!session.race || session.status !== "racing") return;
  if (session.graceTimer) return;

  const unfinished = unfinishedActiveIds(session);
  if (unfinished.length !== 1) return;

  session.graceTimer = setTimeout(() => {
    if (session.status !== "racing" || !session.race) return;
    const forfeited = forfeitUnfinished(session);
    if (forfeited.length > 0) {
      io.to(`session:${session.id}`).emit("session:toast", {
        message: "Timed out — race closed",
      });
    }
    void maybeComplete(io, session);
  }, GRACE_AFTER_PENULTIMATE_MS);
}
