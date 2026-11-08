// Tests for the resume page that gets printed to a PDF (src/lib/resumeHtml.ts). No network, no Expo.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildResumeHtml, type ResumeData } from "../../../src/lib/resumeHtml.ts";

const resume: ResumeData = {
  contact: "Jordan Lee | jordan.lee@example.com | 403-555-0142 | github.com/jordanlee",
  headline: "Junior Full-Stack Developer",
  summary: "BSc Computer Science student. Recently trained in Docker.",
  skills: ["React", "TypeScript", "Docker"],
  sections: [
    { title: "Experience", items: [{
      heading: "Software Developer Intern", subheading: "Prairie Logistics", dates: "May-Aug 2024",
      bullets: ["Built features for a React dashboard.", "Used Git and pull requests daily on a team of 6."],
    }] },
    { title: "Education", items: [{ heading: "BSc Computer Science", subheading: "University of Calgary", dates: "2021-2025", bullets: [] }] },
  ],
};

Deno.test("resume page: has the name, headline, contact, summary, skills and every section", () => {
  const html = buildResumeHtml(resume);
  for (const text of ["Jordan Lee", "Junior Full-Stack Developer", "jordan.lee@example.com", "403-555-0142",
    "Recently trained in Docker", "TypeScript", "Software Developer Intern", "Prairie Logistics", "May-Aug 2024",
    "Built features for a React dashboard.", "BSc Computer Science", "University of Calgary"]) {
    assert(html.includes(text), `the page should contain "${text}"`);
  }
  assert(html.startsWith("<!DOCTYPE html>"));
});

Deno.test("resume page: the name is the big heading and the rest of the contact line sits under it", () => {
  const html = buildResumeHtml(resume);
  assert(html.includes("<h1>Jordan Lee</h1>"));
  assert(html.includes("jordan.lee@example.com  ·  403-555-0142  ·  github.com/jordanlee"));
  assert(!html.includes("Jordan Lee | "), "the | separators should not appear on the page");
});

Deno.test("resume page: text from the resume can never be read as HTML", () => {
  const html = buildResumeHtml({
    ...resume,
    contact: "Jordan <b>Lee</b> | a@b.com",
    sections: [{ title: "Experience", items: [{ heading: "Dev <script>alert(1)</script>", subheading: "R&D \"Labs\"", dates: "2024",
      bullets: ["Cut load time by <50% & fixed <img src=x onerror=alert(1)>"] }] }],
  });
  assert(!html.includes("<script>"), "no script tag");
  assert(!html.includes("<img"), "no img tag");
  assert(!html.includes("<b>Lee</b>"));
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert(html.includes("R&amp;D &quot;Labs&quot;"));
});

Deno.test("resume page: the page itself loads nothing from the internet", () => {
  const html = buildResumeHtml(resume);
  assert(!/<link|<script|<iframe|src=|@import|url\(/i.test(html));
});

Deno.test("resume page: empty fields leave no empty gaps", () => {
  const html = buildResumeHtml({
    contact: "Jordan Lee",
    headline: "",
    summary: "",
    skills: [],
    sections: [
      { title: "Projects", items: [{ heading: "Trail Buddy", subheading: "", dates: "", bullets: ["Hiking app."] }] },
      { title: "Empty section", items: [] },
      { title: "Blank items", items: [{ heading: "", subheading: "", dates: "", bullets: [] }] },
    ],
  });
  assert(!html.includes('class="dates"'), "no empty dates element");
  assert(!html.includes('class="sub"'), "no empty subheading element");
  assert(!html.includes("Summary") && !html.includes("<h2>Skills"), "no Summary or Skills heading when there is none");
  assert(!html.includes("Empty section") && !html.includes("Blank items"), "sections with nothing in them are left out");
  assert(html.includes("Trail Buddy") && html.includes("<li>Hiking app.</li>"));
  assertEquals(html.split("<ul>").length - 1, 1, "only the item that has bullets gets a list");
});

Deno.test("resume page: a contact line with no separators is just the name", () => {
  const html = buildResumeHtml({ ...resume, contact: "Jordan Lee" });
  assert(html.includes("<h1>Jordan Lee</h1>"));
  assert(!html.includes('class="contact">'), "no contact details line");
});

Deno.test("resume page: a missing contact line doesn't break the page", () => {
  const html = buildResumeHtml({ ...resume, contact: "" });
  assert(html.includes("<title>Resume</title>"));
  assert(!html.includes("<h1>"));
  assert(html.includes("Software Developer Intern"));
});

Deno.test("resume page: sections keep the order the revamp gave them", () => {
  const html = buildResumeHtml(resume);
  assert(html.indexOf("Experience") < html.indexOf("Education"));
});
