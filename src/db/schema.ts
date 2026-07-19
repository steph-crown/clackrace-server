import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const visibilityEnum = pgEnum("session_visibility", [
  "public",
  "challenge",
]);
export const sessionStatusEnum = pgEnum("session_status", [
  "waiting",
  "racing",
  "ended",
]);
export const passageSourceEnum = pgEnum("passage_source", [
  "official",
  "community",
]);
export const passageDifficultyEnum = pgEnum("passage_difficulty", [
  "easy",
  "medium",
  "hard",
]);
export const cpuDifficultyEnum = pgEnum("cpu_difficulty", [
  "easy",
  "medium",
  "hard",
  "expert",
]);
export const leaderboardScopeEnum = pgEnum("leaderboard_scope", [
  "all_time",
  "daily",
  "weekly",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  carColor: text("car_color").notNull().default("#2ee6d6"),
  font: text("font"),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const passages = pgTable("passages", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  difficulty: passageDifficultyEnum("difficulty").notNull(),
  source: passageSourceEnum("source").notNull().default("official"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const raceSessions = pgTable("race_sessions", {
  id: text("id").primaryKey(),
  visibility: visibilityEnum("visibility").notNull(),
  creatorUserId: uuid("creator_user_id").references(() => users.id),
  /** Guest creator identity until accounts land (Phase 5). */
  creatorGuestToken: text("creator_guest_token"),
  allowedUserIds: jsonb("allowed_user_ids").$type<string[]>(),
  status: sessionStatusEnum("status").notNull().default("waiting"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const races = pgTable("races", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id").references(() => raceSessions.id),
  passageId: text("passage_id")
    .notNull()
    .references(() => passages.id),
  mode: text("mode").notNull().default("solo_cpu"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const raceParticipants = pgTable("race_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  raceId: uuid("race_id")
    .notNull()
    .references(() => races.id),
  userId: uuid("user_id").references(() => users.id),
  anonymousName: text("anonymous_name"),
  guestSessionToken: text("guest_session_token"),
  carColor: text("car_color").notNull(),
  isCpu: boolean("is_cpu").notNull().default(false),
  cpuDifficulty: cpuDifficultyEnum("cpu_difficulty"),
  finalWpm: real("final_wpm"),
  finalAccuracy: real("final_accuracy"),
  placement: integer("placement"),
  disconnected: boolean("disconnected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const keystrokeLogs = pgTable("keystroke_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  raceParticipantId: uuid("race_participant_id")
    .notNull()
    .references(() => raceParticipants.id),
  strokes: jsonb("strokes")
    .$type<{ charIndex: number; timestampMs: number }[]>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leaderboardEntries = pgTable("leaderboard_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  scope: leaderboardScopeEnum("scope").notNull(),
  bestWpm: real("best_wpm").notNull(),
  achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
});

export const eloRatings = pgTable("elo_ratings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  rating: real("rating").notNull().default(1000),
  racesCounted: integer("races_counted").notNull().default(0),
  kFactorTier: text("k_factor_tier").notNull().default("provisional"),
});

export const streaks = pgTable("streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastPlayedDate: text("last_played_date"),
});
