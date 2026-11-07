// Resource-usage analytics (Person B). Every play of a level gets a run id; answers and
// resource opens are tagged with it so the team can compare scores with vs without resources
// (see the analytics.* views in supabase/migrations/002_progress.sql). All writes are
// fire-and-forget: analytics must never block or break the game.
import { USE_MOCK, ensureSession } from "./api";
import { supabase } from "./supabase";
import type { ResourceOpen } from "./types";

/** Random v4 UUID (Hermes has no crypto.randomUUID everywhere; good enough for analytics ids). */
export function newRunId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Saves one "resource opened" row. Never throws. */
export function recordResourceOpen(open: ResourceOpen): void {
  if (USE_MOCK) {
    console.log("[mock analytics] resource opened", open);
    return;
  }
  ensureSession()
    .then(async () => {
      const { error } = await supabase.from("resource_opens").insert({
        resource_id: open.resource_id,
        level_id: open.level_id,
        question_id: open.question_id,
        run_id: open.run_id,
        duration_ms: open.duration_ms === null ? null : Math.max(0, Math.min(Math.round(open.duration_ms), 86_400_000)),
      });
      if (error) console.warn("resource open not saved:", error.message);
    })
    .catch(() => {});
}
