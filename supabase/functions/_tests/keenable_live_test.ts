// LIVE test: calls the real Keenable API (needs KEENABLE_API_KEY in supabase/functions/.env).
import { assert } from "jsr:@std/assert@1";
import { searchResources } from "../_shared/keenable.ts";

Deno.test({
  name: "keenable: a real search returns parsed resources",
  ignore: !Deno.env.get("KEENABLE_API_KEY"),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const results = await searchResources("SQL joins INNER JOIN LEFT JOIN tutorial");
    for (const r of results) console.log(`- ${r.title}\n  ${r.url}`);
    assert(results.length >= 1, "expected at least one resource (is the key valid?)");
    for (const r of results) assert(r.title && r.url.startsWith("http"));
  },
});
