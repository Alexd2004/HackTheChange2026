// Every call the app makes to the backend goes through here.
// Set EXPO_PUBLIC_USE_MOCK=1 in .env to run the whole app on src/mock/*.json (no backend needed).
import { FunctionsHttpError } from "@supabase/supabase-js";
import mockLevels from "../mock/level.json";
import mockPlan from "../mock/plan.json";
import { supabase, supabaseConfigured } from "./supabase";
import type {
  AttemptDetails, CompleteLevelResultV2, CreatePlanInput, Level, LevelBundle, Plan, PlanBundle, Question, Resource, Stage,
} from "./types";

export const USE_MOCK = process.env.EXPO_PUBLIC_USE_MOCK === "1";

type LevelContent = Record<string, { questions: Question[]; resources: Resource[] }>;
const demoBundle = mockPlan as PlanBundle;
const demoLevels = mockLevels as LevelContent;

// ------------------------------------------------------------------ errors

/** An error whose message is safe to show to the user. */
export class AppError extends Error {}

/** Turns any error into one with a message safe to show. Shared with auth.ts / analytics.ts. */
export function friendly(err: unknown, fallback: string): AppError {
  if (err instanceof AppError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|timed? ?out/i.test(msg)) return new AppError("Can't reach the server. Check your internet and try again.");
  return new AppError(msg || fallback);
}

export async function functionError(error: unknown, fallback: string, fn: string): Promise<AppError> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    try {
      const body = await res.clone().json();
      if (body?.error) return new AppError(body.error); // our own readable message
      if (body?.code === "NOT_FOUND") {
        return new AppError(`The "${fn}" server function isn't deployed yet. Run: supabase functions deploy ${fn}`);
      }
    } catch {
      // not JSON, fall through
    }
    if (res.status === 401) return new AppError("Your session expired. Close and reopen the app.");
    if (res.status === 546 || res.status === 504) return new AppError("The server took too long. Please try again.");
    return new AppError(`${fallback} (server error ${res.status})`);
  }
  return friendly(error, fallback);
}

// ------------------------------------------------------------------ session

let sessionPromise: Promise<void> | null = null;

/** Signs in anonymously once per install. Every other call waits for this. */
export function ensureSession(): Promise<void> {
  if (USE_MOCK) return Promise.resolve();
  if (!supabaseConfigured) {
    return Promise.reject(new AppError("Supabase isn't configured. Add EXPO_PUBLIC_SUPABASE_URL and the key to .env, then restart Expo."));
  }
  sessionPromise ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new AppError(`Couldn't sign in: ${error.message}. Is anonymous sign-in enabled in Supabase?`);
  })().catch((err) => {
    sessionPromise = null; // allow retry
    throw friendly(err, "Couldn't sign in.");
  });
  return sessionPromise;
}

/** Forget the cached session (after sign-out / sign-in) so the next call starts fresh. */
export function resetSession(): void {
  sessionPromise = null;
}

// ------------------------------------------------------------------ pending plan input
// The upload screen stores the resume here, then the building screen sends it.
// (A PDF is too big to pass through route params.)

let pendingInput: CreatePlanInput | null = null;
export const setPendingPlanInput = (input: CreatePlanInput) => { pendingInput = input; };
export const takePendingPlanInput = () => { const i = pendingInput; pendingInput = null; return i; };

// ------------------------------------------------------------------ mock store (in memory)

const mock = {
  bundle: JSON.parse(JSON.stringify(demoBundle)) as PlanBundle,
  hasPlan: false,
  streak: 0,
};

/** Mock-mode numbers for the profile (auth.ts uses these when USE_MOCK is on). */
export const mockProfileStats = () => ({
  total_xp: mock.bundle.plan.xp,
  streak: mock.streak,
  current_plan_id: mock.hasPlan ? mock.bundle.plan.id : null,
});

function mockAllLevels(): Level[] {
  return mock.bundle.stages.flatMap((s) => s.levels);
}

