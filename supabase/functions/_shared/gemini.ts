// One helper for every Gemini call: send a prompt (+ optional file parts) and get back
// JSON that matches `schema`. Each call has a timeout, retries once on rate limits, server
// errors, network blips and unreadable JSON, and logs how long it took.
import { GoogleGenAI } from "npm:@google/genai@1";
import { UserError } from "./cors.ts";

const apiKey = Deno.env.get("GEMINI_API_KEY");
// Pinned on purpose: a "-latest" alias can change behavior in the middle of the demo.
const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.1-flash-lite";
/**
 * A second model for light, high-volume calls (the answer check). The free tier's daily quota is per
 * model, so sending those calls to another model spreads the load. Falls back to GEMINI_MODEL.
 */
export const lightModel = Deno.env.get("GEMINI_MODEL_LIGHT") || model;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 1_500;
const RAW_LOG_CHARS = 500; // enough to debug a bad reply, short enough to avoid dumping a resume into logs

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** How hard the model thinks before answering. Lower is faster. Extraction doesn't need more than "low". */
export type Thinking = "minimal" | "low" | "high";

export interface GeminiOptions {
  thinking?: Thinking; // default "low"
  /** Log the start of an unreadable reply to help debugging. Set false when the reply contains a user's resume. */
  logRaw?: boolean; // default true
  /** Model for this call only (e.g. `lightModel`). Default GEMINI_MODEL. */
  model?: string;
}

export async function callGemini<T>(
  prompt: string,
  schema: Record<string, unknown>,
  parts: Part[] = [],
  temperature = 0.4,
  options: GeminiOptions = {},
): Promise<T> {
  if (!ai) throw new UserError("The AI key isn't set up on the server (GEMINI_API_KEY).", 500);
  const thinking = options.thinking ?? "low";
  const callModel = options.model || model;

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const res = await ai.models.generateContent({
        model: callModel,
        contents: [{ role: "user", parts: [...parts, { text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature,
          thinkingConfig: { thinkingLevel: thinking.toUpperCase() as never },
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      });
      const text = res.text ?? "";
      let parsed: T;
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        const raw = options.logRaw === false ? "(not logged: may contain a resume)" : text.slice(0, RAW_LOG_CHARS);
        console.warn(`Gemini returned unreadable JSON (attempt ${attempt}, ${text.length} chars): ${raw}`);
        lastError = new Error("unreadable JSON");
        continue; // retry straight away, a fresh sample usually fixes it
      }
      console.log(`Gemini ok: ${callModel} thinking=${thinking} ${Date.now() - started}ms (attempt ${attempt})`);
      return parsed;
    } catch (err) {
      lastError = err;
      const status = statusOf(err);
      console.warn(`Gemini (${callModel}) attempt ${attempt} failed after ${Date.now() - started}ms: ${status ?? ""} ${errMessage(err)}`);
      if (!isRetryable(err, status) || attempt === 2) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  console.error("Gemini gave up:", errMessage(lastError));
  throw toUserError(lastError);
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? `${msg.slice(0, 300)}...` : msg;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Retry rate limits (429), server errors (5xx) and network failures. Not timeouts or bad requests. */
function isRetryable(err: unknown, status: number | undefined): boolean {
  if (isTimeout(err)) return false; // a second 25 s wait would likely time out too
  if (status === undefined) return true; // network failure
  return status === 429 || status >= 500;
}

function toUserError(err: unknown): UserError {
  if (isTimeout(err)) return new UserError("The AI took too long to answer. Please try again.", 504);
  const status = statusOf(err);
  if (status === 429) return new UserError("The AI is getting a lot of requests right now. Wait a few seconds and try again.", 429);
  // Google reports a bad key as 400 (API_KEY_INVALID), not 401/403.
  if (status === 401 || status === 403 || errMessage(err).includes("API key not valid")) {
    return new UserError("The AI key was rejected by Google. Check GEMINI_API_KEY on the server.", 500);
  }
  if (status === 404) return new UserError("The AI model name isn't valid. Check GEMINI_MODEL (and GEMINI_MODEL_LIGHT) on the server.", 500);
  return new UserError("The AI is busy or returned something unreadable. Please try again.", 502);
}
