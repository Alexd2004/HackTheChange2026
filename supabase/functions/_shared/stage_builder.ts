// Designs ONE stage (its title, summary and 4 levels) with Gemini, and turns it into rows for the
// levels table. Shared by create-plan (stage 1, right away) and build-stage (the other stages, in
// the background), so both build stages exactly the same way.
import { callGemini } from "./gemini.ts";
import { mapSchema, type MapPlan } from "./schemas.ts";
import { buildMapPrompt } from "./prompts.ts";

// 3 fundamentals, then level 4 is the boss: a unit test of the three before it.
export const LEVEL_TYPES = ["normal", "normal", "normal", "boss"] as const;

export interface StageSkill {
  name: string;
  have: number; // 0-3 from the resume
  need: number; // 1-3 from the posting
}

export interface DesignedStage {
  title: string;
  summary: string;
  levels: { type: (typeof LEVEL_TYPES)[number]; idx: number; title: string; objective: string; concepts: string[] }[];
}

/** One Gemini call for one stage. Falls back to plain titles if the AI leaves anything out. */
export async function designStage(jobTitle: string, skill: StageSkill, mode: "gap" | "polish"): Promise<DesignedStage> {
  const map = await callGemini<MapPlan>(buildMapPrompt(jobTitle, [skill], mode), mapSchema, [], 0.7);
  const st = map.stages?.[0];
  return {
    title: st?.title?.slice(0, 60) || skill.name,
    summary: st?.summary?.slice(0, 240) || (mode === "polish" ? `Review your ${skill.name}.` : `Level up your ${skill.name}.`),
    levels: LEVEL_TYPES.map((type, li) => {
      const l = st?.levels?.[li];
      const concepts = (l?.concepts ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 4);
      return {
        type,
        idx: li,
        title: l?.title?.slice(0, 60) || (type === "boss" ? `${skill.name} Boss` : `${skill.name} ${li + 1}`),
        objective: l?.objective?.slice(0, 240) || `Practice ${skill.name}.`,
        concepts: concepts.length ? concepts : [skill.name],
      };
    }),
  };
}

/** Rows for the levels table. `firstUnlocked` opens level 1 of this stage. */
export function levelRows(stageId: string, stage: DesignedStage, firstUnlocked: boolean) {
  return stage.levels.map((l) => ({
    stage_id: stageId,
    idx: l.idx,
    type: l.type,
    title: l.title,
    objective: l.objective,
    concepts: l.concepts,
    status: firstUnlocked && l.idx === 0 ? "unlocked" : "locked",
  }));
}
