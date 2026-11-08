// Small shared UI pieces: Screen wrapper, Button, loading and error states.
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";

/** Full-height dark screen, safe-area aware, content capped at phone width on big screens. */
export function Screen({
  children, scroll = true, background,
}: { children: ReactNode; scroll?: boolean; background?: string }) {
  const inner = <View className="w-full max-w-[480px] self-center flex-1 px-4">{children}</View>;
  return (
    <SafeAreaView className="flex-1 bg-ink" style={background ? { backgroundColor: background } : undefined} edges={["top", "bottom"]}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow pb-8"
          keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  label, onPress, variant = "primary", disabled, loading, hint, color,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** accessibilityHint: what happens when pressed */
  hint?: string;
  /** override the primary background (e.g. boss red) */
  color?: string;
}) {
  const off = disabled || loading;
  const base = "min-h-[52px] rounded-2xl px-5 items-center justify-center flex-row";
  const styles: Record<Variant, string> = {
    primary: "bg-brand",
    secondary: "bg-raised border border-line",
    ghost: "",
  };
  const text: Record<Variant, string> = {
    primary: "text-ink",
    secondary: "text-fg",
    ghost: "text-muted underline",
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      className={`${base} ${styles[variant]} ${off ? "opacity-40" : "active:opacity-80"}`}
      style={variant === "primary" && color ? { backgroundColor: color } : undefined}>
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.ink : colors.fg} />
      ) : (
        <Text className={`text-base font-bold ${text[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}

export function LoadingState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 py-16" accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.brand} />
      <Text className="text-muted text-base text-center">{message}</Text>
    </View>
  );
}

export function ErrorState({
  message, onRetry, onBack,
}: { message: string; onRetry?: () => void; onBack?: () => void }) {
  return (
    <View className="flex-1 justify-center gap-4 py-16" accessibilityRole="alert">
      <Text className="text-fg text-xl font-bold">Something went wrong</Text>
      <Text className="text-muted text-base leading-6">{message}</Text>
      <View className="gap-3 mt-2">
        {onRetry && <Button label="Try again" onPress={onRetry} />}
        {onBack && <Button label="Go back" variant="secondary" onPress={onBack} />}
      </View>
    </View>
  );
}

/** Small pill label, e.g. "Boss" or "2× XP". */
export function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View className="self-start rounded-full px-3 py-1" style={{ backgroundColor: color + "22" }}>
      <Text className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{label}</Text>
    </View>
  );
}
