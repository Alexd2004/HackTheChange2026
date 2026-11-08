// TUNING REPORT (live, uses the real Gemini and Keenable APIs): runs the real create-plan and generate-level
// pipelines (without the database) on made-up resume/posting pairs, times them against the targets
// (create-plan under 20 s, generate-level under 15 s), and flags problems so the prompts can be tuned.
//
//   deno task tune              all three pairs (about 5 minutes: it paces itself under the 15 requests/minute limit)
//   deno task tune -- --pair=2  just one pair (1, 2 or 3)
import { callGemini } from "../_shared/gemini.ts";
import { buildMapPrompt } from "../_shared/prompts.ts";
import { type MapPlan, mapSchema } from "../_shared/schemas.ts";
import { findResources } from "../_shared/resources.ts";
import { compareResumeToPosting, pickStageSkills } from "../create-plan/fit.ts";
import { makeQuestions, type QuestionRound } from "../generate-level/questions.ts";

const PLAN_TARGET_S = 20;
const LEVEL_TARGET_S = 15;
const MAX_STAGES = 3;

// ---- Stay under the free limit of 15 Gemini requests per minute. The fetch wrapper only records requests;
// `needBudget(n)` waits BEFORE a step starts (never inside a request, which would trip the helper's timeout).
const sent: number[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes("generativelanguage.googleapis.com")) sent.push(Date.now());
  return realFetch(input, init);
}) as typeof fetch;

