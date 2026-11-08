// Tests for callGemini's timeout, retry and error handling. Google's replies are faked at the network
// layer, so there are no API calls and no keys needed.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.env.set("GEMINI_API_KEY", Deno.env.get("GEMINI_API_KEY") || "test-key");
const { callGemini } = await import("../_shared/gemini.ts");
const { UserError } = await import("../_shared/cors.ts");

const schema = { type: "object", properties: { skill: { type: "string" } }, required: ["skill"] };
const okReply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const errReply = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: status, message, status: "ERR" } }), {
    status,
    headers: { "content-type": "application/json" },
  });

let lastBodies: string[] = [];

/** Run `fn` with fetch replaced by `replies` (one per call, the last one repeats). Returns how many calls were made. */
async function withFakeGoogle(replies: (() => Response)[], fn: () => Promise<void>): Promise<number> {
  const real = globalThis.fetch;
  let calls = 0;
  const bodies: string[] = [];
  globalThis.fetch = ((_input: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ""));
    const reply = replies[Math.min(calls, replies.length - 1)];
    calls++;
    return Promise.resolve(reply());
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  lastBodies = bodies;
  return calls;
}

// The call has a 25 second timer; skip Deno's timer/resource leak checks for these tests.
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  name: "gemini: a normal call returns the parsed JSON",
  ...opts,
  fn: async () => {
    const calls = await withFakeGoogle([() => okReply('{"skill":"INNER JOIN"}')], async () => {
      assertEquals(await callGemini("Name a join", schema), { skill: "INNER JOIN" });
    });
    assertEquals(calls, 1);
    const body = JSON.parse(lastBodies[0]);
    assertEquals(body.generationConfig.responseMimeType, "application/json");
    assert(body.generationConfig.thinkingConfig, "a thinking level should be sent");
  },
});

Deno.test({
  name: "gemini: a 503 is retried once and then succeeds",
  ...opts,
  fn: async () => {
    const calls = await withFakeGoogle([() => errReply(503, "overloaded"), () => okReply('{"skill":"LEFT JOIN"}')], async () => {
      assertEquals(await callGemini("Name a join", schema), { skill: "LEFT JOIN" });
    });
    assertEquals(calls, 2);
  },
});

Deno.test({
  name: "gemini: unreadable JSON is retried and then succeeds",
  ...opts,
  fn: async () => {
    const calls = await withFakeGoogle([() => okReply("this is not json {{{"), () => okReply('{"skill":"x"}')], async () => {
      assertEquals(await callGemini("Name a join", schema), { skill: "x" });
    });
    assertEquals(calls, 2);
  },
});

Deno.test({
  name: "gemini: a rate limit (429) is retried once, then reported plainly",
  ...opts,
  fn: async () => {
    const calls = await withFakeGoogle([() => errReply(429, "quota")], async () => {
      const err = await assertRejects(() => callGemini("Name a join", schema), UserError);
      assertEquals((err as InstanceType<typeof UserError>).status, 429);
      console.log("message:", (err as Error).message);
    });
    assertEquals(calls, 2);
  },
});

Deno.test({
  name: "gemini: a wrong key gets a clear message and is not retried",
  ...opts,
  fn: async () => {
    const calls = await withFakeGoogle([() => errReply(400, "API key not valid. Please pass a valid API key.")], async () => {
      const err = await assertRejects(() => callGemini("Name a join", schema), UserError);
      console.log("message:", (err as Error).message);
      assert((err as Error).message.includes("GEMINI_API_KEY"));
    });
    assertEquals(calls, 1);
  },
});

Deno.test({
  name: "gemini: an unknown model name gets a clear message and is not retried",
  ...opts,
  fn: async () => {
    const calls = await withFakeGoogle([() => errReply(404, "models/nope is not found")], async () => {
      const err = await assertRejects(() => callGemini("Name a join", schema), UserError);
      console.log("message:", (err as Error).message);
      assert((err as Error).message.includes("GEMINI_MODEL"));
    });
    assertEquals(calls, 1);
  },
});
