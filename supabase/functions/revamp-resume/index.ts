// revamp-resume: after the user beats stage bosses, rewrites their resume to include the skills they earned.
// Input  { plan_id, resume: { pdfBase64 } | { text } }   Output RevampedResume (see src/lib/types.ts)
// Errors { error } with 400 bad input, 404 not your plan, 409 no boss beaten yet (or no newly earned
// skill to add, e.g. a review-only plan), 502 the AI failed.
// The resume is never stored and never logged: it lives on the phone and passes through here once.
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, must, requireUserId } from "../_shared/supabase.ts";
import { classifySkills, generateRevamp, type PlanSkill } from "./revamp.ts";

const MAX_PDF_BASE64 = 7_000_000; // ~5 MB file

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  const body = await req.json().catch(() => null);
  const planId: string | undefined = body?.plan_id;
  const resume = body?.resume ?? {};

  if (!planId || typeof planId !== "string") throw new UserError("Missing plan_id.");
  const pdf: string | undefined = resume.pdfBase64;
  const resumeText: string | undefined = resume.text?.trim();
  if (!pdf && !resumeText) throw new UserError("Add your resume as a PDF or paste it as text.");
  if (pdf && pdf.length > MAX_PDF_BASE64) throw new UserError("That PDF is too big. Try a file under 5 MB.");
  if (resumeText && resumeText.length > 30000) throw new UserError("That resume text is too long.");

  // The plan must exist and belong to the caller. The message is the same either way.
  const planRes = await admin.from("plans").select("id, user_id, job_title, company").eq("id", planId).maybeSingle();
  if (planRes.error) throw new Error(`load plan: ${planRes.error.message}`);
  const plan = planRes.data;
  if (!plan || plan.user_id !== userId) throw new UserError("Plan not found.", 404);

  const skills = must(
    await admin.from("skills").select("id, name, is_gap, have_level").eq("plan_id", planId),
    "load skills",
  ) as PlanSkill[];
  const stages = must(
    await admin.from("stages").select("skill_id, levels(type, status)").eq("plan_id", planId),
    "load stages",
  ) as unknown as { skill_id: string; levels: { type: string; status: string }[] }[];

  // A stage is beaten when its boss level is completed (the same rule as the match percentage).
  const beaten = new Set(
    stages.filter((s) => s.levels.some((l) => l.type === "boss" && l.status === "completed")).map((s) => s.skill_id),
  );
  if (beaten.size === 0) throw new UserError("Beat a stage boss first, then your resume can be updated.", 409);

  // Only beaten GAP stages add skills. Review (polish) stages are skills the resume already shows, so
  // with nothing new to add there is no point spending an AI call.
  const rules = classifySkills(skills, beaten);
  if (rules.allowedNew.length === 0) {
    throw new UserError("There's nothing new to add to your resume yet. Beat the boss of a skill you're learning first.", 409);
  }

  const revamped = await generateRevamp({
    jobTitle: plan.job_title,
    company: plan.company,
    rules,
    pdfBase64: pdf,
    resumeText,
  });
  return json(revamped);
}));
