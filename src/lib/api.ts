// Every call the app makes to the backend goes through here.
// Set EXPO_PUBLIC_USE_MOCK=1 in .env to run the whole app on src/mock/*.json (no backend needed).
import { FunctionsHttpError } from "@supabase/supabase-js";
import mockLevels from "../mock/level.json";
import mockPlan from "../mock/plan.json";
import { supabase, supabaseConfigured } from "./supabase";
import type {
  AttemptDetails, CompleteLevelResultV2, CreatePlanInput, Level, LevelBundle, Plan, PlanBundle, Question, Resource, Stage, RevampedResume,
} from "./types";
import type { StoredResume } from "./resumeStore";
import mockRevamp from "../mock/revamp.json";

export const USE_MOCK = process.env.EXPO_PUBLIC_USE_MOCK === "1";

type LevelContent = Record<string, { questions: Question[]; resources: Resource[] }>;
const demoBundle = mockPlan as PlanBundle;
const demoLevels = mockLevels as LevelContent;

// ------------------------------------------------------------------ errors

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  /** HTTP status from a server function, when there was one (used to decide whether to retry). */
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Worth retrying: no response (network), rate limited (429), or a server/AI error (5xx). */
export const isRetryable = (e: unknown) => {
  const status = e instanceof AppError ? e.status : undefined;
  return status === undefined || status === 429 || status >= 500;
};

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
      if (body?.error) return new AppError(body.error, res.status); // our own readable message
      if (body?.code === "NOT_FOUND") {
        return new AppError(`The "${fn}" server function isn't deployed yet. Run: supabase functions deploy ${fn}`, 404);
      }
    } catch {
      // not JSON, fall through
    }
    if (res.status === 401) return new AppError("Your session expired. Close and reopen the app.", 401);
    if (res.status === 546 || res.status === 504) return new AppError("The server took too long. Please try again.", 504);
    return new AppError(`${fallback} (server error ${res.status})`, res.status);
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
  if (lv.type === "boss") {
    const stage = stages.find((st) => st.levels.some((l) => l.id === levelId));
    const skill = skills.find((sk) => sk.id === stage?.skill_id);
    if (skill && !skill.earned_at) skill.earned_at = new Date().toISOString();
  }
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

// ------------------------------------------------------------------ level preparation
// The map opens as soon as stage 1 and its FIRST level are ready. Then two things run at the same
// time, in the background: the other stages are designed (build-stage), and the levels are written
// one after another in map order (generate-level), picking up each new stage's levels as it appears.
// One runner per plan; it survives screen changes, and the map restarts it after an app reload.

export interface PrepState {
  running: boolean;
  ready: number; // levels with questions
  total: number; // levels on the map so far
  stagesPending: number; // stages still being designed
}

const prepRunners = new Map<string, Promise<void>>();
const prepStates = new Map<string, PrepState>();
const prepListeners = new Map<string, Set<(s: PrepState) => void>>();

function emitPrep(planId: string, state: PrepState) {
  prepStates.set(planId, state);
  prepListeners.get(planId)?.forEach((fn) => fn(state));
}

/** True while the background runner is preparing this plan (the level screen then skips its own prefetch). */
export const isPreparing = (planId: string) => prepRunners.has(planId);

/** Calls `fn` with the plan's preparation progress (now, if known, and on every change). */
export function subscribePrep(planId: string, fn: (s: PrepState) => void): () => void {
  if (!prepListeners.has(planId)) prepListeners.set(planId, new Set());
  const set = prepListeners.get(planId)!;
  set.add(fn);
  const now = prepStates.get(planId);
  if (now) fn(now);
  return () => {
    set.delete(fn);
    if (set.size === 0) prepListeners.delete(planId);
  };
}

/**
 * Runs `task`, retrying twice (5 s, then 20 s) when the AI is busy, rate-limited or the network
 * dropped. Errors that won't fix themselves (not found, signed out, bad input) fail at once.
 */
async function withRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (e) {
      if (attempt >= 3 || !isRetryable(e)) throw e;
      await wait(attempt === 1 ? 5_000 : 20_000); // Gemini free tier: ~15 calls a minute
    }
  }
}

/** Generates a level's questions with retries (used by the level screen and the background runner). */
export const generateLevelWithRetry = (levelId: string) => withRetry(() => ensureLevelGenerated(levelId));

/** Designs one pending stage (build-stage). Resolves when it's ready (or another request is building it). */
async function buildStage(stageId: string): Promise<"ready" | "building"> {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; status: "ready" | "building" }>("build-stage", {
    body: { stage_id: stageId },
  });
  if (error) throw await functionError(error, "Couldn't build this stage.", "build-stage");
  return data?.status ?? "ready";
}

