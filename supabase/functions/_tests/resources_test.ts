// Tests for findResources (search, then the AI picks the best links). Keenable and Google are both faked,
// so there are no API calls and no keys needed.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("KEENABLE_API_KEY", "test-key");
Deno.env.set("GEMINI_API_KEY", "test-key");
const { findResources } = await import("../_shared/resources.ts");

const level = { skill: "SQL", title: "Joining tables", objective: "Combine tables.", concepts: ["INNER JOIN", "LEFT JOIN", "ON clause", "NULLs"] };
const searchResults = Array.from({ length: 8 }, (_, k) => ({
  title: `Result ${k + 1}`, url: `https://site${k + 1}.example/tutorial`, description: "", snippet: `raw snippet ${k + 1}`,
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const geminiPicks = (picks: { i: number; why: string }[]) =>
  json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ picks }) }], role: "model" }, finishReason: "STOP" }] });

/** Fake Keenable and Google. Returns what was called. */
async function withFakeWeb(
  replies: { keenable: () => Response; gemini: () => Response },
  fn: () => Promise<void>,
): Promise<{ keenableUrls: string[]; geminiCalls: number }> {
  const real = globalThis.fetch;
  const seen = { keenableUrls: [] as string[], geminiCalls: 0 };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("keenable")) {
      seen.keenableUrls.push(url);
      return Promise.resolve(replies.keenable());
    }
    seen.geminiCalls++;
    return Promise.resolve(replies.gemini());
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "resources: picks are taken by number, repeats and invented numbers are ignored, max 3", ...opts, fn: async () => {
  const seen = await withFakeWeb(
    { keenable: () => json({ results: searchResults }), gemini: () => geminiPicks([
      { i: 3, why: "Clear join walkthrough" }, { i: 99, why: "invented" }, { i: 3, why: "repeat" },
      { i: 1, why: "Official docs" }, { i: 5, why: "Good examples" }, { i: 6, why: "fourth pick" },
    ]) },
    async () => {
      const r = await findResources(level);
      console.log(r.map((x) => `${x.title} -> ${x.snippet}`).join("\n"));
      assertEquals(r.map((x) => x.url), ["https://site3.example/tutorial", "https://site1.example/tutorial", "https://site5.example/tutorial"]);
      assertEquals(r.map((x) => x.snippet), ["Clear join walkthrough", "Official docs", "Good examples"]);
    },
  );
  assertEquals(seen.geminiCalls, 1);
  // The search asks for 8 results and uses the skill and the first three concepts.
  assert(seen.keenableUrls[0].includes("max_results=8"));
  const query = decodeURIComponent(new URL(seen.keenableUrls[0]).searchParams.get("query")!);
  assertEquals(query, "SQL INNER JOIN LEFT JOIN ON clause tutorial");
}});

Deno.test({ name: "resources: if the AI picker fails, the top 3 search results are used", ...opts, fn: async () => {
  await withFakeWeb(
    { keenable: () => json({ results: searchResults }), gemini: () => json({ error: { code: 400, message: "bad", status: "ERR" } }, 400) },
    async () => {
      const r = await findResources(level);
      assertEquals(r.map((x) => x.title), ["Result 1", "Result 2", "Result 3"]);
    },
  );
}});

Deno.test({ name: "resources: when the picker says none are good, the level gets none", ...opts, fn: async () => {
  await withFakeWeb({ keenable: () => json({ results: searchResults }), gemini: () => geminiPicks([]) }, async () => {
    assertEquals(await findResources(level), []);
  });
}});

Deno.test({ name: "resources: no search results means no AI call and no resources", ...opts, fn: async () => {
  const seen = await withFakeWeb({ keenable: () => json({ results: [] }), gemini: () => geminiPicks([]) }, async () => {
    assertEquals(await findResources(level), []);
  });
  assertEquals(seen.geminiCalls, 0);
}});

Deno.test({ name: "resources: a Keenable error means no resources, not a crash", ...opts, fn: async () => {
  const seen = await withFakeWeb({ keenable: () => json({ error: "nope" }, 500), gemini: () => geminiPicks([]) }, async () => {
    assertEquals(await findResources(level), []);
  });
  assertEquals(seen.geminiCalls, 0);
}});
