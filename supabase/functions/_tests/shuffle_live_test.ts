// LIVE test: real Gemini questions, shuffled, then checked by the real verification call.
import { assert } from "jsr:@std/assert@1";
import { callGemini } from "../_shared/gemini.ts";
import { verifyQuestionsPrompt, writeQuestionsPrompt } from "../_shared/prompts.ts";
import { type DraftQuestions, questionsSchema, type Verification, verifySchema } from "../_shared/schemas.ts";
import { shuffleOptions } from "../generate-level/shuffle.ts";

Deno.test({
  name: "shuffle: shuffled questions still pass the verifier",
  ignore: !Deno.env.get("GEMINI_API_KEY"),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const draft = await callGemini<DraftQuestions>(
      writeQuestionsPrompt({
        skill: "SQL", type: "normal", title: "Join the Party", objective: "Combine tables with joins.",
        concepts: ["INNER JOIN", "LEFT JOIN"], weakConcepts: [], count: 8,
      }),
      questionsSchema, [], 0.8,
    );
    const mcqs = draft.questions
      .filter((q) => q.kind === "mcq" && q.options?.length === 4 && q.correct_index !== null)
      .map((q) => ({ ...q, ...shuffleOptions(q.options!.map(String), q.correct_index!) }));
    const verdict = await callGemini<Verification>(
      verifyQuestionsPrompt(mcqs.map((q, idx) => ({ idx, kind: q.kind, prompt: q.prompt, options: q.options }))),
      verifySchema, [], 0,
    );
    const answers = new Map(verdict.answers.map((a) => [a.idx, a]));
    const agree = mcqs.filter((q, idx) => answers.get(idx)?.mcq_index === q.correct_index).length;
    console.log(`correct positions after shuffle: ${mcqs.map((q) => "ABCD"[q.correct_index]).join(" ")}`);
    console.log(`verifier agrees with the answer key: ${agree}/${mcqs.length}`);
    assert(mcqs.length > 0 && agree / mcqs.length >= 0.8);
  },
});
