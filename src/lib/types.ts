// Shared data contract for SkillQuest. These types mirror the Postgres tables in
// supabase/migrations/001_init.sql and the mock files in src/mock. Change all three together.

export type LevelType = "normal" | "challenge" | "boss";
export type LevelStatus = "locked" | "unlocked" | "completed";
export type QuestionKind = "mcq" | "blank";

export interface Plan {
  id: string;
  job_title: string;
  company: string | null;
  match_pct: number;
  start_match_pct: number;
  xp: number;
  created_at: string;
}

export interface Skill {
  id: string;
  plan_id: string;
  name: string;
  weight: number; // 1-3, how much the posting cares
  required: boolean;
  have_level: number; // 0-3, from the resume
  need_level: number; // 1-3, from the posting
  is_gap: boolean; // have_level < need_level (the ORIGINAL gap from the resume; never changes)
  /** Set when the player beats this skill's stage boss (migration 006). Earned skills leave "To learn". */
  earned_at?: string | null;
}

export interface Stage {
  id: string;
  plan_id: string;
  skill_id: string;
  idx: number;
  title: string;
  summary: string;
  /** "pending"/"building" = still being designed in the background (migration 005). Missing = ready. */
  status?: "ready" | "pending" | "building";
}

export interface Level {
  id: string;
  stage_id: string;
  idx: number;
  type: LevelType;
  title: string;
  objective: string;
  concepts: string[];
  status: LevelStatus;
  best_score: number | null; // 0-100
  generated: boolean; // questions + resources exist
}

export interface Question {
  id: string;
  level_id: string;
  idx: number;
  kind: QuestionKind;
  prompt: string; // blank questions contain "____"
  options: string[] | null; // mcq only, 4 options
  correct_index: number | null; // mcq only
  answers: string[] | null; // blank only, accepted answers
  explanation: string;
  concept: string;
  difficulty: number; // 1-3
  /** AI-written nudge shown before answering; never contains the answer (checked in generate-level). */
  hint?: string | null;
}

export interface Resource {
  id: string;
  level_id: string;
  title: string;
  url: string;
  snippet: string;
}

export interface StageWithLevels extends Stage {
  levels: Level[];
}

/** Everything the map screen needs. */
export interface PlanBundle {
  plan: Plan;
  skills: Skill[];
  stages: StageWithLevels[];
}

/** Everything the level screen needs. */
export interface LevelBundle {
  plan_id: string;
  level: Level;
  stage: Stage;
  skill: Skill;
  questions: Question[];
  resources: Resource[];
}

/** Input for the create-plan Edge Function. */
export interface CreatePlanInput {
  resume: { pdfBase64: string } | { text: string };
  posting: string;
}

/** Result of complete_level(). */
export interface CompleteLevelResult {
  match_pct: number;
  xp: number;
  next_level_id: string | null;
}

// ---------------------------------------------------------------------------
// Step 0 contracts (docs/BACKEND_SPLIT.md). Agreed by both people.
// Append-only from here: add new types below, don't change these without telling the other person.
// ---------------------------------------------------------------------------

/** Input for the revamp-resume Edge Function (Person A). The resume comes from the phone, never the database. */
export interface RevampResumeInput {
  plan_id: string;
  resume: { pdfBase64: string } | { text: string };
}

export interface ResumeItem {
  heading: string; // e.g. job title or degree
  subheading: string; // e.g. company or school
  dates: string;
  bullets: string[];
}

export interface ResumeSection {
  title: string; // e.g. "Experience", "Education", "Projects"
  items: ResumeItem[];
}

export interface ResumeChange {
  type: "added_skill" | "reworded" | "reordered" | "removed";
  where: string; // e.g. "Experience > Junior Developer"
  before?: string;
  after: string;
  reason: string;
}

/** Output of revamp-resume. Errors come back as { error } with 400 / 404 / 409 (no boss beaten) / 502. */
export interface RevampedResume {
  contact: string;
  headline: string;
  summary: string;
  skills: string[];
  added_skills: string[]; // computed in code: skills earned by beating stage bosses
  sections: ResumeSection[];
  changes: ResumeChange[];
}

/** profiles table (Person B, migration 002). One row per user, guests included. */
export interface Profile {
  id: string; // auth user id
  display_name: string | null;
  current_plan_id: string | null;
  total_xp: number;
  streak: number;
  last_active_date: string | null; // YYYY-MM-DD (UTC)
  created_at: string;
}

/** resource_opens table (Person B, migration 002). One row per resource opened. */
export interface ResourceOpen {
  resource_id: string;
  level_id: string;
  question_id: string | null;
  run_id: string; // one id per play of a level
  duration_ms: number | null;
}

/** complete_level() result after migration 002 (adds XP awarded, profile totals). */
export interface CompleteLevelResultV2 extends CompleteLevelResult {
  xp_awarded: number; // 0 when replaying without beating the best score
  total_xp: number;
  streak: number;
}

/** Extra details saved with each answer (Person B, migration 002). */
export interface AttemptDetails {
  runId: string;
  timeMs: number;
  answer: string;
}

/** Account state shown in the app (Person B, src/lib/auth.ts). */
export interface AuthState {
  userId: string | null;
  email: string | null; // null = guest
  isGuest: boolean;
}
