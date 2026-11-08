// findResources: searches the web for a level, then ranks the results in plain code (no AI call):
// well-known learning and documentation sites first, one link per site, obviously off-topic or
// sign-up/shopping/social pages dropped. Never throws. A level with no resources still works.
import { type FoundResource, searchResources } from "./keenable.ts";

const CANDIDATES = 8; // search results to choose from
const MIN_CANDIDATES = 3; // fewer than this and we search again with a simpler query
const MAX_PICKS = 3;

export async function findResources(level: {
  skill: string;
  title: string;
  objective: string;
  concepts: string[];
}): Promise<FoundResource[]> {
  try {
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
    return rankResources(candidates, level);
  } catch (err) {
    console.warn("findResources failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ---------------------------------------------------------------- ranking (exported for tests)

// Free, readable learning and documentation sites. Higher is better.
const TRUSTED_HOSTS: Record<string, number> = {
  "developer.mozilla.org": 4,
  "docs.python.org": 4,
  "learn.microsoft.com": 4,
  "docs.oracle.com": 3,
  "postgresql.org": 4,
  "dev.mysql.com": 3,
  "sqlite.org": 3,
  "react.dev": 4,
  "nodejs.org": 4,
  "typescriptlang.org": 4,
  "git-scm.com": 4,
  "kubernetes.io": 4,
  "docs.docker.com": 4,
  "docs.aws.amazon.com": 3,
  "cloud.google.com": 3,
  "freecodecamp.org": 3,
  "realpython.com": 3,
  "w3schools.com": 3,
  "geeksforgeeks.org": 2,
  "khanacademy.org": 3,
  "youtube.com": 2,
  "javascript.info": 3,
  "sqlbolt.com": 3,
  "mode.com": 2,
  "atlassian.com": 2,
  "digitalocean.com": 2,
  "tutorialspoint.com": 1,
  "programiz.com": 2,
  "wikipedia.org": 1,
};

// Pages that rarely teach anything to a beginner: social, shopping, Q&A threads behind sign-ups.
const BLOCKED_HOSTS = [
  "pinterest.com", "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com", "linkedin.com",
  "amazon.com", "ebay.com", "etsy.com", "quora.com", "scribd.com", "slideshare.net", "chegg.com", "coursehero.com",
];
// Often paywalled or thin: allowed, but ranked lower.
const WEAK_HOSTS = ["medium.com", "udemy.com", "coursera.org", "pluralsight.com", "reddit.com"];
const JUNK_PAGE = /\b(log ?in|sign ?(in|up)|pricing|buy now|coupon|jobs? (at|in)|careers?|salary|hiring)\b/i;

const STOPWORDS = new Set(["the", "and", "for", "with", "how", "what", "why", "use", "using", "your", "into", "from", "tutorial", "basics", "intro", "introduction"]);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, "");
  } catch {
    return "";
  }
}

const matchesHost = (host: string, list: string[] | string) =>
  (Array.isArray(list) ? list : [list]).some((h) => host === h || host.endsWith(`.${h}`));

function hostScore(host: string, url: string): number {
  for (const [h, score] of Object.entries(TRUSTED_HOSTS)) if (matchesHost(host, h)) return score;
  // Looks like official documentation (docs.foo.com, developer.foo.com, foo.dev/docs/...).
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch { /* scored on the host alone */ }
  if (/^(docs|developer|developers|learn)\./.test(host) || /^\/(docs|documentation|learn|tutorial)s?\b/.test(path)) return 2;
  if (matchesHost(host, WEAK_HOSTS)) return -1;
  return 0;
}

/** Words to look for: the skill and the level's concepts ("C++", "Node.js" and "LEFT JOIN" survive). */
function topicTerms(level: { skill: string; concepts: string[] }): string[] {
  const phrases = [level.skill, ...level.concepts].map((t) => t.toLowerCase().trim()).filter(Boolean);
  const words = phrases.flatMap((p) => p.split(/[\s/(),]+/))
    .map((w) => w.replace(/^[^a-z0-9#+.]+|[^a-z0-9#+]+$/g, ""))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  return [...new Set([...phrases, ...words])];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasTerm = (text: string, term: string) =>
  new RegExp(`(^|[^a-z0-9#+])${escapeRe(term)}($|[^a-z0-9#+])`).test(text);

/**
 * Ranks search results for a level and returns up to 3: trusted learning/doc sites first, then how many
 * of the level's words they mention, then the search engine's own order. One link per site. Results that
 * mention none of the skill or concepts (in the title, snippet or URL), and sign-up/shopping/social pages,
 * are dropped.
 */
export function rankResources(
  candidates: FoundResource[],
  level: { skill: string; concepts: string[] },
): FoundResource[] {
  const terms = topicTerms(level);
  const scored = candidates.flatMap((c, rank) => {
    const host = hostOf(c.url);
    if (!host || matchesHost(host, BLOCKED_HOSTS)) return [];
    if (JUNK_PAGE.test(c.title)) return [];
    const text = `${c.title} ${c.snippet} ${decodeURIComponentSafe(c.url).replace(/[-_/]+/g, " ")}`.toLowerCase();
    const relevance = terms.filter((t) => hasTerm(text, t)).length;
    if (relevance === 0) return []; // about something else
    return [{ c, host, rank, score: hostScore(host, c.url) * 2 + Math.min(relevance, 4) }];
  });
  scored.sort((a, b) => b.score - a.score || a.rank - b.rank);

  const picked: FoundResource[] = [];
  const seenHosts = new Set<string>();
  for (const s of scored) {
    if (seenHosts.has(s.host)) continue; // different sites over two links from the same one
    seenHosts.add(s.host);
    picked.push({ title: s.c.title.slice(0, 200), url: s.c.url, snippet: s.c.snippet.slice(0, 300) });
    if (picked.length === MAX_PICKS) break;
  }
  return picked;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
