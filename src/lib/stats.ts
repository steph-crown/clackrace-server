export type Keystroke = { charIndex: number; timestampMs: number };

/** Server-authoritative WPM from keystroke log (never trust client WPM). */
export function wpmFromKeystrokes(
  keystrokes: Keystroke[],
  passageLength: number,
): number {
  if (keystrokes.length === 0 || passageLength <= 0) return 0;
  const correctChars = Math.min(keystrokes.length, passageLength);
  const last = keystrokes[keystrokes.length - 1]!;
  const durationMs = last.timestampMs;
  if (durationMs <= 0) return 0;
  return correctChars / 5 / (durationMs / 60000);
}

export function accuracyFromMistakes(
  correctChars: number,
  mistakes: number,
): number {
  const attempts = correctChars + mistakes;
  if (attempts <= 0) return 100;
  return (correctChars / attempts) * 100;
}
