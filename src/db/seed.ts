import "dotenv/config";
import { inArray } from "drizzle-orm";
import { db } from "./client.js";
import { passages } from "./schema.js";

/**
 * Official passage pool for v1.
 * ~80% medium / ~20% hard. No easy — race text should feel like a real race.
 * Difficulty is internal (PB/ghost bookkeeping); it does not affect rating or boards.
 */
const SEED: {
  id: string;
  difficulty: "medium" | "hard";
  text: string;
}[] = [
  // —— medium (36) ——
  {
    id: "official-medium-01",
    difficulty: "medium",
 text: "ClackRace rewards clean speed over messy bursts. Keep your fingers light, breathe between phrases, and let accuracy pull you into first place before the checkered flag drops.",
  },
  {
    id: "official-medium-02",
    difficulty: "medium",
 text: "Night asphalt, neon lanes, and a keyboard that sounds like thunder. Every correct character moves the wheels. Every mistake stalls the engine for a heartbeat.",
  },
  {
    id: "official-medium-03",
    difficulty: "medium",
 text: "The lobby fills, the countdown ticks, and suddenly the world shrinks to a blinking caret. Type through the noise. Trust the rhythm you practiced when nobody was watching.",
  },
  {
    id: "official-medium-04",
    difficulty: "medium",
 text: "Share a link, wait for friends, and race until the session ends. Open Race is simple on purpose: one track, one passage, and whoever types cleanest crosses first.",
  },
  {
    id: "official-medium-05",
    difficulty: "medium",
 text: "Quick Race finds strangers when you have no one to invite. Queue up, stay ready, and when the field locks you get three seconds to settle before the words begin.",
  },
  {
    id: "official-medium-06",
    difficulty: "medium",
 text: "Your car is only as fast as your accuracy. Spray wrong letters and you spend the race in reverse, tapping backspace while the pack slips past in a blur of color.",
  },
  {
    id: "official-medium-07",
    difficulty: "medium",
 text: "Streaks are quiet discipline. Show up tomorrow, type another passage, and the flame grows. Miss a day and it resets - that gentle pressure is the whole point.",
  },
  {
    id: "official-medium-08",
    difficulty: "medium",
 text: "Personal bests live in the garage like trophies on a shelf. Beat your ghost and the grey car falls behind; lose and you learn exactly where your hands hesitated.",
  },
  {
    id: "official-medium-09",
    difficulty: "medium",
 text: "Anonymous Turbo slides into lane three with a borrowed name and a bright paint job. No account required to race - only to keep the score when the night is over.",
  },
  {
    id: "official-medium-10",
    difficulty: "medium",
 text: "The finish line is not a finish until the last correct character lands. Pace the middle of the passage; many racers burn out on the opening sprint and fade in the final stretch.",
  },
  {
    id: "official-medium-11",
    difficulty: "medium",
 text: "Mute the engine roar if you need silence. Leave the countdown ticks on if you like drama. Either way the cars still move when your fingers do the real work.",
  },
  {
    id: "official-medium-12",
    difficulty: "medium",
 text: "A good race feels unfair in the best way: you knew the words were coming and somehow they still arrived faster than your hands. That gap is where practice lives.",
  },
  {
    id: "official-medium-13",
    difficulty: "medium",
 text: "Leaderboards chase peak verified speed, not vibes. One clean run on an official passage can put your name on the daily board until someone hungrier takes the crown.",
  },
  {
    id: "official-medium-14",
    difficulty: "medium",
 text: "Challenge a Friend is for people who already know each other. Sign in, send the invite, and settle the argument with a shared passage instead of another group chat boast.",
  },
  {
    id: "official-medium-15",
    difficulty: "medium",
 text: "Mid-race disconnects freeze your car where you left it. Everyone else keeps typing. Come back next round - the session remembers seats better than it remembers excuses.",
  },
  {
    id: "official-medium-16",
    difficulty: "medium",
 text: "The track is a straight shot drawn in light. Progress is characters correct divided by characters total. Fancy drifting is not a feature; clean typing is the only throttle.",
  },
  {
    id: "official-medium-17",
    difficulty: "medium",
 text: "Warm up on Race CPU when the queue is empty. Bots do not judge, and they do not queue for rematch. They simply refuse to mistype so you can chase a fair target.",
  },
  {
    id: "official-medium-18",
    difficulty: "medium",
 text: "Paste is blocked for a reason. If you cannot type it, you did not earn the meters. The cars know the difference even when the spectators do not.",
  },
  {
    id: "official-medium-19",
    difficulty: "medium",
 text: "Daily Champion wears a crown for twenty-four hours of bragging rights. Overall Champion keeps the cyan mark while holding the all-time peak. Status, not cash - on purpose.",
  },
  {
    id: "official-medium-20",
    difficulty: "medium",
 text: "Between races the lobby breathes. Someone copies the link. Someone adjusts their car color. Then Play Again counts five four three two one and the asphalt lights up again.",
  },
  {
    id: "official-medium-21",
    difficulty: "medium",
 text: "Phone keyboards fight you with autocorrect and capital letters. Turn them off for the race. Your thumbs deserve a fair shot against desktop players who grow up on mechanical switches.",
  },
  {
    id: "official-medium-22",
    difficulty: "medium",
 text: "Accuracy compounds. Ninety-eight percent feels almost perfect until you watch the leader open a gap on every recovery. Fix errors early; late backspaces cost more than pride.",
  },
  {
    id: "official-medium-23",
    difficulty: "medium",
 text: "The passage is the map. Read a breath ahead of where you type. Looking only at the next letter is how you miss punctuation and crash into a capital you never saw coming.",
  },
  {
    id: "official-medium-24",
    difficulty: "medium",
 text: "Guest runs can be claimed later when you finally make an account. Keep the tab alive through signup so your token still matches the races you already finished.",
  },
  {
    id: "official-medium-25",
    difficulty: "medium",
 text: "Eight cars is the Open Race ceiling. Six for Quick Race. Enough color on the track to feel like a pack without turning the screen into a traffic jam of nameplates.",
  },
  {
    id: "official-medium-26",
    difficulty: "medium",
 text: "Results are honest about placement. First gets the sting of victory; fourth still finished. Share the card if you want - the numbers do the talking without a speech.",
  },
  {
    id: "official-medium-27",
    difficulty: "medium",
 text: "Some nights you are untouchable. Some nights every comma is a trap. Both nights count toward the habit that makes the next week faster than the last.",
  },
  {
    id: "official-medium-28",
    difficulty: "medium",
 text: "The garage is not a vanity dashboard. It is a record of how your hands behaved across modes: solo practice, link races, matchmade nights, and the rare friend duel.",
  },
  {
    id: "official-medium-29",
    difficulty: "medium",
 text: "When the search timer runs out alone, try Open Race or Race CPU. Cold starts are real; the product will not invent fake opponents just to keep a spinner spinning.",
  },
  {
    id: "official-medium-30",
    difficulty: "medium",
 text: "Paint your car in cyan or magenta or signal yellow. The color will not make you faster, but it will make your lane unmistakable when the field packs tight near the finish.",
  },
  {
    id: "official-medium-31",
    difficulty: "medium",
 text: "Words arrive in waves. Short ones invite panic speed. Long ones demand patience. The racers who win treat both as the same job: one correct character after another.",
  },
  {
    id: "official-medium-32",
    difficulty: "medium",
 text: "You are always labeled You in your own view. Everyone else gets a name. That tiny courtesy keeps the track readable when eight people are moving at once.",
  },
  {
    id: "official-medium-33",
    difficulty: "medium",
 text: "Practice is not glamorous. It is repeating medium passages until your wrists stop arguing. Glamour is what spectators invent after you already did the boring work.",
  },
  {
    id: "official-medium-34",
    difficulty: "medium",
 text: "A rematch is a second chance with the same crew and a fresh passage. Accept it when you are hungry. Decline it when your hands are done for the night.",
  },
  {
    id: "official-medium-35",
    difficulty: "medium",
 text: "The asphalt theme is deliberate: dark ground, bright accents, no corporate purple haze. This is a night circuit for people who like the sound of keys more than the look of dashboards.",
  },
  {
    id: "official-medium-36",
    difficulty: "medium",
 text: "If you only remember one rule, remember this: backspace is cheaper early and expensive late. Clear the mistake, then resume the line like the interruption never happened.",
  },

  // —— hard (9) ——
  {
    id: "official-hard-01",
    difficulty: "hard",
 text: "Championship pacing demands composure under pressure: punctuation, capitalization, and odd letter pairs all arrive without warning. The leaders do not flinch; they settle into rhythm and convert keystrokes into meters of track until the finish line is inevitable.",
  },
  {
    id: "official-hard-02",
    difficulty: "hard",
 text: "When the countdown hits go, hesitation costs placement. Trust muscle memory, ignore the rearview mirror of mistakes already made, and chase the ghost of your personal best through every turn of the passage - commas, quotes, and all.",
  },
  {
    id: "official-hard-03",
    difficulty: "hard",
 text: "Hard passages are longer on purpose. They punish early reckless speed and reward racers who can hold form for two hundred characters without letting accuracy drip away. If your wrists tighten, soften them; tension is a silent throttle cut.",
  },
  {
    id: "official-hard-04",
    difficulty: "hard",
 text: "Consider the semicolon: a tiny pause that ruins a streak if you expect a comma. Consider the apostrophe in it's and its. Small symbols decide big races more often than any dramatic final sprint across the last ten words.",
  },
  {
    id: "official-hard-05",
    difficulty: "hard",
 text: "Multiplayer pressure invents new errors. You glance at an opponent's car, lose the next word, and spend three seconds recovering while they pull ahead. Train your eyes to stay on the text; the track will update without your supervision.",
  },
  {
    id: "official-hard-06",
    difficulty: "hard",
 text: "Verified finishes matter because unverified speed is theater. Keystroke timing, paste blocks, and shadow holds exist so boards stay believable. Cheat the system and you might win a moment; you will not keep a reputation worth sharing.",
  },
  {
    id: "official-hard-07",
    difficulty: "hard",
 text: "A full session can feel like a season in miniature: lobby chatter, a clean win, a messy rematch, a forfeit when someone closes a tab. Stay for the arc. The best nights are the ones where you improve between race one and race four.",
  },
  {
    id: "official-hard-08",
    difficulty: "hard",
 text: "Expert CPU opponents do not mistype for your ego. They simulate a target pace so you can practice under load. Use them to rehearse hard text, then take that composure into Open Race where humans will absolutely mistype - and you should not.",
  },
  {
    id: "official-hard-09",
    difficulty: "hard",
 text: "In the end the product is simple: type the passage, move the car, compare the numbers. Everything else - crowns, streaks, ratings, share cards - is scaffolding around that honest loop. Keep the loop sharp and the rest has somewhere real to stand.",
  },
];

async function main() {
  const ids = SEED.map((p) => p.id);

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

  // Legacy static-* rows may still be referenced by races — leave them for FK
  // integrity, but exclude from live picks (see pickPassage). Soft-retire easy.
  await db
    .update(passages)
    .set({ difficulty: "medium" })
    .where(inArray(passages.difficulty, ["easy"]));

  const medium = SEED.filter((p) => p.difficulty === "medium").length;
  const hard = SEED.filter((p) => p.difficulty === "hard").length;
  console.log(
    `Seeded ${SEED.length} official passages (${medium} medium / ${hard} hard). Live pool ids: ${ids.length}. Legacy rows kept if referenced.`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
