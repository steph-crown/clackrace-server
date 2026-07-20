import {
  createMatchmadeSession,
  maxPlayersFor,
} from "../sessions/service.js";
import { getLiveSession } from "../sessions/store.js";
import type { LiveSession } from "../sessions/types.js";
import {
  enqueueTicket,
  getTicket,
  listOpenSessionIds,
  listQueuedOldest,
  markAssigned,
  markSessionClosed,
  markSessionOpen,
  newTicketId,
  removeTicket,
  SEARCH_TIMEOUT_MS,
  type QueueTicket,
} from "./store.js";

export type EnqueueResult =
  | {
      ok: true;
      ticketId: string;
      status: "searching" | "assigned";
      sessionId: string | null;
      expiresAt: number;
    }
  | { ok: false; code: string; message: string };

function seatedCount(session: LiveSession) {
  return session.members.filter((m) => !m.disconnected).length;
}

function occupied(session: LiveSession) {
  return seatedCount(session) + session.reservedSeats;
}

function canFill(session: LiveSession): boolean {
  return (
    session.visibility === "matchmade" &&
    session.status === "waiting" &&
    !session.commit?.locked &&
    occupied(session) < maxPlayersFor(session)
  );
}

export function reserveSeat(session: LiveSession) {
  session.reservedSeats += 1;
}

export function releaseReserve(session: LiveSession) {
  session.reservedSeats = Math.max(0, session.reservedSeats - 1);
}

/** Prefer existing open sessions, else form new ones from queue (≥2). */
export async function tryAssign(): Promise<
  { ticketId: string; sessionId: string }[]
> {
  const assignments: { ticketId: string; sessionId: string }[] = [];
  const queued = await listQueuedOldest();

  for (const sessionId of listOpenSessionIds()) {
    const session = getLiveSession(sessionId);
    if (!session || !canFill(session)) {
      markSessionClosed(sessionId);
      continue;
    }
    while (canFill(session) && queued.length > 0) {
      const ticket = queued.shift()!;
      if (ticket.sessionId) continue;
      reserveSeat(session);
      await markAssigned(ticket.id, session.id);
      assignments.push({ ticketId: ticket.id, sessionId: session.id });
    }
    if (!canFill(session)) markSessionClosed(session.id);
  }

  // Form new sessions while ≥2 remain
  let remaining = queued.filter((t) => !t.sessionId);
  while (remaining.length >= 2) {
    const session = await createMatchmadeSession();
    const take = Math.min(maxPlayersFor(session), remaining.length);
    const batch = remaining.splice(0, take);
    session.reservedSeats = batch.length;
    markSessionOpen(session.id);
    for (const ticket of batch) {
      await markAssigned(ticket.id, session.id);
      assignments.push({ ticketId: ticket.id, sessionId: session.id });
    }
    if (!canFill(session)) markSessionClosed(session.id);
  }

  return assignments;
}

export async function enqueue(opts: {
  guestSessionToken: string;
  userId: string | null;
  requeued?: boolean;
}): Promise<EnqueueResult> {
  const now = Date.now();
  const ticket: QueueTicket = {
    id: newTicketId(),
    guestSessionToken: opts.guestSessionToken,
    userId: opts.userId,
    enqueuedAt: now,
    requeued: opts.requeued ?? false,
    sessionId: null,
  };
  await enqueueTicket(ticket);
  const assigned = await tryAssign();
  const mine = assigned.find((a) => a.ticketId === ticket.id);
  if (mine) {
    return {
      ok: true,
      ticketId: ticket.id,
      status: "assigned",
      sessionId: mine.sessionId,
      expiresAt: now + SEARCH_TIMEOUT_MS,
    };
  }
  return {
    ok: true,
    ticketId: ticket.id,
    status: "searching",
    sessionId: null,
    expiresAt: now + SEARCH_TIMEOUT_MS,
  };
}

export async function pollTicket(ticketId: string): Promise<{
  status: "searching" | "assigned" | "timeout" | "gone";
  sessionId: string | null;
  expiresAt: number | null;
}> {
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    // May have been assigned and removed — client should have gotten sessionId
    return { status: "gone", sessionId: null, expiresAt: null };
  }
  if (ticket.sessionId) {
    return {
      status: "assigned",
      sessionId: ticket.sessionId,
      expiresAt: ticket.enqueuedAt + SEARCH_TIMEOUT_MS,
    };
  }
  if (Date.now() - ticket.enqueuedAt >= SEARCH_TIMEOUT_MS) {
    await removeTicket(ticketId);
    return { status: "timeout", sessionId: null, expiresAt: null };
  }
  // Opportunistic assign on poll
  const assigned = await tryAssign();
  const mine = assigned.find((a) => a.ticketId === ticketId);
  if (mine) {
    return {
      status: "assigned",
      sessionId: mine.sessionId,
      expiresAt: ticket.enqueuedAt + SEARCH_TIMEOUT_MS,
    };
  }
  return {
    status: "searching",
    sessionId: null,
    expiresAt: ticket.enqueuedAt + SEARCH_TIMEOUT_MS,
  };
}

export async function cancelTicket(ticketId: string) {
  await removeTicket(ticketId);
}

/** After a matchmade race ends / lobby opens seats — refill from queue. */
export async function onMatchmadeWaiting(session: LiveSession) {
  if (session.visibility !== "matchmade") return;
  if (canFill(session)) markSessionOpen(session.id);
  else markSessionClosed(session.id);
  await tryAssign();
}

export async function onMatchmadeEmptyOrRacing(sessionId: string) {
  markSessionClosed(sessionId);
}

export { SEARCH_TIMEOUT_MS };
export { COMMIT_MS } from "./store.js";
