// create-plan: resume + job posting → skills, gaps, match % and a game map (stages → levels).
// Input  { resume: { pdfBase64 } | { text }, posting }   Output { plan_id }
// The resume itself is never stored, only the extracted skills.
// Speed: only STAGE 1 is designed here, so the map shows sooner. The other stages are saved as
// 'pending' and designed by the build-stage function while the player starts playing.
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, must, ok, requireUserId } from "../_shared/supabase.ts";
import { designStage, levelRows } from "../_shared/stage_builder.ts";
import { compareResumeToPosting, norm, pickStageSkills } from "./fit.ts";

const MAX_PDF_BASE64 = 7_000_000; // ~5 MB file
const MAX_GAP_STAGES = 3; // one stage per missing skill, never more than this

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  const body = await req.json().catch(() => null);
  const posting: string = (body?.posting ?? "").trim();
  const resume = body?.resume ?? {};

  if (posting.length < 80) throw new UserError("Paste the full job posting (at least a few sentences).");
  if (posting.length > 20000) throw new UserError("That job posting is too long. Paste just the description.");
  const pdf: string | undefined = resume.pdfBase64;
  const resumeText: string | undefined = resume.text?.trim();
  if (!pdf && !resumeText) throw new UserError("Add your resume as a PDF or paste it as text.");
  if (pdf && pdf.length > MAX_PDF_BASE64) throw new UserError("That PDF is too big. Try a file under 5 MB.");
  if (resumeText && resumeText.length > 30000) throw new UserError("That resume text is too long.");

  // 1-3. Read the posting, rate the resume against it, and work out the gaps (see fit.ts).
  const fit = await compareResumeToPosting({ posting, pdfBase64: pdf, resumeText });
  const { skills, match_pct: matchPct } = fit;

  // 4. Which skills become stages: the top gaps, or (if there are none) the skills to polish. See fit.ts.
  const { mode, skills: stageSkills } = pickStageSkills(skills, MAX_GAP_STAGES);

  // Design stage 1 only (one small Gemini call). Stages 2+ are built in the background (build-stage).
  const first = stageSkills[0]
    ? await designStage(fit.job_title, { name: stageSkills[0].name, have: stageSkills[0].have_level, need: stageSkills[0].need_level }, mode)
    : null;

  // 5. Insert everything.
  const plan = must(
    await admin.from("plans").insert({
      user_id: userId,
      job_title: (fit.job_title || "Your target role").slice(0, 120),
      company: fit.company?.slice(0, 120) || null,
      match_pct: matchPct,
      start_match_pct: matchPct,
    }).select("id").single(),
    "insert plan",
  );

  try {
    const insertedSkills = must(
      await admin.from("skills").insert(skills.map((s) => ({ ...s, plan_id: plan.id }))).select("id, name"),
      "insert skills",
    );
    const skillIdByName = new Map(insertedSkills.map((s) => [norm(s.name), s.id]));

    for (let i = 0; i < stageSkills.length; i++) {
      const gap = stageSkills[i];
      const built = i === 0 && first;
      const stage = must(
        await admin.from("stages").insert({
          plan_id: plan.id,
          skill_id: skillIdByName.get(norm(gap.name)),
          idx: i,
          title: built ? first.title : gap.name, // pending stages get their real title from build-stage
          summary: built ? first.summary : "",
          mode,
          status: built ? "ready" : "pending",
        }).select("id").single(),
        "insert stage",
      );
      if (built) ok(await admin.from("levels").insert(levelRows(stage.id, first, true)), "insert levels");
    }
  } catch (err) {
    await admin.from("plans").delete().eq("id", plan.id); // don't leave half a plan
    throw err;
  }

  return json({ plan_id: plan.id });
}));
