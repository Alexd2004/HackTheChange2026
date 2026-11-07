// Top bar for the start screen (Person B): account chip ("Guest · Save progress" or the email)
// plus total XP and day streak from the user's profile. Self-contained so the front-end
// redesign can drop it anywhere.
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getAuthState, getProfile, onAuthChange } from "@/lib/auth";
import { pixelColors as c } from "@/lib/theme";
import type { AuthState, Profile } from "@/lib/types";
import { Icon, font } from "./pixel";

const chip = { backgroundColor: c.cream, borderWidth: 3, borderColor: c.wood } as const;

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
    <View className="flex-row items-center justify-between gap-3">
      <Pressable
        onPress={() => router.push("/account")}
        accessibilityRole="button"
        accessibilityLabel={auth?.isGuest ? "Playing as guest. Save your progress" : `Signed in as ${auth?.email ?? ""}. Account`}
        className="min-h-[44px] flex-shrink flex-row items-center gap-2 px-3 active:opacity-80"
        style={chip}>
        <Icon name={auth && !auth.isGuest ? "account-check" : "account-outline"} size={22} />
        <Text numberOfLines={1} className="flex-shrink" style={font(20)}>
          {label}
        </Text>
      </Pressable>

      {profile && (
        <View
          className="min-h-[44px] flex-row items-center gap-3 px-3"
          style={chip}
          accessible
          accessibilityLabel={`${profile.total_xp} experience points, ${profile.streak} day streak`}>
          <View className="flex-row items-center gap-1">
            <Icon name="star-four-points" size={18} color={c.dirtEdge} />
            <Text style={font(20)}>{profile.total_xp} XP</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Icon name="fire" size={18} color={c.red} />
            <Text style={font(20)}>{profile.streak}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