function mockComplete(levelId: string, score: number, xp: number): CompleteLevelResultV2 {
  const all = mockAllLevels();
  const i = all.findIndex((l) => l.id === levelId);
  const lv = all[i];
  // Same rule as complete_level v2: full XP on the first completion; a better score later
  // earns only the improvement (xp x points gained / 100).
  const prevBest = lv.best_score ?? 0;
  const award = lv.status !== "completed" ? xp : score > prevBest ? Math.floor((xp * (score - prevBest)) / 100) : 0;
  lv.status = "completed";
  lv.best_score = Math.max(lv.best_score ?? 0, score);
  const next = all[i + 1] ?? null;
  if (next && next.status === "locked") next.status = "unlocked";
  const { plan, skills, stages } = mock.bundle;
  const total = skills.reduce((a, s) => a + s.weight, 0);
  const have = skills
    .filter((s) => !s.is_gap || stages.some((st) => st.skill_id === s.id && st.levels.some((l) => l.type === "boss" && l.status === "completed")))
    .reduce((a, s) => a + s.weight, 0);
  plan.match_pct = Math.round((100 * have) / total);
  plan.xp += award;
  mock.streak = Math.max(mock.streak, 1);
  return {
    match_pct: plan.match_pct, xp: plan.xp, next_level_id: next?.id ?? null,
    xp_awarded: award, total_xp: plan.xp, streak: mock.streak,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ plans

export async function createPlan(input: CreatePlanInput): Promise<string> {
  if (USE_MOCK) {
    await wait(1500);
    mock.hasPlan = true;
    return mock.bundle.plan.id;
  }
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<{ plan_id: string }>("create-plan", { body: input });
  if (error) throw await functionError(error, "Couldn't build your map.", "create-plan");
  if (!data?.plan_id) throw new AppError("Couldn't build your map. Please try again.");
  return data.plan_id;
}

/** Copies the bundled demo plan into the user's account (backup for the live demo). */
export async function importDemoPlan(): Promise<string> {
  if (USE_MOCK) {
    mock.hasPlan = true;
    return mock.bundle.plan.id;
  }
  await ensureSession();
  const { data, error } = await supabase.rpc("import_plan", { bundle: demoBundle, level_content: demoLevels });
  if (error) throw friendly(error, "Couldn't load the demo plan.");
  return data as string;
}

export async function listPlans(): Promise<Plan[]> {
  if (USE_MOCK) return mock.hasPlan ? [mock.bundle.plan] : [];
  await ensureSession();
  const { data, error } = await supabase.from("plans").select("*").order("created_at", { ascending: false }).limit(5);
  if (error) throw friendly(error, "Couldn't load your plans.");
  return data as Plan[];
}

export async function getPlanBundle(planId: string): Promise<PlanBundle> {
  if (USE_MOCK) return JSON.parse(JSON.stringify(mock.bundle));
  await ensureSession();
  const { data, error } = await supabase
    .from("plans")
    .select("*, skills(*), stages(*, levels(*))")
    .eq("id", planId)
    .single();
  if (error) throw friendly(error, "Couldn't load your map.");
  const { skills, stages, ...plan } = data as Plan & { skills: PlanBundle["skills"]; stages: PlanBundle["stages"] };
  const sorted = [...stages]
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({ ...s, levels: [...s.levels].sort((a, b) => a.idx - b.idx) }));
  return { plan, skills, stages: sorted };
}

// ------------------------------------------------------------------ levels

const inFlight = new Map<string, Promise<void>>();

/** Makes sure a level has questions. Shares one request per level (prefetch + open don't double-generate). */
export function ensureLevelGenerated(levelId: string): Promise<void> {
  if (USE_MOCK) return Promise.resolve();
  const existing = inFlight.get(levelId);
  if (existing) return existing;
  const p = (async () => {
    await ensureSession();
    const { error } = await supabase.functions.invoke("generate-level", { body: { level_id: levelId } });
    if (error) throw await functionError(error, "Couldn't create this level's questions.", "generate-level");
  })().finally(() => inFlight.delete(levelId));
  inFlight.set(levelId, p);
  return p;
}

/** Starts generating the level after this one in the background. Errors are ignored. */
export function prefetchNextLevel(bundle: PlanBundle | null, levelId: string): void {
  if (!bundle) return;
  const all = bundle.stages.flatMap((s) => s.levels);
  const next = all[all.findIndex((l) => l.id === levelId) + 1];
  if (next && !next.generated) ensureLevelGenerated(next.id).catch(() => {});
}

export async function getLevelBundle(levelId: string): Promise<LevelBundle> {
  if (USE_MOCK) {
    const b = mock.bundle;
    const stage = b.stages.find((s) => s.levels.some((l) => l.id === levelId));
    const level = stage?.levels.find((l) => l.id === levelId);
    if (!stage || !level) throw new AppError("Level not found.");
    const content = demoLevels[levelId];
    if (!content) throw new AppError("Demo data only covers stage 1. Connect Supabase to generate this level with AI.");
    const { levels: _levels, ...stageOnly } = stage;
    return {
      plan_id: b.plan.id, level: { ...level }, stage: stageOnly,
      skill: b.skills.find((s) => s.id === stage.skill_id)!,
      questions: content.questions, resources: content.resources,
    };
  }
  await ensureSession();
  const { data, error } = await supabase
    .from("levels")
    .select("*, stage:stages(*, skill:skills(*)), questions(*), resources(*)")
    .eq("id", levelId)
    .single();
  if (error) throw friendly(error, "Couldn't load this level.");
  const { stage, questions, resources, ...level } = data as Level & {
    stage: Stage & { skill: LevelBundle["skill"] }; questions: Question[]; resources: Resource[];
  };
  const { skill, ...stageOnly } = stage;
  return {
    plan_id: stage.plan_id, level, stage: stageOnly, skill,
    questions: [...questions].sort((a, b) => a.idx - b.idx), resources,
  };
}

/** Saves one answer. Fire-and-forget: a failed write never blocks the game. */
export function recordAttempt(questionId: string, correct: boolean, details?: AttemptDetails): void {
  if (USE_MOCK) return;
  const basic = { question_id: questionId, correct };
  const row = details
    ? {
        ...basic,
        run_id: details.runId,
        time_ms: Math.max(0, Math.min(Math.round(details.timeMs), 3_600_000)),
        answer: Array.from(details.answer).slice(0, 300).join(""), // by character, never splits an emoji
      }
    : basic;
  supabase.from("attempts").insert(row).then(({ error }) => {
    if (!error) return;
    // Migration 002 not applied yet (unknown column): still save the answer the old way.
    if (details && (error.code === "PGRST204" || /column/i.test(error.message))) {
      supabase.from("attempts").insert(basic).then(({ error: e2 }) => e2 && console.warn("attempt not saved:", e2.message));
      return;
    }
    console.warn("attempt not saved:", error.message);
  });
}

export async function completeLevel(levelId: string, score: number, xp: number): Promise<CompleteLevelResultV2> {
  if (USE_MOCK) return mockComplete(levelId, score, xp);
  await ensureSession();
  const { data, error } = await supabase.rpc("complete_level", { level_id: levelId, score, xp_earned: xp });
  if (error) throw friendly(error, "Couldn't save your progress.");
  return data as CompleteLevelResultV2;
}
