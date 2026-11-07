// compareResumeToPosting: reads the job posting, rates the resume against each skill it asks for,
// then does the gap math in plain code. No database here, so it can be tested on its own.
import { callGemini, type Part } from "../_shared/gemini.ts";
import { UserError } from "../_shared/cors.ts";
import { postingSchema, ratingsSchema, type PostingSkills, type ResumeRatings } from "../_shared/schemas.ts";
import { extractPostingPrompt, rateResumePrompt } from "../_shared/prompts.ts";

const MAX_POSTING_SKILLS = 12;

export interface FitSkill {
  name: string;
  weight: number;
  required: boolean;
  have_level: number; // 0-3 from the resume
  need_level: number; // 1-3 from the posting
  is_gap: boolean;
}

export interface Fit {
  job_title: string;
  company: string | null;
  skills: FitSkill[];
  match_pct: number;
}

export const norm = (s: string) => s.toLowerCase().trim();
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

export async function compareResumeToPosting(
  input: { posting: string; pdfBase64?: string; resumeText?: string },
): Promise<Fit> {
  // 1. Read the posting: which skills does the job ask for?
  const postingOut = await callGemini<PostingSkills>(extractPostingPrompt(input.posting), postingSchema, [], 0.1);
  const postingSkills = dedupe(postingOut.skills ?? [], (s) => norm(s.name)).slice(0, MAX_POSTING_SKILLS);
  if (postingSkills.length === 0) {
    throw new UserError("We couldn't find any skills in that posting. Is it the full description?");
  }

  // 2. Rate the resume against that numbered list. Ratings come back by number, not by name.
  const resumeParts: Part[] = input.pdfBase64
    ? [{ inlineData: { mimeType: "application/pdf", data: input.pdfBase64 } }]
    : [];
  const rated = await callGemini<ResumeRatings>(
    rateResumePrompt(postingSkills.map((s) => s.name), input.pdfBase64 ? undefined : input.resumeText),
    ratingsSchema, resumeParts, 0.1,
  );
  const haveByNumber = new Map<number, number>();
  for (const r of rated.ratings ?? []) {
    if (!haveByNumber.has(r.n)) haveByNumber.set(r.n, clamp(r.have_level, 0, 3));
  }
  console.log(`rateResume: rated ${postingSkills.filter((_, i) => haveByNumber.has(i + 1)).length} of ${postingSkills.length} skills`);

  // 3. Gap math in code. A skill the AI forgot to rate counts as 0.
  const skills: FitSkill[] = postingSkills.map((p, i) => {
    const have = haveByNumber.get(i + 1) ?? 0;
    const need = clamp(p.need_level, 1, 3);
    return {
      name: p.name.trim(),
      weight: clamp(p.weight, 1, 3),
      required: !!p.required,
      have_level: have,
      need_level: need,
      is_gap: have < need,
    };
  });

  const totalWeight = skills.reduce((a, s) => a + s.weight, 0);
  const haveWeight = skills.filter((s) => !s.is_gap).reduce((a, s) => a + s.weight, 0);
  const matchPct = totalWeight ? Math.round((100 * haveWeight) / totalWeight) : 0;

  return {
    job_title: postingOut.job_title,
    company: postingOut.company,
    skills,
    match_pct: matchPct,
  };
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
