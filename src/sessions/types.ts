export type SessionStatus = "waiting" | "racing" | "ended";

export type LiveMember = {
  id: string;
  displayName: string;
  carColor: string;
  guestSessionToken: string;
  userId: string | null;
  socketId: string | null;
  isCreator: boolean;
  /** Waiting for current race to finish before becoming active. */
  pending: boolean;
  disconnected: boolean;
};

export type RaceProgress = {
  correctIndex: number;
  finishedAtMs: number | null;
  disconnected: boolean;
};

export type LiveRace = {
  id: string;
  passageId: string;
  passageText: string;
  startedAtMs: number;
  /** memberId → progress */
  progress: Record<string, RaceProgress>;
  finishes: {
    memberId: string;
    wpm: number;
    accuracy: number;
    durationMs: number;
    mistakes: number;
    keystrokes: { charIndex: number; timestampMs: number }[];
    mistypeCounts: Record<string, number>;
  }[];
};

export type CommitState = {
  endsAt: number;
  promptedByMemberId: string;
  promptedByName: string;
  readyMemberIds: string[];
  locked: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export type SessionLeaderboardEntry = {
  memberId: string;
  displayName: string;
  bestWpm: number;
  racesPlayed: number;
};

export type RematchRequest = {
  requestedByMemberId: string;
  requestedAt: number;
};

export type LiveSession = {
  id: string;
  visibility: "public" | "challenge" | "matchmade";
  status: SessionStatus;
  creatorGuestToken: string;
  creatorUserId: string | null;
  allowedUserIds: string[] | null;
  members: LiveMember[];
  race: LiveRace | null;
  leaderboard: SessionLeaderboardEntry[];
  rematch: RematchRequest | null;
  /** Quick Race Ready → commit countdown */
  commit: CommitState | null;
  /** Seats claimed by matchmaking before socket join. */
  reservedSeats: number;
  /** Broadcast tick handle */
  tickTimer: ReturnType<typeof setInterval> | null;
  /** Hard race deadline (AFK / stall guard). */
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  /** Grace after penultimate finisher. */
  graceTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
};

export type PublicMember = {
  id: string;
  displayName: string;
  carColor: string;
  isCreator: boolean;
  pending: boolean;
  disconnected: boolean;
};

export type SessionSnapshot = {
  id: string;
  status: SessionStatus;
  visibility: "public" | "challenge" | "matchmade";
  members: PublicMember[];
  race: null | {
    id: string;
    passageId: string;
    passageText: string;
    startedAtMs: number;
    positions: Record<string, number>;
  };
  leaderboard: SessionLeaderboardEntry[];
  rematch: RematchRequest | null;
  commit: {
    endsAt: number;
    promptedByName: string;
    readyMemberIds: string[];
  } | null;
  maxPlayers: number;
  you: {
    memberId: string;
    displayName: string;
    isCreator: boolean;
    pending: boolean;
    ready: boolean;
  } | null;
};
