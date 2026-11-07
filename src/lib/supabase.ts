// Supabase client for the app. Session is kept in AsyncStorage on phones and
// localStorage on web, and only refreshes while the app is in the foreground.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// The plan names it ANON_KEY; newer Supabase dashboards call it the publishable key. Either works.
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** False when .env is missing values. The app shows a readable error instead of crashing. */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(
  supabaseUrl || "https://not-configured.supabase.co",
  supabaseKey || "not-configured",
  {
    auth: {
      ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
