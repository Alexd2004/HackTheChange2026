// Writes and checks the quiz questions for one level: Gemini writes them, code drops malformed ones, and a
// second Gemini call answers each one without the key so wrong or ambiguous questions are dropped.
// No database here, so it can be tested on its own.
import { callGemini, lightModel } from "../_shared/gemini.ts";
import { UserError } from "../_shared/cors.ts";
import { questionsSchema, verifySchema, type DraftQuestion, type DraftQuestions, type Verification } from "../_shared/schemas.ts";
import { verifyQuestionsPrompt, writeQuestionsPrompt } from "../_shared/prompts.ts";
import { blankMatches } from "../_shared/grading.ts";
import { shuffleOptions } from "./shuffle.ts";

// Questions a level ends up with. The boss (the stage's final exam) has more.
const COUNT = { normal: 4, challenge: 4, boss: 6 } as const;
// Fewer than MIN after round 1 and we write a second round.
const MIN = { normal: 3, challenge: 3, boss: 5 } as const;
// Fewer than this after both rounds and the level fails (the app retries).
const ABSOLUTE_MIN = { normal: 3, challenge: 3, boss: 4 } as const;
// Round 1 asks for a few spare questions, so a dropped question rarely costs a second round (2 more calls).
const EXTRA_FIRST_ROUND = 2;

export type LevelType = keyof typeof COUNT;

/** What one writing round produced. */
export interface QuestionRound {
  round: number;
  written: number; // questions Gemini wrote
  wellFormed: number; // left after the structural checks
  verified: number; // left after the second Gemini call agreed with the answer key
}

/** Writes questions, drops malformed ones, verifies answers with a second call; regenerates once if too few survive. */
export async function makeQuestions(
  level: { type: LevelType; title: string; objective: string; concepts: string[] },
  skill: string,
  weakConcepts: string[],
  earlierLevels: { title: string; concepts: string[] }[],
  position: { n: number; of: number } | undefined,
  report?: (round: QuestionRound) => void, // optional: lets a test see how many questions each step dropped
): Promise<DraftQuestion[]> {
  const target = COUNT[level.type];
  let kept: DraftQuestion[] = [];

  for (let round = 1; round <= 2 && kept.length < MIN[level.type]; round++) {
    let draft: DraftQuestions;
    try {
      draft = await callGemini<DraftQuestions>(
        writeQuestionsPrompt({ skill, type: level.type, title: level.title, objective: level.objective,
          concepts: level.concepts, weakConcepts, earlierLevels, position,
          count: round === 1 ? target + EXTRA_FIRST_ROUND : target }),
        questionsSchema, [], 0.8,
      );
    } catch (err) {
      // Round 2 is only a top-up: if it fails, round 1's questions are still good enough to play.
      if (round > 1 && kept.length >= ABSOLUTE_MIN[level.type]) {
        console.warn(`second question round failed, keeping ${kept.length} questions:`, err instanceof Error ? err.message : err);
        break;
      }
      throw err;
    }
    const valid = (draft.questions ?? []).map(cleanQuestion).filter((q): q is DraftQuestion => q !== null);
    const verified = await verify(valid);
    report?.({ round, written: draft.questions?.length ?? 0, wellFormed: valid.length, verified: verified.length });
    // Keep the best round's results, avoiding duplicate prompts.
    const seen = new Set(kept.map((q) => q.prompt));
    kept = [...kept, ...verified.filter((q) => !seen.has(q.prompt))];
  }

  if (kept.length < ABSOLUTE_MIN[level.type]) {
    throw new UserError("The AI couldn't write good questions for this level. Please try again.", 502);
  }
  return kept.slice(0, target);
}

/** Structural checks the AI must pass before verification. */
function cleanQuestion(q: DraftQuestion): DraftQuestion | null {
  const prompt = q.prompt?.trim();
  if (!prompt) return null;
  const base = {
    prompt,
    explanation: q.explanation?.trim() || "",
    concept: q.concept?.trim() || "",
    difficulty: Math.min(3, Math.max(1, Math.round(q.difficulty || 1))),
    hint: "", // filled in below once we know the answer
  };
  if (q.kind === "mcq") {
    const options = (q.options ?? []).map((o) => String(o).trim());
    const ci = q.correct_index;
    if (options.length !== 4 || options.some((o) => !o) || new Set(options).size !== 4) return null;
    if (ci === null || ci === undefined || ci < 0 || ci > 3) return null;
    // Gemini tends to put the right answer in the same spot, so shuffle here (before verification sees it).
    const shuffled = shuffleOptions(options, ci);
    const hint = safeHint(q.hint, [options[ci]], base.concept, prompt, options.filter((_, k) => k !== ci));
    return { ...base, hint, kind: "mcq", options: shuffled.options, correct_index: shuffled.correct_index, answers: null };
  }
  if (q.kind === "blank") {
    const answers = (q.answers ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 4);
    if ((prompt.match(/____/g) ?? []).length !== 1 || answers.length === 0) return null;
    const hint = safeHint(q.hint, answers, base.concept, prompt);
    return { ...base, hint, kind: "blank", options: null, correct_index: null, answers };
  }
  return null;
}

