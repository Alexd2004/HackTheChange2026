// Tests for findResources (search, then plain-code ranking). Keenable is faked and any other network call
// is counted, so there are no API calls and no keys needed. The ranking must never call Gemini.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("KEENABLE_API_KEY", "test-key");
const { findResources, rankResources } = await import("../_shared/resources.ts");

const level = { skill: "SQL", title: "Joining tables", objective: "Combine tables.", concepts: ["INNER JOIN", "LEFT JOIN", "ON clause", "NULLs"] };
const hit = (title: string, url: string, snippet = "") => ({ title, url, description: "", snippet });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Fake Keenable; anything else (e.g. Google) is counted and fails. Returns what was called. */
async function withFakeWeb(
  keenable: (callNumber: number) => Response,
  fn: () => Promise<void>,
): Promise<{ keenableUrls: string[]; otherCalls: number }> {
  const real = globalThis.fetch;
  const seen = { keenableUrls: [] as string[], otherCalls: 0 };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("keenable")) {
      seen.keenableUrls.push(url);
      return Promise.resolve(keenable(seen.keenableUrls.length - 1));
    }
    seen.otherCalls++;
    return Promise.resolve(json({ error: "no network in tests" }, 500));
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}
const opts = { sanitizeOps: false, sanitizeResources: false };
const queryOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("query")!);
// A relevant result on a site with no special ranking.
const result = (k: number) => hit(`SQL join guide ${k}`, `https://site${k}.example/sql-joins`, `INNER JOIN example ${k}`);

Deno.test({ name: "resources: trusted learning sites rank first, max 3, no AI call", ...opts, fn: async () => {
  const results = [
    hit("SQL joins explained", "https://randomblog.example/sql-joins", "INNER JOIN and LEFT JOIN"),
    hit("SQL INNER JOIN Keyword", "https://www.w3schools.com/sql/sql_join_inner.asp", "The INNER JOIN keyword selects records"),
    hit("Joins - PostgreSQL docs", "https://www.postgresql.org/docs/current/tutorial-join.html", "Joins between tables, LEFT JOIN"),
    hit("SQL Joins Tutorial", "https://www.freecodecamp.org/news/sql-joins-tutorial/", "INNER JOIN, LEFT JOIN, ON clause"),
    hit("Another joins post", "https://another.example/joins", "LEFT JOIN"),
  ];
  const seen = await withFakeWeb(() => json({ results }), async () => {
    const r = await findResources(level);
    console.log(r.map((x) => `${x.title} -> ${x.url}`).join("\n"));
    assertEquals(r.map((x) => new URL(x.url).hostname), ["www.postgresql.org", "www.w3schools.com", "www.freecodecamp.org"]);
    for (const x of r) assert(results.some((c) => c.url === x.url), "every link comes from the search results");
  });
  assertEquals(seen.otherCalls, 0, "no Gemini (or any other) call");
  // The search asks for 8 results and uses the skill and the first three concepts.
  assert(seen.keenableUrls[0].includes("max_results=8"));
  assertEquals(queryOf(seen.keenableUrls[0]), "SQL INNER JOIN LEFT JOIN ON clause tutorial");
}});

Deno.test("resources: one link per site", () => {
  const r = rankResources([
    hit("SQL INNER JOIN", "https://www.w3schools.com/sql/sql_join_inner.asp", "INNER JOIN"),
    hit("SQL LEFT JOIN", "https://www.w3schools.com/sql/sql_join_left.asp", "LEFT JOIN"),
    hit("SQL Joins", "https://www.geeksforgeeks.org/sql-join-set-1-inner-left-right-and-full-joins/", "INNER JOIN, LEFT JOIN"),
  ], level);
  assertEquals(r.map((x) => x.url), [
    "https://www.w3schools.com/sql/sql_join_inner.asp",
    "https://www.geeksforgeeks.org/sql-join-set-1-inner-left-right-and-full-joins/",
  ]);
});

Deno.test("resources: off-topic, social, shopping and sign-up pages are dropped", () => {
  const r = rankResources([
    hit("Best pizza in town", "https://pizza.example/menu", "Order online today"),
    hit("SQL joins pins", "https://www.pinterest.com/pin/123", "SQL join cheat sheet"),
    hit("SQL Books", "https://www.amazon.com/sql-book/dp/1", "Learn SQL INNER JOIN"),
    hit("Sign up to learn SQL joins", "https://course.example/signup", "INNER JOIN course"),
    hit("SQL LEFT JOIN tutorial", "https://tutorial.example/left-join", "How LEFT JOIN keeps unmatched rows"),
  ], level);
  assertEquals(r.map((x) => x.url), ["https://tutorial.example/left-join"]);
});

