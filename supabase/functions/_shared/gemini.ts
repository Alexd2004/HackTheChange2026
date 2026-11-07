// One helper for every Gemini call: send a prompt (+ optional file parts) and get back
// JSON that matches `schema`. Retries once if the call or JSON parsing fails.
import { GoogleGenAI } from "npm:@google/genai@1";
import { UserError } from "./cors.ts";

const apiKey = Deno.env.get("GEMINI_API_KEY");
const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function callGemini<T>(
  prompt: string,
  schema: Record<string, unknown>,
  parts: Part[] = [],
  temperature = 0.4,
): Promise<T> {
  if (!ai) throw new UserError("The AI key isn't set up on the server (GEMINI_API_KEY).", 500);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [...parts, { text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature,
        },
      });
      const text = res.text ?? "";
      return JSON.parse(text) as T;
    } catch (err) {
      lastError = err;
      console.warn(`Gemini attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.error("Gemini failed twice", lastError);
  throw new UserError("The AI is busy or returned something unreadable. Please try again.", 502);
}
