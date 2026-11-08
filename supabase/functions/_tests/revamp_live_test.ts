// LIVE test: revamp-resume with the real Gemini API, for a pasted resume AND for a PDF.
// Scenario: a junior developer applying to a full-stack job. They beat the Docker boss, so Docker may be
// added. AWS and Agile are gaps they did NOT beat, so they must not appear anywhere.
// The sample resume is a made-up person. Gemini varies a little between runs.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { generateRevamp, mentions, type RevampedResume } from "../revamp-resume/revamp.ts";

const live = !!Deno.env.get("GEMINI_API_KEY");
const sample = (f: string) => new URL(`./samples/${f}`, import.meta.url);
const rules = { allowedNew: ["Docker"], owned: ["React", "TypeScript", "SQL", "Git", "REST APIs"], blocked: ["AWS", "Agile"] };

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
const numbersIn = (s: string) => s.match(/\d+/g) ?? [];

function show(label: string, r: RevampedResume) {
  console.log(`\n=== ${label}`);
  console.log(`contact : ${r.contact}\nheadline: ${r.headline}\nsummary : ${r.summary}`);
  console.log(`skills  : ${r.skills.join(", ")}\nadded   : ${r.added_skills.join(", ")}`);
  for (const sec of r.sections) {
    console.log(`[${sec.title}]`);
    for (const it of sec.items) {
      console.log(`  ${it.heading} | ${it.subheading} | ${it.dates}`);
      it.bullets.forEach((b) => console.log(`    - ${b}`));
    }
  }
  console.log("changes:");
  r.changes.forEach((c) => console.log(`  ${c.type} @ ${c.where}: ${c.before ? `"${c.before}" -> ` : ""}"${c.after}"  (${c.reason})`));
}

function check(r: RevampedResume, original: string) {
  const everything = [r.contact, r.headline, r.summary, ...r.skills, ...r.sections.flatMap((s) => s.items.flatMap((i) => [i.heading, i.subheading, i.dates, ...i.bullets]))].join("\n");
  // Earned skill added, nothing blocked anywhere.
  assert(r.skills.some((s) => mentions(s, "Docker")), "the earned skill Docker should be in skills");
  assertEquals(r.added_skills, ["Docker"]);
  for (const b of rules.blocked) assert(!mentions(everything, b), `${b} must not appear anywhere`);
  // Facts copied from the resume: contact, employers, titles, schools, dates. Each item's non-empty fields
  // must all appear together on ONE line of the original, so a date can't be borrowed from another job.
  assert(r.contact.includes("Jordan Lee") && r.contact.includes("jordan.lee@example.com"), "the contact line should keep the name and email");
  const lines = original.split("\n").map(normalize);
  for (const sec of r.sections) {
    for (const it of sec.items) {
      const fields = [it.heading, it.subheading, it.dates].map(normalize).filter(Boolean);
      assert(lines.some((line) => fields.every((f) => line.includes(f))), `"${it.heading} | ${it.subheading} | ${it.dates}" is not on one line of the original resume`);
    }
  }
  // Bullets must be backed by the resume: most of their words appear in it (rewording is fine, filler is not).
  const sourceWords = new Set(normalize(original).split(" "));
  const stop = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "by", "as", "at", "using", "used"]);
  for (const sec of r.sections) for (const it of sec.items) for (const b of it.bullets) {
    const words = normalize(b).split(" ").filter((w) => w && !stop.has(w));
    const backed = words.filter((w) => sourceWords.has(w)).length / Math.max(words.length, 1);
    assert(backed >= 0.5, `bullet is not backed by the resume (${Math.round(backed * 100)}% of its words): "${b}"`);
  }
  // No invented numbers.
  const known = new Set(numbersIn(original));
  for (const n of numbersIn([r.headline, r.summary, ...r.sections.flatMap((s) => s.items.flatMap((i) => i.bullets))].join(" "))) {
    assert(known.has(n), `the number ${n} is not in the original resume`);
  }
  // Earned skills are not slipped into past jobs.
  for (const sec of r.sections) for (const it of sec.items) for (const b of it.bullets) assert(!mentions(b, "Docker"), "Docker must not be claimed inside a past job");
  assert(r.changes.length > 0, "every edit should be listed in changes");
}

Deno.test({ name: "revamp: a pasted resume", ignore: !live, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const text = await Deno.readTextFile(sample("resume1.txt"));
  const r = await generateRevamp({ jobTitle: "Junior Full-Stack Developer", company: "Bow River Software", rules, resumeText: text });
  show("pasted text", r);
  check(r, text);
}});

Deno.test({ name: "revamp: a PDF resume", ignore: !live, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const text = await Deno.readTextFile(sample("resume1.txt")); // the PDF holds the same words
  const bytes = await Deno.readFile(sample("resume1.pdf"));
  const pdfBase64 = btoa(String.fromCharCode(...bytes));
  const r = await generateRevamp({ jobTitle: "Junior Full-Stack Developer", company: "Bow River Software", rules, pdfBase64 });
  show("PDF", r);
  check(r, text);
}});
