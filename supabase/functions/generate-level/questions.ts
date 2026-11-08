// Writes and checks the quiz questions for one level: Gemini writes them, code drops malformed ones, and a
// second Gemini call answers each one without the key so wrong or ambiguous questions are dropped.
// No database here, so it can be tested on its own.
import { callGemini } from "../_shared/gemini.ts";
import { UserError } from "../_shared/cors.ts";
import { questionsSchema, verifySchema, type DraftQuestion, type DraftQuestions, type Verification } from "../_shared/schemas.ts";
import { verifyQuestionsPrompt, writeQuestionsPrompt } from "../_shared/prompts.ts";
import { blankMatches } from "../_shared/grading.ts";
import { shuffleOptions } from "./shuffle.ts";

const COUNT = { normal: 5, challenge: 6, boss: 8 } as const;
const MIN = { normal: 4, challenge: 5, boss: 6 } as const;
const ABSOLUTE_MIN = 3;

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
    const draft = await callGemini<DraftQuestions>(
      writeQuestionsPrompt({ skill, type: level.type, title: level.title, objective: level.objective,
        concepts: level.concepts, weakConcepts, earlierLevels, position, count: target }),
      questionsSchema, [], 0.8,
    );
    const valid = (draft.questions ?? []).map(cleanQuestion).filter((q): q is DraftQuestion => q !== null);
    const verified = await verify(valid);
    report?.({ round, written: draft.questions?.length ?? 0, wellFormed: valid.length, verified: verified.length });
    // Keep the best round's results, avoiding duplicate prompts.
    const seen = new Set(kept.map((q) => q.prompt));
    kept = [...kept, ...verified.filter((q) => !seen.has(q.prompt))];
  }

  if (kept.length < ABSOLUTE_MIN) {
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
  };
  if (q.kind === "mcq") {
    const options = (q.options ?? []).map((o) => String(o).trim());
    const ci = q.correct_index;
    if (options.length !== 4 || options.some((o) => !o) || new Set(options).size !== 4) return null;
    if (ci === null || ci === undefined || ci < 0 || ci > 3) return null;
    // Gemini tends to put the right answer in the same spot, so shuffle here (before verification sees it).
    const shuffled = shuffleOptions(options, ci);
    return { ...base, kind: "mcq", options: shuffled.options, correct_index: shuffled.correct_index, answers: null };
  }
  if (q.kind === "blank") {
    const answers = (q.answers ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, 4);
    if ((prompt.match(/____/g) ?? []).length !== 1 || answers.length === 0) return null;
    return { ...base, kind: "blank", options: null, correct_index: null, answers };
  }
  return null;
}

/** Second Gemini call answers each question without the key; keep only questions it gets right. */
async function verify(questions: DraftQuestion[]): Promise<DraftQuestion[]> {
  if (questions.length === 0) return [];
  const check = await callGemini<Verification>(
    verifyQuestionsPrompt(questions.map((q, idx) => ({ idx, kind: q.kind, prompt: q.prompt, options: q.options }))),
    verifySchema, [], 0,
  );
  const byIdx = new Map(check.answers.map((a) => [a.idx, a]));
  return questions.filter((q, idx) => {
    const a = byIdx.get(idx);
    if (!a) return false;
    if (q.kind === "mcq") return a.mcq_index === q.correct_index;
    return a.blank_answer != null && blankMatches(a.blank_answer, q.answers ?? []);
  });
}
