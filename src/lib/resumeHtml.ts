// Turns the revamped resume (the JSON from the revamp-resume function) into a clean one-page HTML resume.
// resumePdf.ts prints this HTML to a PDF. No Expo imports here, so it can be tested on its own.

// Same shape as RevampedResume in types.ts. Only the fields the page needs.
export interface ResumeData {
  contact: string;
  headline: string;
  summary: string;
  skills: string[];
  sections: { title: string; items: { heading: string; subheading: string; dates: string; bullets: string[] }[] }[];
}

/** Escape text so it can never be read as HTML (the resume comes from a PDF and an AI). */
const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clean = (s: string | undefined) => String(s ?? "").trim();

/** "Jordan Lee | a@b.com | 403-555-0142" -> the name, and the rest as one line. */
function splitContact(contact: string): { name: string; details: string } {
  const parts = clean(contact).split(/\s*[|·•]\s*/).filter(Boolean);
  return { name: parts[0] ?? "", details: parts.slice(1).join("  ·  ") };
}

export function buildResumeHtml(resume: ResumeData): string {
  const { name, details } = splitContact(resume.contact);
  const headline = clean(resume.headline);
  const summary = clean(resume.summary);
  const skills = (resume.skills ?? []).map(clean).filter(Boolean);

  const sections = (resume.sections ?? [])
    .map((section) => {
      const items = (section.items ?? [])
        .map((item) => {
          const heading = clean(item.heading), subheading = clean(item.subheading), dates = clean(item.dates);
          const bullets = (item.bullets ?? []).map(clean).filter(Boolean);
          if (!heading && !subheading && !dates && bullets.length === 0) return "";
          return `<div class="item">
  ${heading || dates ? `<div class="row"><span class="heading">${esc(heading)}</span>${dates ? `<span class="dates">${esc(dates)}</span>` : ""}</div>` : ""}
  ${subheading ? `<div class="sub">${esc(subheading)}</div>` : ""}
  ${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
</div>`;
        })
        .filter(Boolean);
      if (items.length === 0) return "";
      return `<h2>${esc(clean(section.title))}</h2>\n${items.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(name || "Resume")}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; padding: 40px 46px; }
  h1 { font-size: 21pt; margin: 0; letter-spacing: 0.3px; }
  .headline { font-size: 11.5pt; color: #333; margin-top: 2px; }
  .contact { font-size: 9.5pt; color: #444; margin-top: 4px; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #999; padding-bottom: 2px; margin: 14px 0 6px; }
  p { margin: 0; }
  .item { margin-bottom: 7px; page-break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .heading { font-weight: 700; }
  .dates { color: #444; white-space: nowrap; }
  .sub { font-style: italic; color: #333; }
  ul { margin: 3px 0 0; padding-left: 18px; }
  li { margin-bottom: 1px; }
</style>
</head>
<body>
${name ? `<h1>${esc(name)}</h1>` : ""}
${headline ? `<div class="headline">${esc(headline)}</div>` : ""}
${details ? `<div class="contact">${esc(details)}</div>` : ""}
${summary ? `<h2>Summary</h2>\n<p>${esc(summary)}</p>` : ""}
${skills.length ? `<h2>Skills</h2>\n<p>${skills.map(esc).join("  ·  ")}</p>` : ""}
${sections}
</body>
</html>`;
}
