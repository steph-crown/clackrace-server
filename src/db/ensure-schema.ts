import { sql } from "drizzle-orm";
import { db } from "./client.js";

/** Idempotent DDL for Phase 7–8 columns/enums (drizzle-kit push is interactive). */
export async function ensureSchema(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TYPE session_visibility ADD VALUE IF NOT EXISTS 'matchmade';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await db.execute(sql`
    ALTER TABLE race_participants
      ADD COLUMN IF NOT EXISTS shadow_held boolean NOT NULL DEFAULT false;
  `);
  await db.execute(sql`
    ALTER TABLE race_participants
      ADD COLUMN IF NOT EXISTS flag_reason text;
  `);
  await db.execute(sql`
    ALTER TABLE race_participants
      ADD COLUMN IF NOT EXISTS mistype_counts jsonb;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS personal_bests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      difficulty passage_difficulty NOT NULL,
      best_wpm real NOT NULL,
      best_accuracy real NOT NULL,
      race_participant_id uuid NOT NULL REFERENCES race_participants(id),
      passage_id text NOT NULL REFERENCES passages(id),
      strokes jsonb NOT NULL,
      achieved_at timestamptz NOT NULL,
      UNIQUE (user_id, difficulty)
    );
  `);

  await db.execute(sql`
    ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      user_id text REFERENCES "user"(id) ON DELETE SET NULL,
      guest_session_token text,
      session_id text,
      props jsonb NOT NULL DEFAULT '{}'::jsonb,
      path text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx
      ON analytics_events (name, created_at DESC);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS analytics_events_created_idx
      ON analytics_events (created_at DESC);
  `);
}
