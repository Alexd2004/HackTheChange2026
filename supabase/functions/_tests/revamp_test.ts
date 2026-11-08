// Tests for revamp-resume's logic: which skills may be added and the rules the code enforces on
// Gemini's reply. Gemini is faked, so there are no API calls and no keys needed.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("GEMINI_API_KEY", Deno.env.get("GEMINI_API_KEY") || "test-key");
const { classifySkills, enforceRules, generateRevamp, mentions } = await import("../revamp-resume/revamp.ts");

const skill = (id: string, name: string, is_gap: boolean, have_level: number) => ({ id, name, is_gap, have_level });
const raw = (over: Record<string, unknown> = {}) => ({
  contact: "Jordan Lee | jordan.lee@example.com",
  headline: "Junior Software Developer",
  summary: "A developer who builds web apps. Recently trained in Docker.",
  skills: ["React", "Node.js", "Docker"],
  sections: [{ title: "Experience", items: [{ heading: "Intern", subheading: "Prairie Logistics", dates: "2024", bullets: ["Built a React dashboard."] }] }],
  changes: [{ type: "reordered" as const, where: "Skills", before: null, after: "React first", reason: "Matches the job." }],
  ...over,
});
const rules = { allowedNew: ["Docker"], owned: ["React"], blocked: ["AWS", "Agile"] };

Deno.test("revamp: skills are sorted into earned, kept and blocked", () => {
  const r = classifySkills(
    [
      skill("1", "Docker", true, 0), // gap, boss beaten  -> may be added
      skill("2", "AWS", true, 0), // gap, not beaten, not on the resume -> blocked
      skill("3", "SQL", true, 1), // gap, not beaten, but already on the resume a little -> kept as written
      skill("4", "React", false, 2), // not a gap -> kept
    ],
    new Set(["1"]),
  );
  console.log(r);
  assertEquals(r, { allowedNew: ["Docker"], blocked: ["AWS"], owned: ["SQL", "React"] });
});

Deno.test("revamp: a skill is matched as a whole word", () => {
  assert(mentions("AWS (EC2)", "AWS"));
  assert(mentions("Deployed on aws.", "AWS"));
  assert(!mentions("GitHub Actions", "Git"));
  assert(mentions("C++ and C#", "C++"));
});

Deno.test("revamp: a blocked skill is removed from the skills list, including 'AWS (EC2)'", () => {
  const out = enforceRules(raw({ skills: ["React", "AWS (EC2)", "Agile", "Docker"] }), rules);
  assertEquals(out.skills, ["React", "Docker"]);
});

Deno.test("revamp: an earned skill the AI forgot is added, and listed in added_skills and changes", () => {
  const out = enforceRules(raw({ skills: ["React"] }), rules);
  assertEquals(out.skills, ["React", "Docker"]);
  assertEquals(out.added_skills, ["Docker"]);
  assert(out.changes.some((c) => c.type === "added_skill" && c.after === "Docker"));
});

Deno.test("revamp: duplicates are removed from skills", () => {
  const out = enforceRules(raw({ skills: ["React", "react", "Docker", "DOCKER"] }), rules);
  assertEquals(out.skills, ["React", "Docker"]);
});

Deno.test("revamp: sentences, bullets and headlines that mention a blocked skill are dropped", () => {
  const out = enforceRules(
    raw({
      headline: "Developer with AWS experience",
      summary: "Builds web apps. Skilled in AWS. Recently trained in Docker.",
      sections: [{ title: "Experience", items: [{ heading: "Intern", subheading: "Prairie Logistics", dates: "2024",
        bullets: ["Built a React dashboard.", "Deployed to AWS.", "Ran Agile sprints."] }] }],
    }),
    rules,
  );
  assertEquals(out.headline, "");
  assertEquals(out.summary, "Builds web apps. Recently trained in Docker.");
  assertEquals(out.sections[0].items[0].bullets, ["Built a React dashboard."]);
});

Deno.test("revamp: a change that adds a blocked skill is dropped, others are kept", () => {
  const out = enforceRules(
    raw({ changes: [
      { type: "added_skill", where: "Skills", before: null, after: "AWS", reason: "x" },
      { type: "reworded", where: "Experience", before: "old", after: "new", reason: "y" },
    ] }),
    rules,
  );
  assertEquals(out.changes.map((c) => c.after), ["new"]);
  assertEquals(out.changes[0].before, "old");
});

Deno.test("revamp: employers, titles and dates pass through untouched", () => {
  const out = enforceRules(raw(), rules);
  assertEquals(out.sections[0].items[0].subheading, "Prairie Logistics");
  assertEquals(out.sections[0].items[0].dates, "2024");
  assertEquals(out.contact, "Jordan Lee | jordan.lee@example.com");
});

Deno.test({
  name: "revamp: an unreadable AI reply is retried and never written to the logs",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const real = globalThis.fetch;
    const secret = "SECRET-RESUME-LINE-4242";
    const bad = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `not json ${secret}` }], role: "model" }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = (() => Promise.resolve(bad())) as typeof fetch;
    const logged: string[] = [];
    const realWarn = console.warn, realErr = console.error;
    console.warn = (...a: unknown[]) => { logged.push(a.join(" ")); };
    console.error = (...a: unknown[]) => { logged.push(a.join(" ")); };
    try {
      let threw = false;
      try {
        await generateRevamp({ jobTitle: "Dev", company: null, rules, resumeText: "my resume" });
      } catch {
        threw = true;
      }
      assert(threw, "two unreadable replies should end in an error");
    } finally {
      globalThis.fetch = real;
      console.warn = realWarn;
      console.error = realErr;
    }
    assert(logged.length > 0, "the failure should still be logged");
    assert(!logged.join("\n").includes(secret), "the reply (a resume) must not appear in logs");
  },
});
