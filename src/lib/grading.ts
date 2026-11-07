// Game rules in plain code: grading answers, pass marks, XP, timers and boss fights.
// The AI never grades. Keep normalizeAnswer() in sync with supabase/functions/_shared/grading.ts.
import type { LevelType, Question } from "./types";

export const PASS_PCT = 60;
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

/** A hint for normal levels: hides one wrong option (mcq) or reveals the first letter (blank). */
export function hintFor(q: Question): { text: string; hiddenOption: number | null } {
  if (q.kind === "mcq" && q.options) {
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correct_index);
    const hidden = wrong[(q.idx + 1) % wrong.length];
    return { text: `Concept: ${q.concept}. One wrong option removed.`, hiddenOption: hidden };
  }
  const first = q.answers?.[0]?.trim()[0] ?? "";
  return { text: `Concept: ${q.concept}. Starts with "${first.toUpperCase()}".`, hiddenOption: null };
}
