// LIVE test: calls the real Gemini API (needs GEMINI_API_KEY and GEMINI_MODEL in supabase/functions/.env).
// Compares sample resumes to sample postings. The samples are made-up people, not real data.
// Gemini can vary a little between runs, so the checks allow some slack.
import { assert } from "jsr:@std/assert@1";
import { compareResumeToPosting, type Fit } from "../create-plan/fit.ts";

const read = (f: string) => Deno.readTextFile(new URL(`./samples/${f}`, import.meta.url));
const opts = { ignore: !Deno.env.get("GEMINI_API_KEY"), sanitizeOps: false, sanitizeResources: false };

function show(label: string, fit: Fit) {
  console.log(`\n${label}: ${fit.job_title} @ ${fit.company}   MATCH ${fit.match_pct}%`);
  for (const s of fit.skills) {
    console.log(`  ${s.is_gap ? "GAP " : "have"}  ${s.name.padEnd(26)} need ${s.need_level}  have ${s.have_level}${s.required ? "  (required)" : ""}`);
  }
}
const level = (fit: Fit, name: string) => fit.skills.find((s) => s.name.toLowerCase().includes(name.toLowerCase()));

Deno.test({
  name: "fit: PostgreSQL counts as SQL and an Express app counts as REST APIs",
  ...opts,
  fn: async () => {
    const fit = await compareResumeToPosting({ posting: await read("posting1.txt"), resumeText: await read("resume1.txt") });
    show("junior dev x full-stack posting", fit);
    assert((level(fit, "SQL")?.have_level ?? 0) >= 2, "SQL should not be a gap");
    assert((level(fit, "REST")?.have_level ?? 0) >= 2, "REST APIs should not be a gap");
    assert(fit.match_pct >= 60, "a good match should score well");
  },
});

Deno.test({
  name: "fit: a career changer has real gaps",
  ...opts,
  fn: async () => {
    const fit = await compareResumeToPosting({ posting: await read("posting1.txt"), resumeText: await read("resume2.txt") });
    show("career changer x full-stack posting", fit);
    assert(fit.match_pct <= 30, "most skills should be gaps");
    assert(fit.skills.some((s) => s.is_gap));
  },
});

Deno.test({
  name: "fit: 'Power BI or Tableau' becomes one skill, not two",
  ...opts,
  fn: async () => {
    const fit = await compareResumeToPosting({ posting: await read("posting2.txt"), resumeText: await read("resume2.txt") });
    show("career changer x data analyst posting", fit);
    const tools = fit.skills.filter((s) => /power ?bi|tableau/i.test(s.name) && !/visuali/i.test(s.name));
    assert(tools.length === 0, "the two tools should be merged into one skill");
  },
});

Deno.test({
  name: "fit: a strong resume has almost no gaps",
  ...opts,
  fn: async () => {
    const fit = await compareResumeToPosting({ posting: await read("posting1.txt"), resumeText: await read("resume3.txt") });
    show("senior dev x full-stack posting", fit);
    assert(fit.match_pct >= 75, "a strong resume should match almost everything");
  },
});
