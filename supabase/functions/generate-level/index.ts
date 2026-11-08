// generate-level: writes and verifies a level's questions (Gemini) and finds resources (Keenable).
// Input { level_id }   Output { ok: true }
// Idempotent: if the level is already generated, returns immediately.
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, must, ok, requireUserId } from "../_shared/supabase.ts";
import { findResources } from "../_shared/resources.ts";
import { makeQuestions, type LevelType } from "./questions.ts";

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  const body = await req.json().catch(() => null);
  const levelId: string | undefined = body?.level_id;
  if (!levelId) throw new UserError("Missing level_id.");

  // Load the level + stage + skill + plan, and check the caller owns it.
  const levelRes = await admin.from("levels")
      .select("id, idx, type, title, objective, concepts, generated, stage:stages!inner(id, plan_id, skill:skills!inner(name), plan:plans!inner(user_id))")
      .eq("id", levelId).maybeSingle();
  if (levelRes.error) throw new Error(`load level: ${levelRes.error.message}`);
  const level = levelRes.data as unknown as {
    id: string; idx: number; type: LevelType; title: string; objective: string; concepts: string[]; generated: boolean;
    stage: { id: string; plan_id: string; skill: { name: string }; plan: { user_id: string } };
  } | null;
  if (!level || level.stage.plan.user_id !== userId) throw new UserError("Level not found.", 404);
  if (level.generated) return json({ ok: true });

  const skill = level.stage.skill.name;
  const [weakConcepts, stageLevels] = await Promise.all([
    findWeakConcepts(userId, level.stage.id),
    loadStageLevels(level.stage.id),
  ]);
  const fundamentals = stageLevels.filter((l) => l.type !== "boss");
  // The boss is the final exam for its stage, so it needs to know what the earlier levels taught.
  const earlierLevels = level.type === "boss" ? fundamentals : [];
  // A fundamentals level knows its place in the stage, so early levels are easier than later ones.
  const position = level.type === "boss" ? undefined : { n: level.idx + 1, of: fundamentals.length };

  // Questions (write + verify) and resources run in parallel. Only normal levels show resources in the app.
  const [questions, resources] = await Promise.all([
    makeQuestions(level, skill, weakConcepts, earlierLevels, position),
    level.type === "normal"
      ? findResources({ skill, title: level.title, objective: level.objective, concepts: level.concepts })
      : Promise.resolve([]),
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

/** Every level in a stage, in play order. */
async function loadStageLevels(stageId: string): Promise<{ type: LevelType; title: string; concepts: string[] }[]> {
  const res = await admin.from("levels").select("type, title, concepts").eq("stage_id", stageId).order("idx");
  if (res.error) {
    console.warn("stage levels query failed:", res.error.message);
    return [];
  }
  return (res.data ?? []).map((l) => ({ type: l.type as LevelType, title: l.title, concepts: l.concepts ?? [] }));
}

/** Concepts the user answered wrong in this stage (most frequent first, max 4). Other stages teach other skills. */
async function findWeakConcepts(userId: string, stageId: string): Promise<string[]> {
  const res = await admin
    .from("attempts")
    .select("question:questions!inner(concept, level:levels!inner(stage_id))")
    .eq("user_id", userId)
    .eq("correct", false)
    .eq("question.level.stage_id", stageId)
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
