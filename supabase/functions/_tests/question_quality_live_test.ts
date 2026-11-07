// LIVE test: question style and the difficulty ramp across a stage's fundamentals levels.
// Writes the same level as "level 1 of 6" and as "level 6 of 6" and compares the two, then prints the
// numbers next to the mock level file (src/mock/level.json) that the app was designed around.
import { assert } from "jsr:@std/assert@1";
import { callGemini } from "../_shared/gemini.ts";
import { writeQuestionsPrompt } from "../_shared/prompts.ts";
import { type DraftQuestion, type DraftQuestions, questionsSchema } from "../_shared/schemas.ts";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stats(qs: DraftQuestion[]) {
  return {
    count: qs.length,
    mcq: qs.filter((q) => q.kind === "mcq").length,
    blank: qs.filter((q) => q.kind === "blank").length,
    difficulty: avg(qs.map((q) => q.difficulty)),
    promptChars: Math.round(avg(qs.map((q) => q.prompt.length))),
    explanationChars: Math.round(avg(qs.map((q) => q.explanation.length))),
  };
}
const line = (label: string, s: ReturnType<typeof stats>) =>
  `${label.padEnd(28)} ${s.count} questions (${s.mcq} mcq, ${s.blank} blank)  difficulty ${s.difficulty.toFixed(2)}  ` +
  `prompt ${s.promptChars} chars  explanation ${s.explanationChars} chars`;

async function writeLevel(n: number): Promise<DraftQuestion[]> {
  const draft = await callGemini<DraftQuestions>(
    writeQuestionsPrompt({
      skill: "SQL", type: "normal", title: "Joining tables", objective: "Combine rows from two tables with joins.",
      concepts: ["INNER JOIN", "LEFT JOIN", "ON clause"], weakConcepts: [], position: { n, of: 6 }, count: 5,
    }),
    questionsSchema, [], 0.8,
  );
  return draft.questions;
}

Deno.test({
  name: "questions: later levels are harder than early ones, in the same short style as the mock",
  ignore: !Deno.env.get("GEMINI_API_KEY"),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const early = await writeLevel(1);
    const late = await writeLevel(6);
    const e = stats(early), l = stats(late);

    console.log("\n" + line("generated, level 1 of 6", e));
    console.log(line("generated, level 6 of 6", l));
    try {
      const mock = JSON.parse(await Deno.readTextFile(new URL("../../../src/mock/level.json", import.meta.url)));
      const all: DraftQuestion[] = Object.values(mock).flatMap((v) => (v as { questions: DraftQuestion[] }).questions);
      console.log(line("mock level.json (all levels)", stats(all)));
    } catch {
      console.log("(mock level.json not found, skipping the comparison line)");
    }
    console.log("\nlevel 1 prompts:\n  " + early.map((q) => `d${q.difficulty} ${q.prompt}`).join("\n  "));
    console.log("level 6 prompts:\n  " + late.map((q) => `d${q.difficulty} ${q.prompt}`).join("\n  "));

    assert(l.difficulty - e.difficulty >= 0.4, `level 6 (${l.difficulty}) should be clearly harder than level 1 (${e.difficulty})`);
    assert(e.mcq > 0 && e.blank > 0 && l.mcq > 0 && l.blank > 0, "each level should mix multiple choice and fill-in");
    assert(e.explanationChars <= 150 && l.explanationChars <= 150, "explanations should stay short");
  },
});
