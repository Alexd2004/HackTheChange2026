// findResources: searches the web for a level, then lets Gemini pick the best few links.
// Never throws. A level with no resources still works.
import { callGemini } from "./gemini.ts";
import { type FoundResource, searchResources } from "./keenable.ts";
import { type PickedResources, pickSchema } from "./schemas.ts";
import { pickResourcesPrompt } from "./prompts.ts";

const CANDIDATES = 8; // search results to choose from
const MIN_CANDIDATES = 3; // fewer than this and we search again with a simpler query
const MAX_PICKS = 3;

export async function findResources(level: {
  skill: string;
  title: string;
  objective: string;
  concepts: string[];
}): Promise<FoundResource[]> {
  const query = `${level.skill} ${level.concepts.slice(0, 3).join(" ")} tutorial`;
  let candidates = await searchResources(query, CANDIDATES);

  // A long, specific query can find very little. Try again with just the skill and the first concept.
  if (candidates.length < MIN_CANDIDATES) {
    const simpler = `${level.skill} ${level.concepts[0] ?? ""} tutorial`.replace(/\s+/g, " ");
    if (simpler !== query) {
      const more = await searchResources(simpler, CANDIDATES);
      const seenUrls = new Set(candidates.map((c) => c.url));
      candidates = [...candidates, ...more.filter((m) => !seenUrls.has(m.url))].slice(0, CANDIDATES);
    }
  }
  if (candidates.length === 0) return [];

  try {
    const out = await callGemini<PickedResources>(
      pickResourcesPrompt(level, candidates.map((c) => ({ title: c.title, host: hostOf(c.url), snippet: c.snippet.slice(0, 200) }))),
      pickSchema, [], 0,
    );

    // Picks are by number. Ignore numbers that don't exist and repeats, so a link can't be invented.
    const picked: FoundResource[] = [];
    const seen = new Set<number>();
    for (const p of out.picks ?? []) {
      const c = candidates[p.i - 1];
      if (!c || seen.has(p.i)) continue;
      seen.add(p.i);
      picked.push({ ...c, snippet: (p.why?.trim() || c.snippet).slice(0, 300) });
      if (picked.length === MAX_PICKS) break;
    }
    return picked;
  } catch (err) {
    // The AI picker failed (busy, timeout): the raw top results are still better than nothing.
    console.warn("pickResources failed, using the top search results:", err instanceof Error ? err.message : err);
    return candidates.slice(0, MAX_PICKS);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
