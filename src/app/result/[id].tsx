// Result screen: score, XP earned, Job Match % change (animated), and what to do next.
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { PASS_PCT } from "@/lib/grading";
import { useSettings } from "@/lib/settings";
import { colors } from "@/lib/theme";
import type { LevelType } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { Button, Screen } from "@/components/ui";
import { Icon } from "@/components/pixel";

type Params = {
  id: string; planId: string; type: LevelType; score: string; correct: string; total: string;
  xp: string; passed: string; before: string; after: string; next: string; bossLost: string;
};

export default function ResultScreen() {
  const p = useLocalSearchParams<Params>();
  const { motionOff } = useSettings();
  const passed = p.passed === "1";
  const before = Number(p.before) || 0;
  const after = Number(p.after) || before;
  const gained = after - before;
  const animate = !motionOff && gained > 0;
  const [shown, setShown] = useState(animate ? before : after);

  // Count the match % up from before → after.
  useEffect(() => {
    if (!animate) return;
    let v = before;
    const t = setInterval(() => {
      v = Math.min(after, v + 1);
      setShown(v);
      if (v >= after) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [animate, before, after]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    Haptics.notificationAsync(passed ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [passed]);

  const toMap = () => router.dismissTo({ pathname: "/plan/[id]", params: { id: p.planId } });
  const bossWin = p.type === "boss" && passed;

  const title = bossWin ? "Boss defeated!" : passed ? "Level complete!" : p.bossLost === "1" ? "The boss won this round" : "Almost there";
  const icon = bossWin ? "trophy" : passed ? "star" : "arm-flex";

  return (
    <Screen>
      <View className="flex-1 justify-center gap-6 py-10">
        <View className="items-center gap-2" accessible accessibilityRole="header" accessibilityLabel={`${title}. Score ${p.score} percent, ${p.correct} of ${p.total} correct.`}>
          <Icon name={icon} size={72} color={passed ? colors.challenge : colors.brand} />
          <Text className="text-center text-3xl font-extrabold text-fg">{title}</Text>
          <Text className="text-center text-base text-muted">
            {p.correct} of {p.total} correct · {p.score}%
            {!passed && p.bossLost !== "1" ? ` (need ${PASS_PCT}%)` : ""}
          </Text>
        </View>

        <View className="flex-row gap-3">
          <Stat label="Score" value={`${p.score}%`} color={passed ? colors.good : colors.bad} />
          <Stat label="XP earned" value={passed ? `+${p.xp}` : "0"} color={colors.brand} />
        </View>
        {passed && p.xp === "0" && (
          <Text className="-mt-3 text-center text-sm text-muted">No new XP on a replay unless you beat your best score.</Text>
        )}

        <View className="gap-3 rounded-2xl border border-line bg-panel p-4">
          <View className="flex-row items-end justify-between">
            <Text className="text-base font-semibold text-muted">Job match</Text>
            <View className="flex-row items-end gap-2">
              {gained > 0 && (
                <View className="flex-row items-center pb-1">
                  <Icon name="arrow-up-bold" size={16} color={colors.good} />
                  <Text className="text-sm font-bold text-good">{gained}%</Text>
                </View>
              )}
              <Text className="text-4xl font-extrabold text-brand" accessibilityLabel={`Job match ${after} percent`}>{shown}%</Text>
            </View>
          </View>
          <ProgressBar pct={shown} label={`Job match ${after} percent`} height={12} />
          {bossWin ? (
            <View className="flex-row items-center gap-1">
              <Icon name="check-bold" size={16} color={colors.good} />
              <Text className="flex-1 text-sm leading-5 text-good">This skill now counts toward your match.</Text>
            </View>
          ) : passed ? (
            <Text className="text-sm leading-5 text-muted">Beat this stage’s boss to raise your match.</Text>
          ) : (
            <Text className="text-sm leading-5 text-muted">Review the explanations, then try again. Missed concepts come back in later levels.</Text>
          )}
        </View>

        <View className="gap-3">
          {passed && p.next ? (
            <Button label="Next level" onPress={() => router.replace({ pathname: "/level/[id]", params: { id: p.next } })} />
          ) : !passed ? (
            <Button label="Try again" onPress={() => router.replace({ pathname: "/level/[id]", params: { id: p.id } })} />
          ) : null}
          <Button label="Back to map" variant="secondary" onPress={toMap} />
        </View>
      </View>
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View className="flex-1 items-center rounded-2xl bg-panel p-4" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="mt-1 text-3xl font-extrabold" style={{ color }}>{value}</Text>
    </View>
  );
}
