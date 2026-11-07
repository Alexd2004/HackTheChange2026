// Result screen: score, XP earned, Job Match % change (animated), and what to do next.
import {
  Icon,
  PixelBackground,
  PixelButton,
  TileBar,
  font,
  outlined,
  panel,
} from "@/components/pixel";
import { PASS_PCT } from "@/lib/grading";
import { useSettings } from "@/lib/settings";
import { pixelColors as c } from "@/lib/theme";
import type { LevelType } from "@/lib/types";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

type Params = {
  id: string;
  planId: string;
  type: LevelType;
  score: string;
  correct: string;
  total: string;
  xp: string;
  passed: string;
  before: string;
  after: string;
  next: string;
  bossLost: string;
};

export default function ResultScreen() {
  const p = useLocalSearchParams<Params>();
  const { motionOff } = useSettings();
  const [fontLoaded] = useFonts({ Jersey25_400Regular });
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
    Haptics.notificationAsync(
      passed
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
  }, [passed]);

  const toMap = () =>
    router.dismissTo({ pathname: "/plan/[id]", params: { id: p.planId } });
  const bossWin = p.type === "boss" && passed;

  const title = bossWin
    ? "Boss defeated!"
    : passed
      ? "Level complete!"
      : p.bossLost === "1"
        ? "The boss won this round"
        : "Almost there";
  const icon = bossWin ? "trophy" : passed ? "star" : "arm-flex";

  if (!fontLoaded) return <PixelBackground>{null}</PixelBackground>;

  return (
    <PixelBackground>
      <ScrollView className="flex-1" contentContainerClassName="flex-grow">
        <View className="w-full max-w-[480px] flex-1 justify-center gap-6 self-center px-4 py-8">
          <View
            className="items-center gap-2"
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${title}. Score ${p.score} percent, ${p.correct} of ${p.total} correct.`}
          >
            <View
              className="h-24 w-24 items-center justify-center"
              style={{ ...panel, backgroundColor: c.cream }}
            >
              <Icon
                name={icon}
                size={60}
                color={bossWin ? c.red : passed ? c.gold : c.wood}
              />
            </View>
            <Text className="mt-2 text-center" style={outlined(44, c.gold)}>
              {title}
            </Text>
            <Text className="text-center" style={outlined(24)}>
              {p.correct} of {p.total} correct · {p.score}%
              {!passed && p.bossLost !== "1" ? ` (need ${PASS_PCT}%)` : ""}
            </Text>
          </View>

          <View className="flex-row gap-3">
            <Stat
              label="Score"
              value={`${p.score}%`}
              color={passed ? c.grassDark : c.red}
            />
            <Stat
              label="XP earned"
              value={passed ? `+${p.xp}` : "0"}
              color={c.wood}
            />
          </View>

          <View className="gap-3 p-4" style={panel}>
            <View className="flex-row items-end justify-between">
              <Text style={font(24)}>Job match</Text>
              <View className="flex-row items-end gap-2">
                {gained > 0 && (
                  <View className="flex-row items-center pb-1">
                    <Icon name="arrow-up-bold" size={18} color={c.grassDark} />
                    <Text style={font(20, c.grassDark)}>{gained}%</Text>
                  </View>
                )}
                <Text
                  style={font(40, c.outline)}
                  accessibilityLabel={`Job match ${after} percent`}
                >
                  {shown}%
                </Text>
              </View>
            </View>
            <TileBar
              filled={Math.round(shown / 5)}
              total={20}
              color={c.grassDark}
              height={12}
              label={`Job match ${after} percent`}
            />
            {bossWin ? (
              <View className="flex-row items-center gap-1">
                <Icon name="check-bold" size={18} color={c.grassDark} />
                <Text className="flex-1" style={font(18, c.grassDark)}>
                  This skill now counts toward your match.
                </Text>
              </View>
            ) : passed ? (
              <Text style={font(18)}>
                Beat this stage’s boss to raise your match.
              </Text>
            ) : (
              <Text style={font(18)}>
                Review the explanations, then try again. Missed concepts come
                back in later levels.
              </Text>
            )}
          </View>

          <View className="gap-3">
            {passed && p.next ? (
              <PixelButton
                label="Next level"
                onPress={() =>
                  router.replace({
                    pathname: "/level/[id]",
                    params: { id: p.next },
                  })
                }
              />
            ) : !passed ? (
              <PixelButton
                label="Try again"
                onPress={() =>
                  router.replace({
                    pathname: "/level/[id]",
                    params: { id: p.id },
                  })
                }
              />
            ) : null}
            <PixelButton
              label="Back to map"
              icon="map-outline"
              variant="secondary"
              onPress={toMap}
            />
          </View>
        </View>
      </ScrollView>
    </PixelBackground>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View
      className="flex-1 items-center p-3"
      style={panel}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={font(20)}>{label}</Text>
      <Text style={font(40, color)}>{value}</Text>
    </View>
  );
}