/** Makes sure the first level on the map has questions. Throws an AppError if it can't. */
export async function prepareFirstLevel(planId: string): Promise<void> {
  if (USE_MOCK) return;
  const bundle = await getPlanBundle(planId);
  const first = bundle.stages.flatMap((s) => s.levels)[0];
  if (!first || first.generated) return;
  await generateLevelWithRetry(first.id);
}

/**
 * Starts (or keeps) writing the levels of every BUILT stage in map order, one at a time, in the
 * background. Stages that aren't built yet stay locked and are left alone: they are designed when
 * the previous stage's boss fight starts (prepareNextStage). Never throws.
 */
export function startLevelPrep(planId: string): void {
  if (USE_MOCK || prepRunners.has(planId)) return;
  let ready = 0;
  let total = 0;
  const emit = (running: boolean) => emitPrep(planId, { running, ready, total, stagesPending: 0 });

  const run = (async () => {
    const tried = new Set<string>(); // a level that still fails is written when the player opens it
    for (;;) {
      const bundle = await getPlanBundle(planId);
      const built = bundle.stages.filter((s) => !s.status || s.status === "ready").flatMap((s) => s.levels);
      total = built.length;
      ready = built.filter((l) => l.generated).length;
      const next = built.find((l) => !l.generated && !tried.has(l.id));
      if (!next) break;
      emit(true);
      tried.add(next.id);
      try {
        await generateLevelWithRetry(next.id);
      } catch (e) {
        if (!isRetryable(e)) break; // signed out / plan gone: stop instead of hammering the server
      }
    }
    emit(false);
  })()
    .catch(() => emit(false))
    .finally(() => prepRunners.delete(planId));
  prepRunners.set(planId, run);
}

const stageBuilds = new Map<string, Promise<void>>();

/**
 * Called when a boss fight starts: designs the NEXT stage (build-stage) in the background, then
 * writes its levels. It stays locked on the map until this boss is beaten. Never throws.
 */
export function prepareNextStage(planId: string, bossStageIdx: number): void {
  if (USE_MOCK) return;
  const key = `${planId}:${bossStageIdx + 1}`;
  if (stageBuilds.has(key)) return;
  const run = (async () => {
    const bundle = await getPlanBundle(planId);
    const next = bundle.stages.find((s) => s.idx === bossStageIdx + 1);
    if (next && next.status && next.status !== "ready") {
      // "building" means another request has it: ask again every 10 s (up to ~2 minutes).
      for (let i = 0; i < 12; i++) {
        const status = await withRetry(() => buildStage(next.id));
        if (status === "ready") break;
        await wait(10_000);
      }
    }
    startLevelPrep(planId); // write the new stage's levels (no-op if the runner is already going)
  })()
    .catch(() => {}) // left 'pending': it's tried again at the next boss fight or app start
    .finally(() => stageBuilds.delete(key));
  stageBuilds.set(key, run);
}

/** Builds any stage that should already be open (its previous boss is beaten) but isn't built yet. */
export function catchUpStages(bundle: PlanBundle): void {
  if (USE_MOCK) return;
  bundle.stages.forEach((s, i) => {
    if (i === 0 || !s.status || s.status === "ready") return;
    const prev = bundle.stages[i - 1];
    // Build it if the previous boss was beaten or the previous boss fight has started (unlocked).
    if (prev.levels.some((l) => l.type === "boss" && l.status !== "locked")) prepareNextStage(bundle.plan.id, prev.idx);
  });
}

// ------------------------------------------------------------------ resume revamp

/**
 * Rewrites the user's resume with the skills they earned (revamp-resume, Person A's AI).
 * `resume` comes from the phone (loadResume). Errors are AppErrors; a 409 means no boss beaten yet.
 */
export async function revampResume(planId: string, resume: StoredResume): Promise<RevampedResume> {
  if (USE_MOCK) {
    await wait(1500);
    return JSON.parse(JSON.stringify(mockRevamp)) as RevampedResume;
  }
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<RevampedResume>("revamp-resume", {
    body: { plan_id: planId, resume },
  });
  if (error) throw await functionError(error, "Couldn't update your resume.", "revamp-resume");
  if (!data || !Array.isArray(data.sections)) throw new AppError("Couldn't update your resume. Please try again.");
  return data;
}

/** Starts generating the level after this one in the background. Errors are ignored. */
export function prefetchNextLevel(bundle: PlanBundle | null, levelId: string): void {
  if (!bundle || isPreparing(bundle.plan.id)) return; // the background runner is already on it
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
