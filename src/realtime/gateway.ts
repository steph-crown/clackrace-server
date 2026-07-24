import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import { getUserFromSessionToken } from "../auth/token.js";
import { getUserElo } from "../lib/elo.js";
import { env } from "../env.js";
import { COMMIT_MS } from "../matchmaking/store.js";
import {
  onMatchmadeEmptyOrRacing,
  onMatchmadeWaiting,
  enqueue,
} from "../matchmaking/service.js";
import { takeRequeueSlot } from "../matchmaking/requeue.js";
import {
  beginRace,
  completeRace,
  endSession,
  ensureLiveSession,
  forfeitMember,
  isCreator,
  joinSession,
  leaveSession,
  recordFinish,
  snapshotFor,
  transferCreator,
  updatePosition,
} from "../sessions/service.js";
import { getLiveSession } from "../sessions/store.js";
import {
  maybeArmPenultimateGrace,
  scheduleRaceTimeouts,
} from "../sessions/timeouts.js";
import type { LiveSession } from "../sessions/types.js";

type SocketData = {
  sessionId?: string;
  memberId?: string;
};

const POSITION_TICK_MS = 100; // ~10Hz

function room(sessionId: string) {
  return `session:${sessionId}`;
}

function broadcastState(io: Server, session: LiveSession) {
  for (const m of session.members) {
    if (!m.socketId || m.disconnected) continue;
    io.to(m.socketId).emit("session:state", snapshotFor(session, m.id));
  }
}

function startPositionTick(io: Server, session: LiveSession) {
  if (session.tickTimer) clearInterval(session.tickTimer);
  session.tickTimer = setInterval(() => {
    if (!session.race || session.status !== "racing") return;
    const positions: Record<
      string,
      { progress: number; finished: boolean; disconnected: boolean }
    > = {};
    const len = session.race.passageText.length || 1;
    for (const [id, p] of Object.entries(session.race.progress)) {
      positions[id] = {
        progress: p.correctIndex / len,
        finished: p.finishedAtMs != null,
        disconnected: p.disconnected,
      };
    }
    io.to(room(session.id)).emit("race:positions", {
      positions,
      serverNow: Date.now(),
    });
  }, POSITION_TICK_MS);
}

function stopPositionTick(session: LiveSession) {
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
}

