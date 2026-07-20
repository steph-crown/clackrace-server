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
  "matchmade",
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

/** Better Auth `user` table + ClackRace profile fields. */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Username plugin */
  username: text("username").unique(),
  displayUsername: text("display_username"),
  /** ClackRace profile */
  carColor: text("car_color").notNull().default("#2ee6d6"),
  font: text("font"),
  avatar: text("avatar"),
});

/** @deprecated alias — prefer `user` */
export const users = user;

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
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
  creatorUserId: text("creator_user_id").references(() => user.id),
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
  userId: text("user_id").references(() => user.id),
  anonymousName: text("anonymous_name"),
  guestSessionToken: text("guest_session_token"),
  carColor: text("car_color").notNull(),
  isCpu: boolean("is_cpu").notNull().default(false),
  cpuDifficulty: cpuDifficultyEnum("cpu_difficulty"),
  finalWpm: real("final_wpm"),
  finalAccuracy: real("final_accuracy"),
  placement: integer("placement"),
  disconnected: boolean("disconnected").notNull().default(false),
  /** Anti-cheat: held from public leaderboards pending review. */
  shadowHeld: boolean("shadow_held").notNull().default(false),
  flagReason: text("flag_reason"),
  /** Expected-key → wrong-press counts for heatmap. */
  mistypeCounts: jsonb("mistype_counts").$type<Record<string, number>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Best verified WPM + keystroke log per user per difficulty (ghost racing). */
export const personalBests = pgTable("personal_bests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  difficulty: passageDifficultyEnum("difficulty").notNull(),
  bestWpm: real("best_wpm").notNull(),
  bestAccuracy: real("best_accuracy").notNull(),
  raceParticipantId: uuid("race_participant_id")
    .notNull()
    .references(() => raceParticipants.id),
  passageId: text("passage_id")
    .notNull()
    .references(() => passages.id),
  strokes: jsonb("strokes")
    .$type<{ charIndex: number; timestampMs: number }[]>()
    .notNull(),
  achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
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
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  scope: leaderboardScopeEnum("scope").notNull(),
  bestWpm: real("best_wpm").notNull(),
  achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
});

export const eloRatings = pgTable("elo_ratings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  rating: real("rating").notNull().default(1000),
  racesCounted: integer("races_counted").notNull().default(0),
  kFactorTier: text("k_factor_tier").notNull().default("provisional"),
});

export const streaks = pgTable("streaks", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastPlayedDate: text("last_played_date"),
});

/** Daily Champion crown — one row per UTC day. */
export const dailyChampions = pgTable("daily_champions", {
  day: text("day").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  bestWpm: real("best_wpm").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
