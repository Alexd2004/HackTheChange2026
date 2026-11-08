// build-stage: designs one 'pending' stage of a plan (title, summary, 3 levels) in the background,
// after create-plan already showed the map with stage 1.
// Input { stage_id }   Output { ok: true, status: "ready" | "building" }
// - Safe to call twice: one call claims the stage ('building'), the other just reports it.
//   A claim older than 90 s is treated as abandoned (e.g. a timeout) and can be retried.
// - If the player already beat the previous stage's boss, this stage's first level is unlocked.
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, must, ok, requireUserId } from "../_shared/supabase.ts";
import { designStage, levelRows } from "../_shared/stage_builder.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_CLAIM_MS = 90_000;

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  const body = await req.json().catch(() => null);
  const stageId = String(body?.stage_id ?? "");
  if (!UUID_RE.test(stageId)) throw new UserError("Missing or invalid stage_id.");

  const res = await admin.from("stages")
    .select("id, idx, plan_id, status, mode, building_at, skill:skills!inner(name, have_level, need_level), plan:plans!inner(user_id, job_title)")
    .eq("id", stageId).maybeSingle();
  if (res.error) throw new Error(`load stage: ${res.error.message}`);
  const stage = res.data as unknown as {
    id: string; idx: number; plan_id: string; status: string; mode: "gap" | "polish"; building_at: string | null;
    skill: { name: string; have_level: number; need_level: number }; plan: { user_id: string; job_title: string };
  } | null;
  if (!stage || stage.plan.user_id !== userId) throw new UserError("Stage not found.", 404);
  if (stage.status === "ready") return json({ ok: true, status: "ready" });

  // Claim it atomically: only one request designs the stage.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const claim = await admin.from("stages")
    .update({ status: "building", building_at: new Date().toISOString() })
    .eq("id", stageId)
    .or(`status.eq.pending,and(status.eq.building,building_at.lt.${staleBefore})`)
    .select("id");
  if (claim.error) throw new Error(`claim stage: ${claim.error.message}`);
  if (!claim.data?.length) return json({ ok: true, status: "building" }); // someone else is on it

  try {
    const designed = await designStage(
      stage.plan.job_title,
      { name: stage.skill.name, have: stage.skill.have_level, need: stage.skill.need_level },
      stage.mode,
    );

    // Unlock level 1 if the previous stage's boss is already beaten (the player got here first).
    const prev = await admin.from("levels")
      .select("id, stage:stages!inner(plan_id, idx)")
      .eq("stage.plan_id", stage.plan_id).eq("stage.idx", stage.idx - 1)
      .eq("type", "boss").eq("status", "completed").limit(1);
    if (prev.error) throw new Error(`check previous boss: ${prev.error.message}`);
    const unlockFirst = stage.idx === 0 || (prev.data?.length ?? 0) > 0;

    // Never insert twice (e.g. a stale claim that finished after all).
    const existing = must(await admin.from("levels").select("id").eq("stage_id", stageId), "check levels");
    if (existing.length === 0) ok(await admin.from("levels").insert(levelRows(stageId, designed, unlockFirst)), "insert levels");

    // The player may have beaten the previous boss while we were designing: check again and unlock.
    if (!unlockFirst) {
      const again = await admin.from("levels")
        .select("id, stage:stages!inner(plan_id, idx)")
        .eq("stage.plan_id", stage.plan_id).eq("stage.idx", stage.idx - 1)
        .eq("type", "boss").eq("status", "completed").limit(1);
      if (again.data?.length) {
        ok(await admin.from("levels").update({ status: "unlocked" })
          .eq("stage_id", stageId).eq("idx", 0).eq("status", "locked"), "unlock first level");
      }
    }

    ok(await admin.from("stages").update({
      title: designed.title, summary: designed.summary, status: "ready", building_at: null,
    }).eq("id", stageId), "mark stage ready");
    return json({ ok: true, status: "ready" });
  } catch (err) {
    await admin.from("stages").update({ status: "pending", building_at: null }).eq("id", stageId); // let it be retried
    throw err;
  }
}));
