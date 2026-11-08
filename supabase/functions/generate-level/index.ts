// generate-level: writes and verifies a level's questions (Gemini) and finds resources (Keenable).
// Input { level_id }   Output { ok: true }
// - Idempotent: if the level is already generated, returns immediately.
// - One writer per level: the request atomically claims the level (levels.generating_at, migration 007).
//   Another request while the claim is held gets a retryable 503 { error, status: "generating" }; the app
//   retries after 5 s and 20 s. A claim older than 90 s is treated as abandoned and can be taken over.
// - Questions, resources and generated=true are saved in one transaction (save_level_content), which
//   writes nothing if the level was already saved, so a level can never get two sets of questions.
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, requireUserId } from "../_shared/supabase.ts";
import { findResources } from "../_shared/resources.ts";
import { makeQuestions, type LevelType } from "./questions.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_CLAIM_MS = 90_000;
const IN_PROGRESS_MESSAGE = "This level's questions are still being written. Trying again in a moment.";

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  const body = await req.json().catch(() => null);
  const levelId = typeof body?.level_id === "string" ? body.level_id : "";
  if (!levelId) throw new UserError("Missing level_id.");
  if (!UUID_RE.test(levelId)) throw new UserError("Invalid level_id.");

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

  // Claim the level atomically: only one request writes its questions.
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const claim = await admin.from("levels")
    .update({ generating_at: claimedAt })
    .eq("id", levelId)
    .eq("generated", false)
    .or(`generating_at.is.null,generating_at.lt.${staleBefore}`)
    .select("id");
  if (claim.error) throw new Error(`claim level: ${claim.error.message}`);
  if (!claim.data?.length) {
    // Either another request holds the claim, or it just finished.
    const now = await admin.from("levels").select("generated").eq("id", levelId).maybeSingle();
    if (now.data?.generated) return json({ ok: true });
    return json({ error: IN_PROGRESS_MESSAGE, status: "generating" }, 503);
  }

  try {
    const skill = level.stage.skill.name;
    const [weakConcepts, stageLevels] = await Promise.all([
      findWeakConcepts(userId, level.stage.id),
      loadStageLevels(level.stage.id),
    ]);
    // The boss is the final exam for its stage, so it needs to know what the earlier levels (1 and 2) taught.
    const fundamentals = stageLevels.filter((l) => l.type !== "boss" && l.idx < level.idx);
    const earlierLevels = level.type === "boss" ? fundamentals : [];
    // A fundamentals level knows its place in the stage, so early levels are easier than later ones.
    const fundamentalsCount = stageLevels.filter((l) => l.type !== "boss").length;
    const position = level.type === "boss" ? undefined : { n: level.idx + 1, of: Math.max(fundamentalsCount, level.idx + 1) };

    // Questions (write + verify) and resources run in parallel. Only normal levels show resources in the app.
    const [questions, resources] = await Promise.all([
      makeQuestions(level, skill, weakConcepts, earlierLevels, position),
      level.type === "normal"
        ? findResources({ skill, title: level.title, objective: level.objective, concepts: level.concepts })
        : Promise.resolve([]),
    ]);

    // One transaction: questions + resources + generated=true, or nothing if another request saved first.
    const saved = await admin.rpc("save_level_content", {
      p_level_id: levelId,
      p_questions: questions,
      p_resources: resources.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
    });
    if (saved.error) throw new Error(`save level: ${saved.error.message}`);
    return json({ ok: true });
  } catch (err) {
    // Let the next request (the app's retry) try again straight away.
    await admin.from("levels").update({ generating_at: null })
      .eq("id", levelId).eq("generating_at", claimedAt).eq("generated", false);
    throw err;
  }
}));

/** Every level in a stage, in play order. */
async function loadStageLevels(stageId: string): Promise<{ idx: number; type: LevelType; title: string; concepts: string[] }[]> {
  const res = await admin.from("levels").select("idx, type, title, concepts").eq("stage_id", stageId).order("idx");
  if (res.error) {
    console.warn("stage levels query failed:", res.error.message);
    return [];
  }
  return (res.data ?? []).map((l) => ({ idx: l.idx, type: l.type as LevelType, title: l.title, concepts: l.concepts ?? [] }));
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
