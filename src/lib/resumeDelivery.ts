// End of the game (Person B): know when a player has finished the whole map, and email
// their revamped resume PDF (made by Person A's resume builder) through the send-resume
// Edge Function (AWS SES). The server writes the short note (job title, skills earned) from
// the database. No UI here — screens call these when the buttons are added.
import { AppError, USE_MOCK, ensureSession, functionError } from "./api";
import { supabase } from "./supabase";
import type { PlanBundle } from "./types";

// ------------------------------------------------------------------ quest progress

export interface QuestProgress {
  stagesTotal: number;
  stagesBeaten: number; // stage boss completed
  complete: boolean; // every stage boss beaten
  canRevamp: boolean; // at least one boss beaten (revamp-resume needs one)
}

/** Same "beaten" rule as the database: a stage is beaten when its boss level is completed. */
export function questProgress(bundle: PlanBundle): QuestProgress {
  const stagesTotal = bundle.stages.length;
  const stagesBeaten = bundle.stages.filter((s) =>
    s.levels.some((l) => l.type === "boss" && l.status === "completed"),
  ).length;
  return {
    stagesTotal,
    stagesBeaten,
    complete: stagesTotal > 0 && stagesBeaten === stagesTotal,
    canRevamp: stagesBeaten > 0,
  };
}

/** True once the player has beaten every stage boss on the map. */
export const isQuestComplete = (bundle: PlanBundle) => questProgress(bundle).complete;

// ------------------------------------------------------------------ email

// Same rules as send-resume (ASCII-only address; PDF up to ~5 MB as base64).
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const MAX_PDF_BASE64 = 7_000_000;

export interface EmailResumeInput {
  planId: string;
  to: string;
  /** The revamped resume as a PDF, base64 (a data: prefix is fine), from Person A's builder. */
  pdfBase64: string;
}

/**
 * Emails the revamped resume PDF to `to`.
 * Errors are AppErrors with a message safe to show (e.g. SES test mode, rate limit, no boss beaten).
 */
export async function emailResume(input: EmailResumeInput): Promise<void> {
  const to = input.to.trim().toLowerCase();
  if (!EMAIL_RE.test(to)) throw new AppError("Enter a valid email address.");
  const pdf = (input.pdfBase64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!pdf) throw new AppError("There's no resume PDF to send yet. Revamp your resume first.");
  if (pdf.length > MAX_PDF_BASE64) throw new AppError("That PDF is too big to email (max 5 MB).");
  if (!pdf.startsWith("JVBER")) throw new AppError("The attachment isn't a valid PDF.");
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 800));
    console.log("[mock] resume email sent to", to);
    return;
  }
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<{ ok: boolean }>("send-resume", {
    body: { plan_id: input.planId, to, pdfBase64: pdf },
  });
  if (error) throw await functionError(error, "Couldn't email your resume.", "send-resume");
  if (!data?.ok) throw new AppError("Couldn't email your resume. Please try again.");
}