/**
 * Second Gemini call answers each question without the key; keep only questions it gets right.
 * If the check itself fails (rate limit, timeout, server error, unreadable reply), the well-formed questions
 * are kept unchecked rather than throwing away the call that wrote them.
 */
async function verify(questions: DraftQuestion[]): Promise<DraftQuestion[]> {
  if (questions.length === 0) return [];
  let check: Verification;
  try {
    check = await callGemini<Verification>(
      verifyQuestionsPrompt(questions.map((q, idx) => ({ idx, kind: q.kind, prompt: q.prompt, options: q.options }))),
      verifySchema, [], 0,
      { model: lightModel }, // a separate daily quota from the writing model
    );
    if (!Array.isArray(check?.answers)) throw new Error("no answers in the verify reply");
  } catch (err) {
    console.warn(`verify call failed, keeping ${questions.length} unverified questions:`, err instanceof Error ? err.message : err);
    return questions;
  }
  const byIdx = new Map(check.answers.map((a) => [a.idx, a]));
  return questions.filter((q, idx) => {
    const a = byIdx.get(idx);
    if (!a) return false;
    if (q.kind === "mcq") return a.mcq_index === q.correct_index;
    return a.blank_answer != null && blankMatches(a.blank_answer, q.answers ?? []);
  });
}

// ---------------------------------------------------------------- hints

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const GENERIC_HINT = "Re-read the question and think about what it is really asking.";
// Everyday words that don't give anything away even if they appear in the answer.
const STOPWORDS = new Set([
  "that", "this", "with", "from", "only", "rows", "into", "when", "what", "which", "will", "your", "have",
  "both", "each", "more", "than", "then", "them", "they", "their", "there", "where", "about", "using", "used",
  "data", "table", "tables", "value", "values", "first", "last", "same", "other", "make", "made",
]);
/** A word and its simple plural / singular forms ("index" ~ "indexes"). */
const forms = (w: string) => [w, `${w}s`, `${w}es`, w.replace(/e?s$/, "")];

/** True when `text` gives away one of the answers (ignoring words the player can already see). */
function leaks(text: string, answers: string[], prompt: string, wrongOptions: string[] = []): boolean {
  const t = ` ${norm(text)} `;
  const raw = ` ${text.toLowerCase()} `;
  const known = new Set(norm(prompt).split(" ")); // words already in the question
  const shared = new Set(wrongOptions.flatMap((o) => norm(o).split(" "))); // words in wrong options too
  for (const a of answers) {
    const ans = norm(a);
    // Symbol answers ("*", "!=", "%") vanish when normalized: look for the raw symbol instead.
    if (!ans) {
      const sym = a.trim().toLowerCase();
      if (sym && raw.includes(sym) && !prompt.toLowerCase().includes(sym)) return true;
      continue;
    }
    if (t.includes(` ${ans} `)) return true; // the whole answer
    const words = ans.split(" ");
    for (const w of words) {
      if (known.has(w) || shared.has(w) || STOPWORDS.has(w)) continue;
      const distinctive = w.length >= 4 || (words.length === 1 && w.length >= 2); // short single-word answers ("ON", "GET")
      if (distinctive && forms(w).some((f) => t.includes(` ${f} `))) return true;
    }
  }
  return false;
}

/** Trims to `max` characters at a word boundary. */
function trimWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max).replace(/[,;:\s]+$/, "")}…`;
}

/**
 * The AI writes a hint that must not reveal the answer. This double-checks it: if the hint contains the
 * answer, or hands out letters/length/option positions, it's replaced by a safe nudge (checked too).
 * `wrongOptions` (MCQ only) lets words shared with wrong options through, since they give nothing away.
 */
export function safeHint(raw: string | undefined, answers: string[], concept: string, prompt: string, wrongOptions: string[] = []): string {
  // Only name the concept when it shares no word with the answer (often the concept IS the answer).
  const conceptWords = norm(concept).split(" ").filter(Boolean);
  const answerWords = new Set(answers.flatMap((a) => norm(a).split(" ")));
  const conceptIsSafe = conceptWords.length > 0 && !conceptWords.some((w) => forms(w).some((f) => answerWords.has(f)));
  const fallback = conceptIsSafe ? `Think about how ${concept} works.` : GENERIC_HINT;
  const hint = trimWords((raw ?? "").replace(/\s+/g, " ").trim(), 140);
  if (!hint) return fallback;
  if (leaks(hint, answers, prompt, wrongOptions)) return fallback;
  if (/\b(first letter|starts with|begins with|ends with|letters? long|rhymes with|\d+ (letters|characters))\b/i.test(hint)) return fallback;
  if (/\b(the )?answer is\b|\b(option|answer|choice) ([a-d]|one|two|three|four|\d)\b|\b[a-d]\) |\b(first|second|third|fourth|last) (option|choice|answer)\b/i.test(hint)) return fallback;
  return hint;
}
