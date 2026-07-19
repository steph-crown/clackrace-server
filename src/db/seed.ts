import "dotenv/config";
import { db } from "./client.js";
import { passages } from "./schema.js";

const SEED = [
  {
    id: "static-easy-1",
    difficulty: "easy" as const,
    text: "The quick brown fox jumps over the lazy dog near the track.",
  },
  {
    id: "static-easy-2",
    difficulty: "easy" as const,
    text: "Type each word with care and watch your car pull ahead of the pack.",
  },
  {
    id: "static-medium-1",
    difficulty: "medium" as const,
    text: "ClackRace rewards clean speed over messy bursts. Keep your fingers light, breathe between phrases, and let accuracy pull you into first place before the checkered flag drops.",
  },
  {
    id: "static-medium-2",
    difficulty: "medium" as const,
    text: "Night asphalt, neon lanes, and a keyboard that sounds like thunder. Every correct character moves the wheels. Every mistake stalls the engine for a heartbeat.",
  },
  {
    id: "static-hard-1",
    difficulty: "hard" as const,
    text: "Championship pacing demands composure under pressure: punctuation, capitalization, and odd letter pairs all arrive without warning. The leaders do not flinch; they settle into rhythm and convert keystrokes into meters of track until the finish line is inevitable.",
  },
  {
    id: "static-hard-2",
    difficulty: "hard" as const,
    text: "When the countdown hits go, hesitation costs placement. Trust muscle memory, ignore the rearview mirror of mistakes already made, and chase the ghost of your personal best through every turn of the passage.",
  },
];

async function main() {
  for (const p of SEED) {
    await db
      .insert(passages)
      .values({
        id: p.id,
        text: p.text,
        difficulty: p.difficulty,
        source: "official",
      })
      .onConflictDoUpdate({
        target: passages.id,
        set: {
          text: p.text,
          difficulty: p.difficulty,
          source: "official",
        },
      });
  }
  console.log(`Seeded ${SEED.length} official passages`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