async function runCountdown(
  io: Server,
  session: LiveSession,
  steps: Array<number | "GO">,
  stepMs: number,
) {
  for (const value of steps) {
    io.to(room(session.id)).emit("race:countdown", { value });
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

async function startRaceFlow(
  io: Server,
  session: LiveSession,
  kind: "initial" | "rematch",
) {
  const steps: Array<number | "GO"> =
    kind === "rematch" ? [5, 4, 3, 2, 1, "GO"] : [3, 2, 1, "GO"];

  if (kind === "rematch") {
    io.to(room(session.id)).emit("session:toast", {
      message: "Rematch starting…",
    });
  }

  await runCountdown(io, session, steps, 700);
  const race = await beginRace(session);
  if (!race) return;

  io.to(room(session.id)).emit("race:start", {
    raceId: race.id,
    passageId: race.passageId,
    passageText: race.passageText,
    startedAtMs: race.startedAtMs,
  });
  broadcastState(io, session);
  startPositionTick(io, session);
  scheduleRaceTimeouts(io, session, maybeCompleteRace);
}

async function maybeCompleteRace(io: Server, session: LiveSession) {
  if (!session.race) return;

  const anyoneStillRacing = Object.values(session.race.progress).some(
    (p) => !p.disconnected && p.finishedAtMs == null,
  );
  if (anyoneStillRacing) return;

  stopPositionTick(session);
  const completed = await completeRace(session);
  if (!completed) return;

  io.to(room(session.id)).emit("race:results", completed);
  broadcastState(io, session);
  if (session.visibility === "matchmade") {
    await onMatchmadeWaiting(session);
  }
}

function clearCommit(session: LiveSession) {
  if (session.commit?.timer) clearTimeout(session.commit.timer);
  session.commit = null;
}

async function finishCommit(io: Server, session: LiveSession) {
  if (!session.commit) return;
  session.commit.locked = true;
  const active = session.members.filter((m) => !m.disconnected && !m.pending);
  if (active.length < 2) {
    clearCommit(session);
    io.to(room(session.id)).emit("session:toast", {
      message: "Not enough racers — searching again…",
    });
    // PRD: survivor is re-queued once (leave this session, re-enter MM).
    for (const member of active) {
      const socketId = member.socketId;
      const guestSessionToken = member.guestSessionToken;
      const userId = member.userId;
      leaveSession(session, member.id);
      if (!socketId) continue;
      const sock = io.sockets.sockets.get(socketId);
      if (sock) {
        const sd = sock.data as SocketData;
        sd.sessionId = undefined;
        sd.memberId = undefined;
        void sock.leave(room(session.id));
      }
      if (!takeRequeueSlot(guestSessionToken)) {
        io.to(socketId).emit("matchmaking:alone", {
          message:
            "Still alone — try Open Race or Race CPU while you wait.",
        });
        continue;
      }
      const ticket = await enqueue({
        guestSessionToken,
        userId,
        requeued: true,
      });
      if (ticket.ok) {
        io.to(socketId).emit("matchmaking:requeued", {
          ticketId: ticket.ticketId,
          status: ticket.status,
          sessionId: ticket.sessionId,
          expiresAt: ticket.expiresAt,
        });
      }
    }
    broadcastState(io, session);
    await maybeEndEmptyMatchmade(io, session);
    return;
  }
  clearCommit(session);
  await onMatchmadeEmptyOrRacing(session.id);
  await startRaceFlow(io, session, "initial");
}

function activeLobbyCount(session: LiveSession) {
  return session.members.filter((m) => !m.disconnected && !m.pending).length;
}

async function maybeEndEmptyMatchmade(io: Server, session: LiveSession) {
  if (session.visibility !== "matchmade") return;
  if (activeLobbyCount(session) > 0) {
    await onMatchmadeWaiting(session);
    return;
  }
  clearCommit(session);
  await onMatchmadeEmptyOrRacing(session.id);
  await endSession(session);
  io.to(room(session.id)).emit("session:ended", {});
}

export function attachRaceGateway(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: {
      origin: [...env.corsOrigins],
      credentials: true,
    },
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;

    socket.on(
      "session:join",
      async (
        payload: {
          sessionId: string;
          guestSessionToken: string;
          suggestedName?: string;
          carColor?: string;
          sessionToken?: string;
        },
        ack?: (res: unknown) => void,
      ) => {
        try {
          const session = await ensureLiveSession(payload.sessionId);
          if (!session) {
            ack?.({
              ok: false,
              code: "not_found",
              message: "Session not found",
            });
            return;
          }

          const user = await getUserFromSessionToken(payload.sessionToken);
          const result = joinSession(session, {
            guestSessionToken: payload.guestSessionToken,
            suggestedName: payload.suggestedName,
            carColor: user?.carColor ?? payload.carColor,
            lockedCarColor: !!user,
            userId: user?.id ?? null,
            displayUsername: user?.username ?? user?.name ?? null,
            socketId: socket.id,
          });

          if (!result.ok) {
            ack?.(result);
            socket.emit("session:error", result);
            return;
          }

          if (result.member.userId) {
            try {
              const elo = await getUserElo(result.member.userId);
              result.member.rating = Math.round(elo.rating);
            } catch {
              result.member.rating = 1000;
            }
          }

          data.sessionId = session.id;
          data.memberId = result.member.id;
          await socket.join(room(session.id));

          ack?.({
            ok: true,
            memberId: result.member.id,
            displayName: result.member.displayName,
            isCreator: result.member.isCreator,
            pending: result.member.pending,
            snapshot: snapshotFor(session, result.member.id),
          });

          if (result.member.pending) {
            socket.emit("session:toast", {
              message: "A race is in progress, hang tight",
            });
          }

          io.to(room(session.id)).emit("session:toast", {
            message: `${result.member.displayName} joined`,
          });
          broadcastState(io, session);
        } catch (err) {
          app.log.error(err);
          ack?.({ ok: false, code: "error", message: "Join failed" });
        }
      },
    );

    socket.on("session:leave", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      const result = leaveSession(session, data.memberId);
      if (!result.ok) {
        ack?.(result);
        return;
      }
      const name =
        session.members.find((m) => m.id === data.memberId)?.displayName ??
        "Someone";
      await socket.leave(room(session.id));
      io.to(room(session.id)).emit("session:toast", {
        message: `${name} left`,
      });
      broadcastState(io, session);
      await maybeEndEmptyMatchmade(io, session);
      data.sessionId = undefined;
      data.memberId = undefined;
      ack?.({ ok: true });
    });

    socket.on("race:start", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      if (session.visibility === "matchmade") {
        ack?.({
          ok: false,
          message: "Use Ready to start a Quick Race.",
        });
        return;
      }
      if (!isCreator(session, data.memberId)) {
        ack?.({ ok: false, message: "Only the creator can start the race" });
        return;
      }
      if (session.status !== "waiting") {
        ack?.({ ok: false, message: "Race already in progress" });
        return;
      }
      const ready = session.members.filter((m) => !m.disconnected && !m.pending);
      if (ready.length < 1) {
        ack?.({ ok: false, message: "Need at least one racer" });
        return;
      }
      ack?.({ ok: true });
      await startRaceFlow(io, session, "initial");
    });

    socket.on("session:ready", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      if (session.visibility !== "matchmade") {
        ack?.({ ok: false, message: "Ready is only for Quick Race." });
        return;
      }
      if (session.status !== "waiting") {
        ack?.({ ok: false, message: "Race already in progress" });
        return;
      }
      const member = session.members.find((m) => m.id === data.memberId);
      if (!member || member.disconnected || member.pending) {
        ack?.({ ok: false, message: "Can't ready yet." });
        return;
      }
      if (activeLobbyCount(session) < 2) {
        ack?.({ ok: false, message: "Need at least two racers." });
        return;
      }

      if (!session.commit) {
        session.commit = {
          endsAt: Date.now() + COMMIT_MS,
          promptedByMemberId: member.id,
          promptedByName: member.displayName,
          readyMemberIds: [member.id],
          locked: false,
          timer: setTimeout(() => {
            void finishCommit(io, session);
          }, COMMIT_MS),
        };
        io.to(room(session.id)).emit("session:toast", {
          message: `${member.displayName} is ready — race starts in 10…`,
        });
      } else if (!session.commit.readyMemberIds.includes(member.id)) {
        session.commit.readyMemberIds.push(member.id);
      }

      broadcastState(io, session);
      ack?.({ ok: true, endsAt: session.commit.endsAt });
    });

    socket.on("session:playAgain", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      if (session.status !== "waiting") {
        ack?.({ ok: false, message: "Wait for the current race to finish" });
        return;
      }

      // Challenge: either player requests; other must accept (not auto).
      if (session.visibility === "challenge") {
        session.rematch = {
          requestedByMemberId: data.memberId,
          requestedAt: Date.now(),
        };
        const requester = session.members.find((m) => m.id === data.memberId);
        io.to(room(session.id)).emit("session:toast", {
          message: `${requester?.displayName ?? "Someone"} wants a rematch`,
        });
        broadcastState(io, session);
        ack?.({ ok: true, pending: true });
        return;
      }

      if (session.visibility === "matchmade") {
        ack?.({
          ok: false,
          message: "Press Ready when everyone is set.",
        });
        return;
      }

      if (!isCreator(session, data.memberId)) {
        ack?.({ ok: false, message: "Only the creator can start a rematch" });
        return;
      }
      ack?.({ ok: true });
      await startRaceFlow(io, session, "rematch");
    });

    socket.on(
      "session:rematchRespond",
      async (
        payload: { accept: boolean },
        ack?: (res: unknown) => void,
      ) => {
        if (!data.sessionId || !data.memberId) return;
        const session = await ensureLiveSession(data.sessionId);
        if (!session) return;
        if (session.visibility !== "challenge" || !session.rematch) {
          ack?.({ ok: false, message: "No rematch pending" });
          return;
        }
        if (session.rematch.requestedByMemberId === data.memberId) {
          ack?.({ ok: false, message: "Wait for the other player" });
          return;
        }
        if (session.status !== "waiting") {
          ack?.({ ok: false, message: "Race already in progress" });
          return;
        }

        if (!payload.accept) {
          session.rematch = null;
          io.to(room(session.id)).emit("session:toast", {
            message: "Rematch declined",
          });
          broadcastState(io, session);
          ack?.({ ok: true, accepted: false });
          return;
        }

        session.rematch = null;
        ack?.({ ok: true, accepted: true });
        await startRaceFlow(io, session, "rematch");
      },
    );

    socket.on("session:end", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      if (session.visibility === "matchmade") {
        ack?.({ ok: false, message: "Leave the lobby to exit Quick Race" });
        return;
      }
      if (!isCreator(session, data.memberId)) {
        ack?.({ ok: false, message: "Only the creator can end the session" });
        return;
      }
      if (session.status === "racing") {
        ack?.({ ok: false, message: "End the session between races" });
        return;
      }
      stopPositionTick(session);
      await endSession(session);
      io.to(room(session.id)).emit("session:ended", {});
      broadcastState(io, session);
      ack?.({ ok: true });
    });

    socket.on("race:position", (payload: { correctIndex: number }) => {
      if (!data.sessionId || !data.memberId) return;
      const session = getLiveSession(data.sessionId);
      if (!session) return;
      updatePosition(session, data.memberId, payload.correctIndex);
    });

    socket.on(
      "race:finish",
      async (
        payload: {
          mistakes: number;
          keystrokes: { charIndex: number; timestampMs: number }[];
          durationMs: number;
        },
        ack?: (res: unknown) => void,
      ) => {
        if (!data.sessionId || !data.memberId) return;
        const session = await ensureLiveSession(data.sessionId);
        if (!session) return;
        const result = recordFinish(session, {
          memberId: data.memberId,
          mistakes: payload.mistakes,
          keystrokes: payload.keystrokes ?? [],
          durationMs: payload.durationMs,
          mistypeCounts: (
            payload as { mistypeCounts?: Record<string, number> }
          ).mistypeCounts,
        });
        if (!result) {
          ack?.({ ok: false });
          return;
        }

        const finisher = session.members.find((m) => m.id === data.memberId);
        io.to(room(session.id)).emit("session:toast", {
          message: `${finisher?.displayName ?? "Someone"} finished`,
        });
        broadcastState(io, session);
        ack?.({ ok: true, ...result });
        maybeArmPenultimateGrace(io, session, maybeCompleteRace);
        await maybeCompleteRace(io, session);
      },
    );

    socket.on("disconnect", async () => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      const member = session.members.find((m) => m.id === data.memberId);
      if (!member || member.disconnected) return;

      if (session.status === "racing") {
        forfeitMember(session, data.memberId);
        io.to(room(session.id)).emit("session:toast", {
          message: `${member.displayName} disconnected`,
        });
        broadcastState(io, session);
        await maybeCompleteRace(io, session);
        return;
      }

      // Lobby / between races: free the seat (no zombie slots)
      const wasCreator = member.isCreator;
      member.disconnected = true;
      member.socketId = null;
      member.isCreator = false;
      if (session.commit) {
        session.commit.readyMemberIds = session.commit.readyMemberIds.filter(
          (id) => id !== member.id,
        );
      }
      io.to(room(session.id)).emit("session:toast", {
        message: `${member.displayName} left`,
      });

      if (wasCreator && session.visibility !== "matchmade") {
        const newCreatorId = transferCreator(session);
        if (newCreatorId) {
          const host = session.members.find((m) => m.id === newCreatorId);
          if (host?.socketId) {
            io.to(host.socketId).emit("session:toast", {
              message: "Host left — you're the host now",
            });
          }
        }
      }
      broadcastState(io, session);
      await maybeEndEmptyMatchmade(io, session);
    });
  });

  app.log.info("Socket.IO race gateway attached");
  return io;
}
