// generate-level: writes and verifies a level's questions (Gemini) and finds resources (Keenable).
// Input { level_id }   Output { ok: true }
// Idempotent: if the level is already generated, returns immediately.
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, must, ok, requireUserId } from "../_shared/supabase.ts";
import { callGemini } from "../_shared/gemini.ts";
import { searchResources } from "../_shared/keenable.ts";
import { questionsSchema, verifySchema, type DraftQuestion, type DraftQuestions, type Verification } from "../_shared/schemas.ts";
import { verifyQuestionsPrompt, writeQuestionsPrompt } from "../_shared/prompts.ts";
import { blankMatches } from "../_shared/grading.ts";

const COUNT = { normal: 5, challenge: 6, boss: 8 } as const;
const MIN = { normal: 4, challenge: 5, boss: 6 } as const;
const ABSOLUTE_MIN = 3;

type LevelType = keyof typeof COUNT;

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  const body = await req.json().catch(() => null);
  const levelId: string | undefined = body?.level_id;
  if (!levelId) throw new UserError("Missing level_id.");

  // Load the level + stage + skill + plan, and check the caller owns it.
  const levelRes = await admin.from("levels")
      .select("id, type, title, objective, concepts, generated, stage:stages!inner(id, plan_id, skill:skills!inner(name), plan:plans!inner(user_id))")
      .eq("id", levelId).maybeSingle();
  if (levelRes.error) throw new Error(`load level: ${levelRes.error.message}`);
  const level = levelRes.data as unknown as {
    id: string; type: LevelType; title: string; objective: string; concepts: string[]; generated: boolean;
    stage: { id: string; plan_id: string; skill: { name: string }; plan: { user_id: string } };
  } | null;
  if (!level || level.stage.plan.user_id !== userId) throw new UserError("Level not found.", 404);
  if (level.generated) return json({ ok: true });

  const weakConcepts = await findWeakConcepts(userId, level.stage.plan_id);
  const skill = level.stage.skill.name;

  // Questions (write + verify) and resources run in parallel.
  const [questions, resources] = await Promise.all([
    makeQuestions(level, skill, weakConcepts),
    searchResources(`${skill} ${level.objective} tutorial`),
  ]);

  // Another request may have finished first (prefetch + open at the same time).
  const again = must(await admin.from("levels").select("generated").eq("id", levelId).single(), "recheck level");
  if (again.generated) return json({ ok: true });

  ok(await admin.from("questions").insert(questions.map((q, idx) => ({ ...q, level_id: levelId, idx }))), "insert questions");
  if (resources.length) {
    ok(await admin.from("resources").insert(resources.map((r) => ({ ...r, level_id: levelId }))), "insert resources");
  }
  ok(await admin.from("levels").update({ generated: true }).eq("id", levelId), "mark generated");
  return json({ ok: true });
}));

/** Concepts the user answered wrong anywhere in this plan (most frequent first, max 4). */
async function findWeakConcepts(userId: string, planId: string): Promise<string[]> {
  const res = await admin
    .from("attempts")
    .select("question:questions!inner(concept, level:levels!inner(stage:stages!inner(plan_id)))")
    .eq("user_id", userId)
    .eq("correct", false)
    .eq("question.level.stage.plan_id", planId)
    .limit(200);
  if (res.error) {
    console.warn("weak concepts query failed:", res.error.message);
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of res.data as unknown as { question: { concept: string } }[]) {
    const c = row.question?.concept?.trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
}

/** Writes questions, drops malformed ones, verifies answers with a second call; regenerates once if too few survive. */
async function makeQuestions(
  level: { type: LevelType; title: string; objective: string; concepts: string[] },
  skill: string,
  weakConcepts: string[],
): Promise<DraftQuestion[]> {
  const target = COUNT[level.type];
  let kept: DraftQuestion[] = [];

  for (let round = 1; round <= 2 && kept.length < MIN[level.type]; round++) {
    const draft = await callGemini<DraftQuestions>(
      writeQuestionsPrompt({ skill, type: level.type, title: level.title, objective: level.objective,
        concepts: level.concepts, weakConcepts, count: target }),
      questionsSchema, [], 0.8,
    );
    const valid = (draft.questions ?? []).map(cleanQuestion).filter((q): q is DraftQuestion => q !== null);
    const verified = await verify(valid);
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
    return { ...base, kind: "mcq", options, correct_index: ci, answers: null };
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
