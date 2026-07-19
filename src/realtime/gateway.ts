import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
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
  updatePosition,
} from "../sessions/service.js";
import { getLiveSession } from "../sessions/store.js";
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
}

export function attachRaceGateway(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
      ],
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

          const result = joinSession(session, {
            guestSessionToken: payload.guestSessionToken,
            suggestedName: payload.suggestedName,
            carColor: payload.carColor,
            socketId: socket.id,
          });

          if (!result.ok) {
            ack?.(result);
            socket.emit("session:error", result);
            return;
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
      data.sessionId = undefined;
      data.memberId = undefined;
      ack?.({ ok: true });
    });

    socket.on("race:start", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
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

    socket.on("session:playAgain", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
      if (!isCreator(session, data.memberId)) {
        ack?.({ ok: false, message: "Only the creator can start a rematch" });
        return;
      }
      if (session.status !== "waiting") {
        ack?.({ ok: false, message: "Wait for the current race to finish" });
        return;
      }
      ack?.({ ok: true });
      await startRaceFlow(io, session, "rematch");
    });

    socket.on("session:end", async (ack?: (res: unknown) => void) => {
      if (!data.sessionId || !data.memberId) return;
      const session = await ensureLiveSession(data.sessionId);
      if (!session) return;
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
        });
        ack?.(result ? { ok: true, ...result } : { ok: false });
        if (result) {
          await maybeCompleteRace(io, session);
        }
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
      } else {
        member.socketId = null;
      }
    });
  });

  app.log.info("Socket.IO race gateway attached");
  return io;
}
