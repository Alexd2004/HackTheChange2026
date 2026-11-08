// Tests for makeQuestions (write, check, keep). Google's replies are faked at the network layer, so there
// are no API calls and no keys needed. The fake tells the "write" call from the "verify" call by its prompt.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.env.set("GEMINI_API_KEY", "test-key");
Deno.env.set("GEMINI_MODEL", "main-model");
Deno.env.set("GEMINI_MODEL_LIGHT", "light-model");
const { makeQuestions } = await import("../generate-level/questions.ts");
const { UserError } = await import("../_shared/cors.ts");

const reply = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }], role: "model" }, finishReason: "STOP" }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
const errReply = (status: number) =>
  new Response(JSON.stringify({ error: { code: status, message: "fake error", status: "ERR" } }), {
    status, headers: { "content-type": "application/json" },
  });

/** n well-formed fill-in questions; every accepted answer is "JOIN". */
const blanks = (n: number) => ({
  questions: Array.from({ length: n }, (_, k) => ({
    kind: "blank", prompt: `Question ${k + 1}: rows are combined with a ____ clause.`, options: null, correct_index: null,
    answers: ["JOIN"], explanation: "It combines tables.", hint: "Think about combining tables.", concept: "INNER JOIN", difficulty: 1,
  })),
});
/** The checker answers "JOIN" (agrees) for the first `agree` questions and "WHERE" for the rest. */
const verdict = (n: number, agree: number) => ({
  answers: Array.from({ length: n }, (_, idx) => ({ idx, mcq_index: null, blank_answer: idx < agree ? "JOIN" : "WHERE" })),
});

interface Call { kind: "write" | "verify"; url: string; prompt: string }

/** Fake Google: `write(n)` / `verify(n)` answer the n-th call of that kind (0-based). */
async function withFakeGoogle(
  replies: { write: (n: number) => Response; verify: (n: number) => Response },
  fn: () => Promise<void>,
): Promise<Call[]> {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: { body?: unknown }) => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? "");
    const parts = JSON.parse(raw).contents?.[0]?.parts ?? [];
    const prompt = String(parts[parts.length - 1]?.text ?? "");
    const kind = prompt.includes("Answer each quiz question") ? "verify" : "write";
    const n = calls.filter((c) => c.kind === kind).length;
    calls.push({ kind, url, prompt });
    return kind === "write" ? replies.write(n) : replies.verify(n);
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return calls;
}
const opts = { sanitizeOps: false, sanitizeResources: false };
const normal = { type: "normal" as const, title: "Joining tables", objective: "Combine tables.", concepts: ["INNER JOIN", "LEFT JOIN"] };
const boss = { type: "boss" as const, title: "Data Boss", objective: "Use joins at work.", concepts: ["INNER JOIN", "GROUP BY"] };
const earlier = [{ title: "Joins", concepts: ["INNER JOIN"] }, { title: "Grouping", concepts: ["GROUP BY"] }];

Deno.test({ name: "questions: a normal level asks for 2 spare questions and keeps 4", ...opts, fn: async () => {
  let out: unknown[] = [];
  const calls = await withFakeGoogle({ write: () => reply(blanks(6)), verify: () => reply(verdict(6, 6)) }, async () => {
    out = await makeQuestions(normal, "SQL", [], [], { n: 1, of: 2 });
  });
  assertEquals(out.length, 4);
  assertEquals(calls.map((c) => c.kind), ["write", "verify"]);
  assert(calls[0].prompt.includes("Write exactly 6 questions"), "round 1 asks for target + 2");
  assert(calls[0].prompt.includes("level 1 of 2"));
}});

Deno.test({ name: "questions: the verify call goes to GEMINI_MODEL_LIGHT, writing to GEMINI_MODEL", ...opts, fn: async () => {
  const calls = await withFakeGoogle({ write: () => reply(blanks(6)), verify: () => reply(verdict(6, 6)) }, async () => {
    await makeQuestions(normal, "SQL", [], [], { n: 2, of: 2 });
  });
  assert(calls[0].url.includes("main-model"), calls[0].url);
  assert(calls[1].url.includes("light-model"), calls[1].url);
}});

Deno.test({ name: "questions: if the verify CALL fails (429), the well-formed questions are kept", ...opts, fn: async () => {
  let out: unknown[] = [];
  const calls = await withFakeGoogle({ write: () => reply(blanks(6)), verify: () => errReply(429) }, async () => {
    out = await makeQuestions(normal, "SQL", [], [], { n: 1, of: 2 });
  });
  assertEquals(out.length, 4);
  // 1 write, then the verify call and its one retry. No second writing round.
  assertEquals(calls.map((c) => c.kind), ["write", "verify", "verify"]);
}});

Deno.test({ name: "questions: when the checker disagrees, those questions are dropped (not kept unverified)", ...opts, fn: async () => {
  const calls = await withFakeGoogle({ write: () => reply(blanks(6)), verify: (n) => reply(verdict(n === 0 ? 6 : 4, 1)) }, async () => {
    const err = await assertRejects(() => makeQuestions(normal, "SQL", [], [], { n: 1, of: 2 }), UserError);
    assertEquals((err as InstanceType<typeof UserError>).status, 502);
  });
  assertEquals(calls.map((c) => c.kind), ["write", "verify", "write", "verify"]);
  assert(calls[2].prompt.includes("Write exactly 4 questions"), "round 2 asks for the target only");
}});

Deno.test({ name: "questions: the boss asks for 8, keeps 6, and spreads them over the two earlier levels", ...opts, fn: async () => {
  let out: unknown[] = [];
  const calls = await withFakeGoogle({ write: () => reply(blanks(8)), verify: () => reply(verdict(8, 8)) }, async () => {
    out = await makeQuestions(boss, "SQL", [], earlier, undefined);
  });
  assertEquals(out.length, 6);
  assert(calls[0].prompt.includes("Write exactly 8 questions"));
  assert(calls[0].prompt.includes("questions 1 and 2 test concepts from the first earlier level"));
  assert(calls[0].prompt.includes("- Joins: INNER JOIN") && calls[0].prompt.includes("- Grouping: GROUP BY"));
}});

Deno.test({ name: "questions: boss with 4 good questions and a failed second round still plays", ...opts, fn: async () => {
  let out: unknown[] = [];
  const calls = await withFakeGoogle({ write: (n) => (n === 0 ? reply(blanks(8)) : errReply(429)), verify: () => reply(verdict(8, 4)) }, async () => {
    out = await makeQuestions(boss, "SQL", [], earlier, undefined);
  });
  assertEquals(out.length, 4); // below MIN (5) so round 2 was tried, but at least ABSOLUTE_MIN (4)
  assertEquals(calls.map((c) => c.kind), ["write", "verify", "write", "write"]);
}});

Deno.test({ name: "questions: boss with only 3 good questions fails when the second round fails", ...opts, fn: async () => {
  await withFakeGoogle({ write: (n) => (n === 0 ? reply(blanks(8)) : errReply(429)), verify: () => reply(verdict(8, 3)) }, async () => {
    const err = await assertRejects(() => makeQuestions(boss, "SQL", [], earlier, undefined), UserError);
    assertEquals((err as InstanceType<typeof UserError>).status, 429);
  });
}});
