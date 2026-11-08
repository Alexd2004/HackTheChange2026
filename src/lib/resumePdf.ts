// Makes a PDF of the revamped resume on the phone (Person A). The PDF can be shared (uri) or emailed with
// emailResume() from resumeDelivery.ts (base64): the send-resume function only accepts a real PDF.
//
//   const revamped = await supabase.functions.invoke("revamp-resume", { body: { plan_id, resume } });
//   const pdf = await createResumePdf(revamped);       // { uri, base64, pages }
//   await emailResume({ planId, to, pdfBase64: pdf.base64 });
//   // or share it: Sharing.shareAsync(pdf.uri)  (expo-sharing)
import * as Print from "expo-print";
import { buildResumeHtml } from "./resumeHtml";
import type { RevampedResume } from "./types";

export interface ResumePdf {
  uri: string; // file on the phone, for sharing or previewing
  base64: string; // the PDF as base64, for emailing
  pages: number;
}

// US Letter in points (what Canadian employers use).
const LETTER = { width: 612, height: 792 };
// send-resume accepts at most this many base64 characters (about 5 MB).
const MAX_BASE64 = 7_000_000;

export async function createResumePdf(resume: RevampedResume): Promise<ResumePdf> {
  const out = await Print.printToFileAsync({ html: buildResumeHtml(resume), base64: true, ...LETTER });
  const base64 = (out.base64 ?? "").replace(/\s+/g, "");
  if (!base64.startsWith("JVBER")) throw new Error("Couldn't create the resume PDF. Please try again.");
  if (base64.length > MAX_BASE64) throw new Error("The resume PDF came out too large to email.");
  return { uri: out.uri, base64, pages: out.numberOfPages };
}
