// Keenable web search: finds learning resources for a level.
// Never throws. If Keenable fails, the level still works with no resources.

export interface FoundResource {
  title: string;
  url: string;
  snippet: string;
}

const API_KEY = Deno.env.get("KEENABLE_API_KEY");

export async function searchResources(query: string, keep = 3): Promise<FoundResource[]> {
  if (!API_KEY) {
    console.warn("KEENABLE_API_KEY not set; skipping resources");
    return [];
  }
  try {
    // Keenable takes `max_results` (not `count`; unknown parameters are rejected with a 400).
    const url = `https://api.keenable.ai/v1/search?query=${encodeURIComponent(query)}&max_results=5&snippet_max_length=300`;
    const res = await fetch(url, {
      headers: { "X-API-Key": API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn("Keenable HTTP", res.status, await res.text());
      return [];
    }
    // Response: { results: [{ title, url, description, snippet, ... }] }. `description` is often empty.
    const body = await res.json();
    const items: Record<string, unknown>[] = Array.isArray(body?.results) ? body.results : [];
    return items
      .map((r) => ({
        title: String(r.title ?? "").trim(),
        url: String(r.url ?? "").trim(),
        snippet: String(r.description || r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300),
      }))
      .filter((r) => r.title && /^https?:\/\//.test(r.url))
      .slice(0, keep);
  } catch (err) {
    console.warn("Keenable failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
