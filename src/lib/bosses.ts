// Fixed names for each stage's final boss (stage 1 → Sir Talonstrike, 2 → Ironjaw, 3 → Whisperfang).
// The AI still writes the boss level's objective and questions; only the shown name is fixed.
import type { Level } from "./types";

export const BOSS_NAMES = ["Sir Talonstrike", "Ironjaw", "Whisperfang"] as const;

/** The name to show for a level: the fixed boss name for a stage's boss, otherwise its own title. */
export function levelTitle(level: Pick<Level, "type" | "title">, stageIdx: number): string {
  if (level.type !== "boss") return level.title;
  return BOSS_NAMES[stageIdx] ?? level.title; // plans have at most 3 stages; keep the AI title just in case
}
