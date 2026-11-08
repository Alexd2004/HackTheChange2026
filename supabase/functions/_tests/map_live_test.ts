// LIVE test: the map builder and the boss questions, using the real Gemini API.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { callGemini } from "../_shared/gemini.ts";
import { buildMapPrompt, writeQuestionsPrompt } from "../_shared/prompts.ts";
import { type DraftQuestions, type MapPlan, mapSchema, questionsSchema } from "../_shared/schemas.ts";

const opts = { ignore: !Deno.env.get("GEMINI_API_KEY"), sanitizeOps: false, sanitizeResources: false };
const gaps = [
  { name: "React", have: 0, need: 2 },
  { name: "TypeScript", have: 0, need: 2 },
  { name: "REST APIs", have: 0, need: 2 },
];

Deno.test({
  name: "map: 3 stages with 7 levels each, and a boss that covers the earlier levels",
  ...opts,
  fn: async () => {
    const map = await callGemini<MapPlan>(buildMapPrompt("Junior Full-Stack Developer", gaps), mapSchema, [], 0.7);
    console.log(`stages: ${map.stages.length}, levels per stage: ${map.stages.map((s) => s.levels.length).join(",")}`);
    const stage = map.stages[0];
    console.log(`\nStage 1 "${stage.title}" (${stage.skill})`);
    stage.levels.forEach((l, i) => console.log(`  ${i + 1}${i === 6 ? " BOSS" : "     "} ${l.title} :: ${l.concepts.join(" | ")}`));
    assertEquals(map.stages.length, 3);
    for (const s of map.stages) assertEquals(s.levels.length, 7);

    // Boss questions should draw on the six earlier levels.
    const earlier = stage.levels.slice(0, 6).map((l) => ({ title: l.title, concepts: l.concepts }));
    const boss = stage.levels[6];
    const qs = await callGemini<DraftQuestions>(
      writeQuestionsPrompt({
        skill: stage.skill, type: "boss", title: boss.title, objective: boss.objective, concepts: boss.concepts,
        weakConcepts: [], earlierLevels: earlier, count: 8,
      }),
      questionsSchema, [], 0.8,
    );
    const covered = new Set<number>();
    qs.questions.forEach((q, i) => {
      const hits = earlier.flatMap((l, li) =>
        l.concepts.some((c) => c.toLowerCase().trim() === q.concept.toLowerCase().trim()) ? [li + 1] : []
      );
      hits.forEach((h) => covered.add(h));
      console.log(`  Q${i + 1} [${q.kind}] concept="${q.concept}" -> level ${hits.join(",") || "?"}`);
    });
    console.log(`earlier levels covered by the boss: ${[...covered].sort().join(",")} of 1-6`);
    assert(covered.size >= 4, "the boss should test most of the earlier levels");
  },
});
