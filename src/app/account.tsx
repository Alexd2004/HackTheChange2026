// Account screen (Person B): guests "Save progress" (email + password on the same user, nothing lost),
// existing users "Sign in" on another phone, signed-in users can sign out (back to a fresh guest).
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { USE_MOCK } from "@/lib/api";
import { MIN_PASSWORD, getAuthState, getProfile, guestHasPlans, saveProgress, signIn, signOut } from "@/lib/auth";
import { colors } from "@/lib/theme";
import type { AuthState, Profile } from "@/lib/types";
import { Button, LoadingState, Screen } from "@/components/ui";

type Mode = "save" | "signin";

export default function AccountScreen() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<Mode>("save");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLeaveGuest, setConfirmLeaveGuest] = useState(false);

  const load = useCallback(() => {
    getAuthState().then(setAuth).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your account."));
    getProfile().then(setProfile).catch(() => setProfile(null));
  }, []);
  useFocusEffect(load);

  async function run(action: () => Promise<string | null>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const msg = await action();
      setNotice(msg);
      setPassword("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const onSave = () =>
    run(async () => {
      const result = await saveProgress(email, password);
      return result === "saved"
        ? "Progress saved. Sign in with this email on any phone to keep playing."
        : "Almost done: check your inbox and confirm your email, then sign in.";
    });

  const onSignIn = () =>
    run(async () => {
      // Signing in switches accounts; this guest's plans stay behind. Ask once before doing it.
      if (!confirmLeaveGuest && (await guestHasPlans())) {
        setConfirmLeaveGuest(true);
        return null;
      }
      await signIn(email, password);
      setConfirmLeaveGuest(false);
      return "Signed in. Your plans and XP are back.";
    });

  const onSignOut = () =>
    run(async () => {
      await signOut();
      return "Signed out. You're playing as a new guest.";
    });

  if (!auth && !error) return <Screen><LoadingState message="Loading your account…" /></Screen>;
  const guest = auth?.isGuest ?? true;

  return (
    <KeyboardAvoidingView className="flex-1 bg-ink" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="mt-4 min-h-[44px] min-w-[44px] justify-center">
          <Text className="text-2xl text-fg">←</Text>
        </Pressable>

        <Text className="mt-2 text-3xl font-extrabold text-fg" accessibilityRole="header">
          {guest ? (mode === "save" ? "Save your progress" : "Sign in") : "Your account"}
        </Text>

        {profile && (
          <View className="mt-4 flex-row gap-3">
            <Stat label="Total XP" icon="✨" value={profile.total_xp} color={colors.brand} />
            <Stat label="Day streak" icon="🔥" value={profile.streak} color={colors.challenge} />
          </View>
        )}

        {guest ? (
          <>
            <Text className="mt-4 text-base leading-6 text-muted">
              {mode === "save"
                ? "You're playing as a guest. Add an email and password to keep your plans and XP, and to sign in on another phone."
                : "Use the email and password you saved progress with."}
            </Text>

            <View className="mt-5 gap-3">
              <Field label="Email" value={email} onChange={setEmail} keyboard="email-address" autoComplete="email" />
              <Field
                label={`Password (at least ${MIN_PASSWORD} characters)`}
                value={password}
                onChange={setPassword}
                secure
                autoComplete={mode === "save" ? "new-password" : "current-password"}
                onSubmit={mode === "save" ? onSave : onSignIn}
              />
            </View>

            {confirmLeaveGuest && mode === "signin" && (
              <View className="mt-4 rounded-2xl border border-challenge/60 bg-challenge/10 p-4" accessibilityRole="alert">
                <Text className="text-base leading-6 text-fg">
                  ⚠️ This phone’s guest has plans that aren’t saved to an email. If you sign in, you won’t see them anymore.
                  Save progress first, or tap Sign in again to continue.
                </Text>
              </View>
            )}

            <View className="mt-5 gap-3">
              {mode === "save" ? (
                <Button label="Save progress" onPress={onSave} loading={busy} disabled={!email || password.length < MIN_PASSWORD} />
              ) : (
                <Button
                  label={confirmLeaveGuest ? "Sign in anyway" : "Sign in"}
                  onPress={onSignIn}
                  loading={busy}
                  disabled={!email || password.length < MIN_PASSWORD}
                />
              )}
              <Button
                label={mode === "save" ? "Already saved before? Sign in" : "New here? Save progress instead"}
                variant="ghost"
                onPress={() => {
                  setMode(mode === "save" ? "signin" : "save");
                  setError(null);
                  setNotice(null);
                  setConfirmLeaveGuest(false);
                }}
              />
            </View>
          </>
        ) : (
          <>
            <View className="mt-5 rounded-2xl border border-line bg-panel p-4">
              <Text className="text-sm text-muted">Signed in as</Text>
              <Text className="mt-1 text-lg font-bold text-fg" selectable>{auth?.email}</Text>
              <Text className="mt-2 text-sm leading-5 text-muted">Sign in with this email on any phone to see the same map and XP.</Text>
            </View>
            <View className="mt-5">
              <Button label="Sign out" variant="secondary" onPress={onSignOut} loading={busy} hint="You'll continue as a new guest" />
            </View>
          </>
        )}

        {error && (
          <View className="mt-4 rounded-2xl border border-bad/50 bg-bad/10 p-4" accessibilityRole="alert">
            <Text className="text-base text-bad">⚠️ {error}</Text>
          </View>
        )}
        {notice && (
          <View className="mt-4 rounded-2xl border border-good/50 bg-good/10 p-4" accessibilityRole="alert">
            <Text className="text-base text-good">✓ {notice}</Text>
          </View>
        )}
        {USE_MOCK && <Text className="mt-4 text-xs font-semibold text-challenge">Mock mode: accounts are simulated on this phone only.</Text>}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Field({
  label, value, onChange, secure, keyboard, autoComplete, onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboard?: "email-address";
  autoComplete?: "email" | "new-password" | "current-password";
  onSubmit?: () => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={keyboard}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmit}
        returnKeyType={onSubmit ? "done" : "next"}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        className="min-h-[52px] rounded-2xl border-2 border-line bg-panel px-4 text-lg text-fg"
      />
    </View>
  );
}

function Stat({ label, icon, value, color }: { label: string; icon: string; value: number; color: string }) {
  return (
    <View className="flex-1 items-center rounded-2xl bg-panel p-4" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="mt-1 text-2xl font-extrabold" style={{ color }}>{icon} {value}</Text>
    </View>
  );
}
