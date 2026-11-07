// Builds the "your revamped resume" email for send-resume: a SHORT note + the PDF that
// Person A's resume builder makes. Every fact in the note (job title, company, skills earned)
// comes from the database, never from the app, and is escaped — so our sender address can't
// be used to email arbitrary text. Pure TypeScript, no imports, so it's easy to test.

export interface ResumeNote {
  jobTitle: string; // plans.job_title
  company: string | null; // plans.company
  earnedSkills: string[]; // skills whose stage boss was beaten
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const clip = (s: string, max: number) => Array.from(s.replace(/\s+/g, " ").trim()).slice(0, max).join("");

/** Normalizes the DB values (trims, caps lengths/counts) before they go into the email. */
export function cleanNote(n: ResumeNote): ResumeNote {
  return {
    jobTitle: clip(n.jobTitle || "your target role", 120),
    company: n.company ? clip(n.company, 120) : null,
    earnedSkills: [...new Set(n.earnedSkills.map((s) => clip(s, 60)).filter(Boolean))].slice(0, 12),
  };
}

const role = (n: ResumeNote) => (n.company ? `${n.jobTitle} at ${n.company}` : n.jobTitle);

export function noteSubject(n: ResumeNote): string {
  return `Your revamped resume for ${n.jobTitle}`;
}

/** Email body (HTML, inline styles only — most email clients ignore <style> blocks). */
export function noteHtml(raw: ResumeNote): string {
  const n = cleanNote(raw);
  const e = escapeHtml;
  const skills = n.earnedSkills.length
    ? `<p style="margin:0 0 8px">You earned <b>${n.earnedSkills.length} new skill${n.earnedSkills.length === 1 ? "" : "s"}</b> by beating stage bosses:</p>
       <p style="margin:0 0 16px">${n.earnedSkills.map((s) => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:3px 10px;border-radius:12px;background:#ECFDF5;color:#047857;font-weight:600">${e(s)}</span>`).join("")}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F9FAFB;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 4px;color:#047857;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:12px">SkillQuest</p>
    <h1 style="margin:0 0 14px;font-size:20px">Your revamped resume is attached</h1>
    <p style="margin:0 0 14px">Here's your updated resume for <b>${e(role(n))}</b>.</p>
    ${skills}
    <p style="margin:0">Open the attached PDF to review it before you apply. Good luck!</p>
    <p style="margin:24px 0 0;font-size:12px;color:#6B7280">You asked SkillQuest to send this. We don't keep a copy of your resume.</p>
  </div></body></html>`;
}

/** Plain-text version (for clients that don't show HTML). */
export function noteText(raw: ResumeNote): string {
  const n = cleanNote(raw);
  const lines = ["Your revamped resume is attached", "", `Here's your updated resume for ${role(n)}.`];
  if (n.earnedSkills.length) {
    lines.push("", `You earned ${n.earnedSkills.length} new skill${n.earnedSkills.length === 1 ? "" : "s"} by beating stage bosses: ${n.earnedSkills.join(", ")}.`);
  }
  lines.push("", "Open the attached PDF to review it before you apply. Good luck!", "", "You asked SkillQuest to send this. We don't keep a copy of your resume.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- MIME

const enc = new TextEncoder();
const b64 = (s: string) => {
  let bin = "";
  for (const byte of enc.encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
};
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
/**
 * RFC 2047 encoded-words so non-ASCII subjects/names survive. Long text is split into
 * several encoded-words (each under 75 chars) on folded lines, so no header line passes 998.
 */
function encodeHeader(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const chunks: string[] = [];
  let cur = "";
  for (const ch of Array.from(s)) { // by character: never splits an emoji between words
    if (enc.encode(cur + ch).length > 40) { chunks.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => `=?UTF-8?B?${b64(c)}?=`).join("\r\n ");
}

/** "Name <email>" with the display name quoted or encoded so commas/accents can't break it. */
function formatAddress(name: string, email: string): string {
  const n = oneLine(name).replace(/["\\]/g, "");
  if (!n) return email;
  return /^[\x20-\x7E]*$/.test(n) ? `"${n}" <${email}>` : `${encodeHeader(n)} <${email}>`;
}
/** Strip CR/LF so values can't inject extra headers. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function buildMime(opts: {
  fromName: string; // e.g. "SkillQuest"
  fromEmail: string; // e.g. "resume@yourdomain.com" (verified in SES)
  to: string;
  subject: string;
  html: string;
  text: string;
  pdf: { base64: string; filename: string };
}): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  const mixed = `mixed_${id}`;
  const alt = `alt_${id}`;
  const filename = oneLine(opts.pdf.filename || "resume.pdf").replace(/["\\]/g, "");
  const parts = [
    `From: ${formatAddress(opts.fromName, oneLine(opts.fromEmail))}`,
    `To: ${oneLine(opts.to)}`,
    `Subject: ${encodeHeader(Array.from(oneLine(opts.subject)).slice(0, 120).join(""))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(opts.text)),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(opts.html)),
    `--${alt}--`,
  ];
  {
    parts.push(
      `--${mixed}`,
      `Content-Type: application/pdf; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(opts.pdf.base64.replace(/\s+/g, "")),
    );
  }
  parts.push(`--${mixed}--`, "");
  return parts.join("\r\n");
}
