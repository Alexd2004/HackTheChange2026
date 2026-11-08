// The logic behind revamp-resume, with no database so it can be tested on its own:
// which skills may be added, the Gemini call, and the rules the code enforces on whatever Gemini returns.
import { callGemini, type Part } from "../_shared/gemini.ts";
import { revampPrompt, revampSchema } from "./prompt.ts";

// Same shape as RevampedResume in src/lib/types.ts (the contract with the app).
export interface ResumeItem { heading: string; subheading: string; dates: string; bullets: string[] }
export interface ResumeSection { title: string; items: ResumeItem[] }
export interface ResumeChange {
  type: "added_skill" | "reworded" | "reordered" | "removed";
  where: string;
  before?: string;
  after: string;
  reason: string;
}
export interface RevampedResume {
  contact: string;
  headline: string;
  summary: string;
  skills: string[];
  added_skills: string[];
  sections: ResumeSection[];
  changes: ResumeChange[];
}

interface RawRevamp {
  contact: string;
  headline: string;
  summary: string;
  skills: string[];
  sections: ResumeSection[];
  changes?: unknown; // ignored: the AI only transcribes; code lists the (skill-only) changes
}

export interface PlanSkill { id: string; name: string; is_gap: boolean; have_level: number }

export interface SkillRules {
  allowedNew: string[]; // gap skills whose stage boss was beaten: may be added
  owned: string[]; // already on the resume (or only partly, which stays as written)
  blocked: string[]; // gaps not beaten and not on the resume at all: must not appear
}

/** Sorts a plan's skills into what the resume may gain, keep, or must not mention. */
export function classifySkills(skills: PlanSkill[], beatenSkillIds: Set<string>): SkillRules {
  const allowedNew: string[] = [], owned: string[] = [], blocked: string[] = [];
  for (const s of skills) {
    if (s.is_gap && beatenSkillIds.has(s.id)) allowedNew.push(s.name);
    else if (s.is_gap && s.have_level === 0) blocked.push(s.name);
    else owned.push(s.name); // not a gap, or a gap that is already (partly) on the resume
  }
  return { allowedNew, owned, blocked };
}

export async function generateRevamp(input: {
  jobTitle: string;
  company: string | null;
  rules: SkillRules;
  pdfBase64?: string;
  resumeText?: string;
}): Promise<RevampedResume> {
  const parts: Part[] = input.pdfBase64 ? [{ inlineData: { mimeType: "application/pdf", data: input.pdfBase64 } }] : [];
  const raw = await callGemini<RawRevamp>(
    revampPrompt({
      jobTitle: input.jobTitle, company: input.company, ...input.rules,
      resumeText: input.pdfBase64 ? undefined : input.resumeText,
    }),
    revampSchema, parts, 0.2,
    { logRaw: false }, // the reply is the user's resume: never write it to logs
  );
  return enforceRules(raw, input.rules);
}

// ---- Rules enforced in code, whatever Gemini returned ----

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** True if `term` appears in `text` as its own word ("AWS" matches "AWS (EC2)" but "Git" does not match "GitHub"). */
export const mentions = (text: string, term: string) =>
  new RegExp(`(^|[^A-Za-z0-9+#])${escapeRe(term)}($|[^A-Za-z0-9+#])`, "i").test(text);

export function enforceRules(raw: RawRevamp, rules: SkillRules): RevampedResume {
  const mentionsBlocked = (text: string) => rules.blocked.some((b) => mentions(text, b));

  // skills: no duplicates, nothing blocked, every earned skill present
  const skills: string[] = [];
  for (const s of (raw.skills ?? []).map((x) => String(x).trim()).filter(Boolean)) {
    if (mentionsBlocked(s)) continue;
    if (skills.some((k) => normalize(k) === normalize(s))) continue;
    skills.push(s);
  }
  // The only edit a revamp makes: earned skills appended to the end of the resume's own Skills list.
  const changes: ResumeChange[] = [];
  for (const a of rules.allowedNew) {
    if (!skills.some((k) => normalize(k) === normalize(a) || mentions(k, a))) {
      skills.push(a);
      changes.push({ type: "added_skill", where: "Skills", after: a, reason: "Earned by beating the stage boss in SkillQuest." });
    }
  }

  // text: drop any sentence, bullet or headline that mentions a skill the person does not have
  const summary = (raw.summary ?? "").split(/(?<=[.!?])\s+/).filter((sentence) => !mentionsBlocked(sentence)).join(" ").trim();
  const headline = mentionsBlocked(raw.headline ?? "") ? "" : (raw.headline ?? "").trim();
  const sections = (raw.sections ?? []).map((sec) => ({
    title: sec.title,
    items: (sec.items ?? []).map((it) => ({ ...it, bullets: (it.bullets ?? []).filter((b) => !mentionsBlocked(b)) })),
  }));

  return {
    contact: (raw.contact ?? "").trim(),
    headline,
    summary,
    skills,
    added_skills: [...rules.allowedNew],
    sections,
    changes,
  };
}