async function needBudget(n: number) {
  const LIMIT = 13;
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
    if (sent.length + n <= LIMIT) return;
    const wait = sent[0] + 60_000 - now + 100;
    console.log(`   (pausing ${Math.ceil(wait / 1000)}s to stay under the 15 requests/minute limit)`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

const pairs = [
  { label: "junior dev  x full-stack posting", resume: "resume1.txt", posting: "posting1.txt" },
  { label: "career changer x data analyst posting", resume: "resume2.txt", posting: "posting2.txt" },
  { label: "career changer x full-stack posting", resume: "resume2.txt", posting: "posting1.txt" },
];
const arg = Deno.args.find((a) => a.startsWith("--pair="));
const chosen = arg ? [pairs[Number(arg.split("=")[1]) - 1]].filter(Boolean) : pairs;

const sample = (f: string) => Deno.readTextFile(new URL(`./samples/${f}`, import.meta.url));
const seconds = (ms: number) => (ms / 1000).toFixed(1);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
const VAGUE = /^(basics?|fundamentals?|overview|introduction|intro|concepts?|best practices?|advanced|general|tools?|syntax|usage|theory)$/;

const warnings: string[] = [];
const warn = (where: string, msg: string) => { warnings.push(`${where}: ${msg}`); console.log(`   ⚠ ${msg}`); };

for (const pair of chosen) {
  console.log(`\n${"=".repeat(100)}\nPAIR: ${pair.label}\n${"=".repeat(100)}`);
  const resumeText = await sample(pair.resume);
  const posting = await sample(pair.posting);

  // ---- create-plan: compare, pick stages, build the map
  await needBudget(3);
  const t0 = Date.now();
  const fit = await compareResumeToPosting({ posting, resumeText });
  const tFit = Date.now() - t0;
  const { mode, skills: stageSkills } = pickStageSkills(fit.skills, MAX_STAGES);
  await needBudget(2);
  const t1 = Date.now();
  const map = stageSkills.length
    ? await callGemini<MapPlan>(
        buildMapPrompt(fit.job_title, stageSkills.map((g) => ({ name: g.name, have: g.have_level, need: g.need_level })), mode),
        mapSchema, [], 0.7,
      )
    : { stages: [] };
  const tMap = Date.now() - t1;
  const planSeconds = (tFit + tMap) / 1000;
  console.log(`\ncreate-plan: ${seconds(tFit)}s compare + ${seconds(tMap)}s map = ${planSeconds.toFixed(1)}s (target ${PLAN_TARGET_S}s)   match ${fit.match_pct}%  mode: ${mode}`);
  if (planSeconds > PLAN_TARGET_S) warn(pair.label, `create-plan took ${planSeconds.toFixed(1)}s, over the ${PLAN_TARGET_S}s target`);
  fit.skills.forEach((s) => console.log(`   ${s.is_gap ? "GAP " : "have"} ${s.name.padEnd(24)} need ${s.need_level} have ${s.have_level}`));
  if (map.stages.length > MAX_STAGES) warn(pair.label, `${map.stages.length} stages, more than ${MAX_STAGES}`);

  // ---- map quality: vague or repeated concepts, level counts
  for (const st of map.stages) {
    const seen = new Map<string, number>();
    st.levels.forEach((l, i) => l.concepts.forEach((c) => seen.set(norm(c), (seen.get(norm(c)) ?? 0) + (i < 6 ? 1 : 0))));
    const vague = st.levels.flatMap((l) => l.concepts).filter((c) => VAGUE.test(norm(c)) || norm(c) === norm(st.skill));
    const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    if (st.levels.length !== 4) warn(st.skill, `${st.levels.length} levels instead of 4`);
    if (vague.length) warn(st.skill, `vague concepts: ${vague.join(", ")}`);
    if (repeated.length) warn(st.skill, `concepts taught in more than one fundamentals level: ${repeated.join(", ")}`);
  }
  const stage = map.stages[0];
  if (!stage) { console.log("   (no stages)"); continue; }
  console.log(`\nStage 1 "${stage.title}" (${stage.skill}) - ${stage.summary}`);
  stage.levels.forEach((l, i) => console.log(`   ${i + 1}${i === 3 ? " BOSS" : "     "} ${l.title} :: ${l.concepts.join(" | ")}`));

  // ---- generate-level: questions + resources in parallel, like the real function
  const earlier = stage.levels.slice(0, 3).map((l) => ({ title: l.title, concepts: l.concepts }));
  const toTry = [
    { idx: 0, type: "normal" as const }, { idx: 2, type: "normal" as const }, { idx: 3, type: "boss" as const },
  ];
  const diffs: number[] = [];
  for (const { idx, type } of toTry) {
    const level = stage.levels[idx];
    const rounds: QuestionRound[] = [];
    await needBudget(type === "normal" ? 5 : 4);
    const tl = Date.now();
    const [questions, resources] = await Promise.all([
      makeQuestions({ type, title: level.title, objective: level.objective, concepts: level.concepts }, stage.skill, [],
        type === "boss" ? earlier : [], type === "boss" ? undefined : { n: idx + 1, of: 3 }, (r) => rounds.push(r)),
      type === "normal" ? findResources({ skill: stage.skill, title: level.title, objective: level.objective, concepts: level.concepts }) : Promise.resolve([]),
    ]);
    const secs = (Date.now() - tl) / 1000;
    const label = `${stage.skill} level ${idx + 1} (${type})`;
    const allowed = new Set((type === "boss" ? earlier.flatMap((l) => l.concepts) : level.concepts).map(norm));
    const offList = questions.filter((q) => !allowed.has(norm(q.concept)));
    const mcq = questions.filter((q) => q.kind === "mcq");
    const positions = [0, 1, 2, 3].map((p) => mcq.filter((q) => q.correct_index === p).length);
    const d = avg(questions.map((q) => q.difficulty));
    if (type === "normal") diffs.push(d);
    const expl = Math.round(avg(questions.map((q) => q.explanation.length)));
    const covered = new Set(questions.flatMap((q) => earlier.flatMap((l, li) => l.concepts.some((c) => norm(c) === norm(q.concept)) ? [li + 1] : [])));
    console.log(`\n${label}: ${secs.toFixed(1)}s (target ${LEVEL_TARGET_S}s)  ${questions.length} questions kept  [${rounds.map((r) => `round ${r.round}: wrote ${r.written}, well-formed ${r.wellFormed}, verified ${r.verified}`).join("; ")}]`);
    console.log(`   mix ${mcq.length} mcq / ${questions.length - mcq.length} blank   difficulty ${d.toFixed(2)}   explanation ${expl} chars   MCQ answer positions A/B/C/D ${positions.join("/")}   resources ${resources.length}`);
    if (type === "boss") console.log(`   earlier levels covered by the boss: ${[...covered].sort().join(",")} of 1-3`);
    console.log("   " + questions.slice(0, 3).map((q) => `[${q.kind} d${q.difficulty} ${q.concept}] ${q.prompt}`).join("\n   "));
    if (secs > LEVEL_TARGET_S) warn(label, `took ${secs.toFixed(1)}s, over the ${LEVEL_TARGET_S}s target`);
    if (questions.length < 3) warn(label, `only ${questions.length} questions survived`);
    if (offList.length) warn(label, `${offList.length} question(s) use a concept name not in the level's list: ${[...new Set(offList.map((q) => q.concept))].join(", ")}`);
    if (expl > 120) warn(label, `explanations average ${expl} characters`);
    if (type === "normal" && resources.length === 0) warn(label, "no resources found");
    if (type === "boss" && covered.size < 3) warn(label, `the boss covers only ${covered.size} of the 3 earlier levels`);
  }
  if (diffs.length === 3 && !(diffs[0] <= 1.6 && diffs[2] >= diffs[0] + 0.4)) {
    warn(pair.label, `difficulty does not ramp across levels 1, 4, 6 (${diffs.map((x) => x.toFixed(2)).join(" -> ")})`);
  }
}

console.log(`\n${"=".repeat(100)}\nSUMMARY: ${warnings.length === 0 ? "no warnings" : `${warnings.length} warning(s)`}`);
warnings.forEach((w) => console.log(` - ${w}`));
