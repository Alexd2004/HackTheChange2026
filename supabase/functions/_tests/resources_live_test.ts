// LIVE test: real Keenable search, then the real Gemini picker (needs both keys in supabase/functions/.env).
import { assert } from "jsr:@std/assert@1";
import { findResources } from "../_shared/resources.ts";
import { searchResources } from "../_shared/keenable.ts";

const live = !!Deno.env.get("GEMINI_API_KEY") && !!Deno.env.get("KEENABLE_API_KEY");

const levels = [
  { skill: "SQL", title: "Joining tables", objective: "Combine rows from two tables with joins.", concepts: ["INNER JOIN", "LEFT JOIN", "ON clause"] },
  { skill: "React", title: "Side Effects", objective: "Run code after render with useEffect.", concepts: ["useEffect hook", "Dependency array", "Cleanup functions"] },
];

for (const level of levels) {
  Deno.test({
    name: `resources: AI-picked links for "${level.skill}: ${level.title}"`,
    ignore: !live,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const query = `${level.skill} ${level.concepts.slice(0, 3).join(" ")} tutorial`;
      const raw = await searchResources(query, 8);
      console.log(`\nSearch gave ${raw.length} results:`);
      raw.forEach((r, i) => console.log(`  ${i + 1}. ${r.title}  (${new URL(r.url).hostname})`));

      const picked = await findResources(level);
      console.log(`AI picked ${picked.length}:`);
      picked.forEach((r) => console.log(`  - ${r.title}\n    ${r.url}\n    why: ${r.snippet}`));

      assert(picked.length >= 1 && picked.length <= 3, "expected 1 to 3 picks");
      assert(new Set(picked.map((r) => r.url)).size === picked.length, "picks should be different links");
      for (const r of picked) {
        assert(r.url.startsWith("http"));
        assert(raw.some((c) => c.url === r.url), "every pick must be one of the search results (no invented links)");
        assert(r.snippet.length > 0 && r.snippet.length <= 300);
      }
    },
  });
}

Deno.test({
  name: "resources: a nonsense level doesn't crash and doesn't invent links",
  ignore: !live,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const level = { skill: "Xyzzy", title: "Frobnication", objective: "Frobnicate the gizmo.", concepts: ["plugh", "frobnicate", "gizmo"] };
    const raw = await searchResources("Xyzzy plugh frobnicate gizmo tutorial", 8);
    const picked = await findResources(level);
    console.log(`\nSearch gave ${raw.length} results; the AI kept ${picked.length}:`);
    picked.forEach((r) => console.log(`  - ${r.title} (${new URL(r.url).hostname}) why: ${r.snippet}`));
    assert(picked.length <= 3);
    for (const r of picked) assert(raw.some((c) => c.url === r.url), "every pick must come from the search results");
  },
});
