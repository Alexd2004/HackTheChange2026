// Answer normalizing for fill-in-the-blank checks on the server (verification step).
// Keep in sync with normalizeAnswer() in src/lib/grading.ts.

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export function blankMatches(given: string, accepted: string[]): boolean {
  const g = normalizeAnswer(given);
  return accepted.some((a) => normalizeAnswer(a) === g);
}
