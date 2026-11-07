// Login + profile (Person B). Everyone starts as a guest (anonymous Supabase user).
// "Save progress" adds an email + password to that SAME user, so plans and XP are kept.
// "Sign in" on another device uses that email + password. Mock mode fakes it in memory.
import { AppError, USE_MOCK, ensureSession, friendly, listPlans, mockProfileStats, resetSession } from "./api";
import { supabase } from "./supabase";
import type { AuthState, Profile } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const warned = new Set<string>();
/** console.warn only the first time (Expo Go shows every warning as a toast). */
function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}
export const MIN_PASSWORD = 6;

// ------------------------------------------------------------------ mock mode

const mockAuth = { email: null as string | null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// ------------------------------------------------------------------ auth state

export async function getAuthState(): Promise<AuthState> {
  if (USE_MOCK) return { userId: "mock-user", email: mockAuth.email, isGuest: !mockAuth.email };
  await ensureSession();
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user ?? null;
  const isGuest = !user || user.is_anonymous === true || !user.email;
  return { userId: user?.id ?? null, email: isGuest ? null : user?.email ?? null, isGuest };
}

/** Calls `fn` whenever the user signs in, saves progress or signs out. Returns an unsubscribe function. */
export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  if (USE_MOCK) return () => listeners.delete(fn);
  // Ignore INITIAL_SESSION / TOKEN_REFRESHED (hourly) — only real account changes reload the UI.
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") fn();
  });
  return () => {
    listeners.delete(fn);
    data.subscription.unsubscribe();
  };
}

function validate(email: string, password: string): string {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new AppError("Enter a valid email address.");
  if (password.length < MIN_PASSWORD) throw new AppError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  return e;
}

function authError(err: { message?: string } | null | undefined, fallback: string): AppError {
  const msg = err?.message ?? "";
  if (/already (been )?registered|already exists|email_exists/i.test(msg)) {
    return new AppError("That email already has an account. Use Sign in instead.");
  }
  if (/invalid login credentials/i.test(msg)) return new AppError("Wrong email or password.");
  if (/email not confirmed/i.test(msg)) return new AppError("Confirm your email first (check your inbox), then sign in.");
  if (/rate limit|too many/i.test(msg)) return new AppError("Too many tries. Wait a minute and try again.");
  return friendly(err ?? new Error(fallback), fallback);
}

/**
 * Guest → account: adds email + password to the current guest user (same user id, nothing lost).
 * Returns "saved", or "confirm_email" if Supabase is set to require email confirmation.
 */
export async function saveProgress(email: string, password: string): Promise<"saved" | "confirm_email"> {
  const e = validate(email, password);
  if (USE_MOCK) {
    mockAuth.email = e;
    notify();
    return "saved";
  }
  await ensureSession();
  const { data, error } = await supabase.auth.updateUser({ email: e, password });
  if (error) throw authError(error, "Couldn't save your progress.");
  // (onAuthStateChange fires USER_UPDATED, which notifies listeners.)
  // With "Confirm email" ON the email only applies after the user clicks the link.
  return data.user?.email?.toLowerCase() === e ? "saved" : "confirm_email";
}

/** True when this device's guest has plans that would be left behind by signing in to another account. */
export async function guestHasPlans(): Promise<boolean> {
  const state = await getAuthState();
  if (!state.isGuest) return false;
  return (await listPlans().catch(() => [])).length > 0;
}

export async function signIn(email: string, password: string): Promise<void> {
  const e = validate(email, password);
  if (USE_MOCK) {
    mockAuth.email = e;
    notify();
    return;
  }
  const { error } = await supabase.auth.signInWithPassword({ email: e, password });
  if (error) throw authError(error, "Couldn't sign in.");
  resetSession(); // listeners are notified by the SIGNED_IN event
}

/** Signs out, then starts a fresh guest so the app keeps working. */
export async function signOut(): Promise<void> {
  if (USE_MOCK) {
    mockAuth.email = null;
    notify();
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw authError(error, "Couldn't sign out.");
  resetSession();
  await ensureSession(); // fresh guest; listeners are notified by SIGNED_OUT / SIGNED_IN
}

// ------------------------------------------------------------------ profile (XP, streak, current plan)

/** The signed-in user's profile, or null if it can't be loaded (e.g. migration 002 not applied yet). */
export async function getProfile(): Promise<Profile | null> {
  if (USE_MOCK) {
    return {
      id: "mock-user", display_name: null, last_active_date: null,
      created_at: new Date().toISOString(), ...mockProfileStats(),
    };
  }
  await ensureSession();
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error) {
    warnOnce("profile", `profile not loaded (is migration 002 applied?): ${error.message}`);
    return null;
  }
  return data as Profile | null;
}

/** Remembers which plan the user last opened (for "Continue"). Fire-and-forget. */
export function setCurrentPlan(planId: string): void {
  if (USE_MOCK) return;
  ensureSession()
    .then(async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      const { error } = await supabase.from("profiles").update({ current_plan_id: planId }).eq("id", uid);
      if (error) warnOnce("current-plan", `current plan not saved: ${error.message}`);
    })
    .catch(() => {});
}
