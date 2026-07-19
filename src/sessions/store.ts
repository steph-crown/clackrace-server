import type { LiveSession } from "./types.js";

const sessions = new Map<string, LiveSession>();

export function getLiveSession(id: string): LiveSession | undefined {
  return sessions.get(id.toUpperCase());
}

export function setLiveSession(session: LiveSession): void {
  sessions.set(session.id, session);
}

export function deleteLiveSession(id: string): void {
  const s = sessions.get(id.toUpperCase());
  if (s?.tickTimer) clearInterval(s.tickTimer);
  sessions.delete(id.toUpperCase());
}

export function generateSessionCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  if (sessions.has(code)) return generateSessionCode();
  return code;
}
