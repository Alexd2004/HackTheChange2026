// Supabase clients for Edge Functions: find the calling user from their JWT,
// and an admin client (service role) for inserts that bypass RLS.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { UserError } from "./cors.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Returns the signed-in user's id, or throws a 401 the app can show. */
export async function requireUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new UserError("Please restart the app to sign in again.", 401);
  return data.user.id;
}

/** Returns the data of a Supabase call, or throws if it failed or returned nothing. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data == null) throw new Error(`${what}: no data returned`);
  return res.data;
}

/** Throws if a Supabase write (with no returned rows) failed. */
export function ok(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}
