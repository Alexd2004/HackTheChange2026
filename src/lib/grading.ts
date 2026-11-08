// Game rules in plain code: grading answers, pass marks, XP, timers and boss fights.
// The AI never grades. Keep normalizeAnswer() in sync with supabase/functions/_shared/grading.ts.
import type { LevelType, Question } from "./types";

export const PASS_PCT = 60;

/**
 * Admin/testing bypass: EXPO_PUBLIC_ADMIN_BYPASS=1 makes every finished level count as passed, even
 * under 60% or after losing a boss fight (the server is sent at least the pass mark). For testing and
 * demos only: EXPO_PUBLIC_ values are built into the app, so never ship a build with this on.
 */
export const ADMIN_BYPASS = process.env.EXPO_PUBLIC_ADMIN_BYPASS === "1";
export const XP_PER_CORRECT = 10;
export const BOSS_HEARTS = 3;

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

/** `answer` is the option index for mcq, or the typed text for blank. null = no answer (timed out). */
export function isCorrect(q: Question, answer: number | string | null): boolean {
  if (answer === null) return false;
  if (q.kind === "mcq") return typeof answer === "number" && answer === q.correct_index;
  if (typeof answer !== "string") return false;
  const given = normalizeAnswer(answer);
  return given.length > 0 && (q.answers ?? []).some((a) => normalizeAnswer(a) === given);
}

/** The answer to show after a wrong attempt. */
export function correctAnswerText(q: Question): string {
  if (q.kind === "mcq") return q.options?.[q.correct_index ?? 0] ?? "";
  return q.answers?.[0] ?? "";
}

export function scorePct(correct: number, total: number): number {
  return total ? Math.round((100 * correct) / total) : 0;
}

export function xpMultiplier(type: LevelType): number {
  return type === "challenge" ? 2 : type === "boss" ? 3 : 1;
}

export function xpFor(correct: number, type: LevelType): number {
  return correct * XP_PER_CORRECT * xpMultiplier(type);
}

/** Seconds per question in challenge mode (accessibility setting doubles it). */
export function challengeSeconds(extendedTime: boolean): number {
  return extendedTime ? 40 : 20;
}

/** Boss HP = correct answers needed to win (60% of the questions, so a win always passes). */
export function bossMaxHp(questionCount: number): number {
  return Math.max(1, Math.ceil(questionCount * (PASS_PCT / 100)));
}

/**
 * Hearts = wrong answers you can afford + 1, so running out of hearts is exactly the moment the boss
 * can no longer be beaten (4 questions: 3 hits needed, 2 hearts). Capped at BOSS_HEARTS.
 */
export function bossHearts(questionCount: number): number {
  return Math.max(1, Math.min(BOSS_HEARTS, questionCount - bossMaxHp(questionCount) + 1));
}

const GENERIC_HINT = "Re-read the question and think about what it is really asking.";

/**
 * A hint for normal levels that never gives the answer away: the AI-written hint (checked on the
 * server), plus one wrong option removed for multiple choice. No first letters, and no concept name
 * (for fill-in-the-blank the concept is often the answer itself).
 */
export function hintFor(q: Question): { text: string; hiddenOption: number | null } {
  const text = q.hint?.trim() || GENERIC_HINT;
  if (q.kind === "mcq" && q.options) {
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correct_index);
    const hidden = wrong[(q.idx + 1) % wrong.length];
    return { text: `${text} (One wrong option removed.)`, hiddenOption: hidden };
  }
  return { text, hiddenOption: null };
}
