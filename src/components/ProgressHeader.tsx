// Top bar for the start screen (Person B): account chip ("Guest · Save progress" or the email)
// plus total XP and day streak from the user's profile. Self-contained so the front-end
// redesign can drop it anywhere.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getAuthState, getProfile, onAuthChange } from "@/lib/auth";
import type { AuthState, Profile } from "@/lib/types";

export function ProgressHeader() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(() => {
    getAuthState().then(setAuth).catch(() => setAuth(null));
    getProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  useFocusEffect(load);
  useEffect(() => onAuthChange(load), [load]);

  const label = !auth ? "Account" : auth.isGuest ? "Guest · Save progress" : auth.email ?? "Account";

  return (
    <View className="flex-row items-center justify-between gap-3 pt-4">
      <Pressable
        onPress={() => router.push("/account")}
        accessibilityRole="button"
        accessibilityLabel={auth?.isGuest ? "Playing as guest. Save your progress" : `Signed in as ${auth?.email ?? ""}. Account`}
        className={`min-h-[44px] flex-shrink flex-row items-center gap-2 rounded-full border px-4 active:opacity-80 ${
          auth?.isGuest ? "border-brand/50 bg-brand/10" : "border-line bg-panel"
        }`}>
        <Text className="text-base">{auth?.isGuest ? "👤" : "✅"}</Text>
        <Text numberOfLines={1} className={`flex-shrink text-sm font-semibold ${auth?.isGuest ? "text-brand" : "text-fg"}`}>
          {label}
        </Text>
      </Pressable>

      {profile && (
        <View
          className="flex-row items-center gap-3"
          accessible
          accessibilityLabel={`${profile.total_xp} experience points, ${profile.streak} day streak`}>
          <Text className="text-sm font-extrabold text-brand">✨ {profile.total_xp} XP</Text>
          <Text className="text-sm font-extrabold text-challenge">🔥 {profile.streak}</Text>
        </View>
      )}
    </View>
  );
}