Deno.test("resources: among unknown sites, more matching concepts ranks higher; ties keep the search order", () => {
  const r = rankResources([
    hit("Intro to SQL", "https://a.example/intro", "What is SQL"),
    hit("SQL joins: INNER JOIN, LEFT JOIN and the ON clause", "https://b.example/joins", ""),
    hit("SQL basics", "https://c.example/basics", "SQL for beginners"),
  ], level);
  assertEquals(r.map((x) => x.url), ["https://b.example/joins", "https://a.example/intro", "https://c.example/basics"]);
});

Deno.test("resources: paywalled-leaning sites rank below other relevant results", () => {
  const r = rankResources([
    hit("SQL joins on Medium", "https://medium.com/@someone/sql-joins", "INNER JOIN LEFT JOIN"),
    hit("SQL joins guide", "https://guide.example/joins", "INNER JOIN LEFT JOIN"),
  ], level);
  assertEquals(r.map((x) => new URL(x.url).hostname), ["guide.example", "medium.com"]);
});

Deno.test("resources: official-looking docs hosts get a boost, and symbols in skill names still match", () => {
  const cpp = { skill: "C++", concepts: ["Pointers", "References"] };
  const r = rankResources([
    hit("C++ pointers explained", "https://blog.example/cpp-pointers", "C++ pointers"),
    hit("Pointers", "https://docs.cppreference.example/pointers", "Pointer declaration in C++"),
    hit("C programming", "https://c.example/intro", "Learn the C language"),
  ], cpp);
  assertEquals(r.map((x) => new URL(x.url).hostname), ["docs.cppreference.example", "blog.example"]);
});

Deno.test({ name: "resources: no search results means no resources and no other calls", ...opts, fn: async () => {
  const seen = await withFakeWeb(() => json({ results: [] }), async () => {
    assertEquals(await findResources(level), []);
  });
  assertEquals(seen.otherCalls, 0);
}});

Deno.test({ name: "resources: a Keenable error means no resources, not a crash", ...opts, fn: async () => {
  await withFakeWeb(() => json({ error: "nope" }, 500), async () => {
    assertEquals(await findResources(level), []);
  });
}});

Deno.test({ name: "resources: fewer than 3 results triggers a second search with a simpler query, merged without repeats", ...opts, fn: async () => {
  const seen = await withFakeWeb(
    // first search finds 2, the simpler one finds 5 (one of which is a repeat of the first search)
    (n) => json({ results: n === 0 ? [result(1), result(2)] : [result(2), result(3), result(4), result(5), result(6)] }),
    async () => {
      const r = await findResources(level);
      assertEquals(r.map((x) => x.title), ["SQL join guide 1", "SQL join guide 2", "SQL join guide 3"]);
    },
  );
  assertEquals(seen.keenableUrls.length, 2);
  assertEquals(queryOf(seen.keenableUrls[0]), "SQL INNER JOIN LEFT JOIN ON clause tutorial");
  assertEquals(queryOf(seen.keenableUrls[1]), "SQL INNER JOIN tutorial");
}});

Deno.test({ name: "resources: 3 or more results means no second search", ...opts, fn: async () => {
  const seen = await withFakeWeb(() => json({ results: [result(1), result(2), result(3)] }), async () => {
    assertEquals((await findResources(level)).length, 3);
  });
  assertEquals(seen.keenableUrls.length, 1);
}});

Deno.test({ name: "resources: both searches empty means no resources", ...opts, fn: async () => {
  const seen = await withFakeWeb(() => json({ results: [] }), async () => {
    assertEquals(await findResources(level), []);
  });
  assertEquals(seen.keenableUrls.length, 2);
}});

Deno.test({ name: "resources: a level with one concept doesn't repeat the identical search", ...opts, fn: async () => {
  const oneConcept = { ...level, concepts: ["INNER JOIN"] };
  const seen = await withFakeWeb(() => json({ results: [result(1)] }), async () => {
    assertEquals((await findResources(oneConcept)).length, 1);
  });
  assertEquals(seen.keenableUrls.length, 1);
}});
