// send-resume: emails the revamped resume PDF (made by Person A's resume builder) via AWS SES.
// Input  { plan_id, to, pdfBase64 }   Output { ok: true }
// - The email is a short note + the PDF. Everything in the note (job title, company, skills
//   earned) is read from the database here — the app sends no text, so our sender address
//   can't be used to email arbitrary content.
// - Only for plans where the player beat at least one stage boss (same rule as the revamp).
// - Rate limited per user AND globally, reserved atomically before sending (migration 003).
// - Nothing about the resume is stored; the log keeps only user, time and recipient DOMAIN.
// Secrets: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL
//          (optional SES_FROM_NAME, default "SkillQuest").
import { SESv2Client, SendEmailCommand } from "npm:@aws-sdk/client-sesv2@3";
import { handle, json, UserError } from "../_shared/cors.ts";
import { admin, requireUserId } from "../_shared/supabase.ts";
import { buildMime, cleanNote, noteHtml, noteSubject, noteText } from "../_shared/resume_email.ts";

// ASCII-only addresses (SES raw headers can't carry non-ASCII mailboxes).
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_PDF_BASE64 = 7_000_000; // ~5 MB file
const MAX_BODY_BYTES = 8_000_000;

const region = Deno.env.get("AWS_REGION");
const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const fromEmail = Deno.env.get("SES_FROM_EMAIL");
const fromName = Deno.env.get("SES_FROM_NAME") || "SkillQuest";
const ses = region && accessKeyId && secretAccessKey
  ? new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } })
  : null;

Deno.serve(handle(async (req) => {
  const userId = await requireUserId(req);
  if (!ses || !fromEmail) throw new UserError("Email isn't set up on the server yet (AWS SES secrets missing).", 500);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new UserError("That's too big to email (max 5 MB PDF).", 413);

  const body = await req.json().catch(() => null);
  const planId = String(body?.plan_id ?? "");
  const to = String(body?.to ?? "").trim().toLowerCase();
  const pdfBase64 = typeof body?.pdfBase64 === "string" ? body.pdfBase64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";

  if (!UUID_RE.test(planId)) throw new UserError("Missing or invalid plan_id.");
  if (to.length > 254 || !EMAIL_RE.test(to)) throw new UserError("Enter a valid email address.");
  if (!pdfBase64) throw new UserError("There's no resume PDF to send yet. Revamp your resume first.");
  if (pdfBase64.length > MAX_PDF_BASE64) throw new UserError("That PDF is too big to email (max 5 MB).", 413);
  if (pdfBase64.length % 4 !== 0 || !BASE64_RE.test(pdfBase64) || !pdfBase64.startsWith("JVBER")) {
    throw new UserError("The attachment isn't a valid PDF.");
  }

  // The plan must belong to the caller (same 404 whether missing or someone else's)...
  const plan = await admin.from("plans").select("id, user_id, job_title, company").eq("id", planId).maybeSingle();
  if (plan.error) throw new Error(`load plan: ${plan.error.message}`);
  if (!plan.data || plan.data.user_id !== userId) throw new UserError("Plan not found.", 404);

  // ...and the player must have beaten at least one stage boss on it (server-side check).
  // The beaten stages' skills are also the "skills you earned" listed in the email.
  const beaten = await admin.from("levels")
    .select("id, stage:stages!inner(plan_id, skill:skills!inner(name))")
    .eq("stage.plan_id", planId).eq("type", "boss").eq("status", "completed");
  if (beaten.error) throw new Error(`check boss: ${beaten.error.message}`);
  if (!beaten.data?.length) throw new UserError("Beat a stage boss first to unlock your revamped resume.", 409);
  const earnedSkills = (beaten.data as unknown as { stage: { skill: { name: string } } }[])
    .map((l) => l.stage?.skill?.name).filter((n): n is string => !!n);

  // Reserve the send (locks, checks per-user + global limits, logs) BEFORE talking to SES.
  const domain = to.split("@")[1];
  const reserved = await admin.rpc("reserve_resume_email", {
    p_user_id: userId, p_plan_id: planId, p_recipient_domain: domain, p_with_pdf: true,
  });
  if (reserved.error) {
    if (/rate_limited_user/.test(reserved.error.message)) {
      throw new UserError("You've sent a lot of emails recently. Please try again later.", 429);
    }
    if (/rate_limited_global/.test(reserved.error.message)) {
      throw new UserError("Email is busy right now. Please use the download option or try later.", 429);
    }
    throw new Error(`reserve email: ${reserved.error.message}`);
  }
  const logId = reserved.data as string;

  const note = cleanNote({ jobTitle: plan.data.job_title ?? "", company: plan.data.company, earnedSkills });
  const filename = `${note.jobTitle.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "Revamped"} - resume.pdf`;
  const mime = buildMime({
    fromName,
    fromEmail,
    to,
    subject: noteSubject(note),
    html: noteHtml(note),
    text: noteText(note),
    pdf: { base64: pdfBase64, filename },
  });

  try {
    await ses.send(new SendEmailCommand({ Content: { Raw: { Data: new TextEncoder().encode(mime) } } }));
  } catch (err) {
    // A failed send must not count against the limit.
    await admin.from("resume_emails").delete().eq("id", logId);
    const name = (err as { name?: string })?.name ?? "Error";
    console.error("SES send failed:", name); // name only: SES messages can contain the recipient address
    switch (name) {
      case "MessageRejected":
        // In SES sandbox this is "address not verified"; out of sandbox it's a content/address rejection.
        throw new UserError("That address can't receive email from us yet (the email service may still be in test mode). Use the download option instead.", 400);
      case "TooManyRequestsException":
      case "LimitExceededException":
        throw new UserError("The email service is busy. Please try again in a minute.", 503);
      case "SendingPausedException":
      case "AccountSuspendedException":
      case "MailFromDomainNotVerifiedException":
        throw new UserError("Email sending is turned off right now. Please use the download option.", 503);
      default:
        throw new UserError("Couldn't send the email. Please try again or use the download option.", 502);
    }
  }

  return json({ ok: true });
}));
