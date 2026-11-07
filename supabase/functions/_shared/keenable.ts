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
    const url = `https://api.keenable.ai/v1/search?query=${encodeURIComponent(query)}&count=5`;
    const res = await fetch(url, {
      headers: { "X-API-Key": API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn("Keenable HTTP", res.status, await res.text());
      return [];
    }
    const body = await res.json();
    // Accept the common response shapes; confirm against docs.keenable.ai with one curl.
    const items: Record<string, unknown>[] =
      body?.results ?? body?.data ?? body?.items ?? (Array.isArray(body) ? body : []);
    return items
      .map((r) => ({
        title: String(r.title ?? r.name ?? "").trim(),
        url: String(r.url ?? r.link ?? "").trim(),
        snippet: String(r.snippet ?? r.description ?? r.content ?? "").trim().slice(0, 300),
      }))
      .filter((r) => r.title && /^https?:\/\//.test(r.url))
      .slice(0, keep);
  } catch (err) {
    console.warn("Keenable failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
