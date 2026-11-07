// Game map: Job Match %, XP, and each stage's winding path of level nodes.
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { getPlanBundle } from "@/lib/api";
import { colors } from "@/lib/theme";
import type { PlanBundle, StageWithLevels } from "@/lib/types";
import { LevelNode, NODE_SIZE } from "@/components/LevelNode";
import { MapPath, type Point } from "@/components/MapPath";
import { ProgressBar } from "@/components/ProgressBar";
import { ErrorState, LoadingState, Screen } from "@/components/ui";

const ROW_HEIGHT = 150; // vertical space per level node (node + label)
const ZIGZAG = [0.5, 0.75, 0.5, 0.25]; // x position of each node as a fraction of width

export default function MapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getPlanBundle(id)
      .then(setBundle)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your map."));
  }, [id]);

  // Reload every time we come back from a level so unlocks show up.
  useFocusEffect(load);

  if (error) {
    return <Screen><ErrorState message={error} onRetry={load} onBack={() => router.replace("/")} /></Screen>;
  }
  if (!bundle) return <Screen><LoadingState message="Loading your map…" /></Screen>;

  const { plan, skills, stages } = bundle;
  const allLevels = stages.flatMap((s) => s.levels);
  const current = allLevels.find((l) => l.status === "unlocked");
  const gaps = skills.filter((s) => s.is_gap);
  const strengths = skills.filter((s) => !s.is_gap);
  const gained = plan.match_pct - plan.start_match_pct;

  return (
    <Screen>
      {/* Header */}
      <View className="flex-row items-center justify-between pt-4">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          accessibilityRole="button"
          accessibilityLabel="Back to start"
          hitSlop={8}
          className="min-h-[44px] min-w-[44px] justify-center">
          <Text className="text-2xl text-fg">←</Text>
        </Pressable>
        <View
          className="flex-row items-center gap-1 rounded-full bg-panel px-4 py-2"
          accessible
          accessibilityLabel={`${plan.xp} experience points`}>
          <Text className="text-base">✨</Text>
          <Text className="text-base font-extrabold text-brand">{plan.xp} XP</Text>
        </View>
      </View>

      <Text className="mt-2 text-2xl font-extrabold text-fg" accessibilityRole="header" numberOfLines={2}>
        {plan.job_title}
      </Text>
      {plan.company ? <Text className="text-base text-muted">{plan.company}</Text> : null}

      {/* Job match */}
      <View className="mt-4 gap-3 rounded-2xl border border-line bg-panel p-4">
        <View className="flex-row items-end justify-between">
          <Text className="text-base font-semibold text-muted">Job match</Text>
          <View className="flex-row items-end gap-2">
            {gained > 0 && <Text className="pb-1 text-sm font-bold text-good">▲ {gained}%</Text>}
            <Text className="text-4xl font-extrabold text-brand">{plan.match_pct}%</Text>
          </View>
        </View>
        <ProgressBar pct={plan.match_pct} label={`Job match ${plan.match_pct} percent`} height={12} />
        {strengths.length > 0 && (
          <Text className="text-sm leading-5 text-muted">
            <Text className="font-semibold text-good">✓ You have: </Text>
            {strengths.map((s) => s.name).join(", ")}
          </Text>
        )}
        {gaps.length > 0 && (
          <Text className="text-sm leading-5 text-muted">
            <Text className="font-semibold text-challenge">△ To learn: </Text>
            {gaps.map((s) => s.name).join(", ")}
          </Text>
        )}
      </View>

      {stages.length === 0 ? (
        <View className="mt-8 items-center gap-2 rounded-2xl bg-panel p-6">
          <Text className="text-4xl">🎉</Text>
          <Text className="text-center text-lg font-bold text-fg">No skill gaps found</Text>
          <Text className="text-center text-base text-muted">Your resume already covers what this posting asks for.</Text>
        </View>
      ) : (
        stages.map((stage, si) => (
          <StageSection
            key={stage.id}
            stage={stage}
            stageNumber={si + 1}
            skillName={skills.find((s) => s.id === stage.skill_id)?.name ?? ""}
            levelOffset={stages.slice(0, si).reduce((a, s) => a + s.levels.length, 0)}
            currentId={current?.id}
          />
        ))
      )}
    </Screen>
  );
}

function StageSection({
  stage, stageNumber, skillName, levelOffset, currentId,
}: { stage: StageWithLevels; stageNumber: number; skillName: string; levelOffset: number; currentId?: string }) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, 480) - 32; // matches Screen's max width minus padding
  const done = stage.levels.filter((l) => l.status === "completed").length;
  const beaten = stage.levels.some((l) => l.type === "boss" && l.status === "completed");
  const height = stage.levels.length * ROW_HEIGHT;

  const points: Point[] = stage.levels.map((_, i) => ({
    x: Math.round(width * ZIGZAG[i % ZIGZAG.length]),
    y: i * ROW_HEIGHT + NODE_SIZE / 2 + 8,
  }));

  return (
    <View className="mt-8">
      {/* Stage banner */}
      <View
        className="rounded-2xl border p-4"
        style={{ borderColor: beaten ? colors.good : colors.line, backgroundColor: colors.panel }}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`Stage ${stageNumber}: ${stage.title}. Skill: ${skillName}. ${done} of ${stage.levels.length} levels done${beaten ? ", stage beaten" : ""}.`}>
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-bold uppercase tracking-widest text-muted">
            Stage {stageNumber} · {skillName}
          </Text>
          <Text className={`text-xs font-bold ${beaten ? "text-good" : "text-muted"}`}>
            {beaten ? "✓ Beaten" : `${done}/${stage.levels.length}`}
          </Text>
        </View>
        <Text className="mt-1 text-xl font-extrabold text-fg">{stage.title}</Text>
        {stage.summary ? <Text className="mt-1 text-sm leading-5 text-muted">{stage.summary}</Text> : null}
      </View>

      {/* Path + nodes */}
      <View style={{ width, height, marginTop: 16 }}>
        <MapPath points={points} width={width} height={height} completedSegments={Math.max(0, done)} />
        {stage.levels.map((level, i) => (
          <View key={level.id} style={{ position: "absolute", left: points[i].x - 70, top: i * ROW_HEIGHT }}>
            <LevelNode
              level={level}
              number={levelOffset + i + 1}
              isCurrent={level.id === currentId}
              onPress={() => router.push({ pathname: "/level/[id]", params: { id: level.id } })}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
