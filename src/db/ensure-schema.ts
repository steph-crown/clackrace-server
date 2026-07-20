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
}
