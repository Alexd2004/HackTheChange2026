// Game map: Job Match %, XP, and each stage's winding path of level nodes.
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  Image,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { getPlanBundle } from "@/lib/api";
import { setCurrentPlan } from "@/lib/auth";
import { pixelColors as c } from "@/lib/theme";
import type { PlanBundle, StageWithLevels } from "@/lib/types";
import { LevelNode, NODE_SIZE } from "@/components/LevelNode";
import { ErrorState, LoadingState, Screen } from "@/components/ui";
import { Icon, font, outlined, panel } from "@/components/pixel";

const ROW_HEIGHT = 150; // vertical space per level node (node + label)
const STAGE_PAD = 12;
const STAGE_BORDER = 4;
const ROAD_TUCK = 24; // how far the road runs up under the banner
const ROAD_TAIL = ROW_HEIGHT / 3; // room under the last node's label

const background = require("../../../assets/maps sprites/main background.png");
const monkey = require("../../../assets/Icons and border/monkey icon.png");
const bossIcon = require("../../../assets/Icons and border/level1 boss icon.png");
const ICON_SIZE = 64;
const XP_GREEN = "#7BD91F";
const road = require("../../../assets/maps sprites/winding path.png");
const ROAD_ASPECT = 724 / 2172;
// Road center as a fraction of the image width, sampled at 17 even heights (top to bottom).
const ROAD_CENTER = [
  0.68, 0.68, 0.85, 0.7, 0.31, 0.27, 0.6, 0.75, 0.51, 0.22, 0.3, 0.7, 0.77,
  0.49, 0.25, 0.37, 0.49,
];
const roadCenter = (t: number) => {
  const f = t * (ROAD_CENTER.length - 1);
  const i = Math.min(Math.floor(f), ROAD_CENTER.length - 2);
  return ROAD_CENTER[i] + (ROAD_CENTER[i + 1] - ROAD_CENTER[i]) * (f - i);
};

export default function MapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [fontLoaded] = useFonts({ Jersey25_400Regular });
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getPlanBundle(id)
      .then((b) => {
        setBundle(b);
        setCurrentPlan(b.plan.id); // remembered on the profile for "Continue"
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't load your map."),
      );
  }, [id]);

  // Reload every time we come back from a level so unlocks show up.
  useFocusEffect(load);

  if (error) {
    return (
      <Screen background={c.meadow}>
        <ErrorState
          message={error}
          onRetry={load}
          onBack={() => router.replace("/")}
        />
      </Screen>
    );
  }
  if (!bundle || !fontLoaded)
    return (
      <Screen background={c.meadow}>
        <LoadingState message="Loading your map…" />
      </Screen>
    );

  const { plan, skills, stages } = bundle;
  const allLevels = stages.flatMap((s) => s.levels);
  const current = allLevels.find((l) => l.status === "unlocked");
  const gaps = skills.filter((s) => s.is_gap);
  const gained = plan.match_pct - plan.start_match_pct;
  const isBeaten = (s: StageWithLevels) =>
    s.levels.some((l) => l.type === "boss" && l.status === "completed");
  // Only the stage being played is open; if every stage is beaten, the last one.
  const firstOpen = stages.findIndex((s) => !isBeaten(s));
  const activeIndex = firstOpen === -1 ? stages.length - 1 : firstOpen;

  return (
    <Screen background={c.meadow}>
      {/* Job match, with the back arrow beside the title */}
      <View className="mt-4 gap-2 p-4" style={panel}>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
            accessibilityRole="button"
            accessibilityLabel="Back to start"
            hitSlop={8}
            className="min-h-[44px] min-w-[44px] justify-center"
          >
            <Icon name="arrow-left" size={30} color={c.wood} />
          </Pressable>
          <View className="flex-1">
            <Text style={font(30)} accessibilityRole="header" numberOfLines={2}>
              {plan.job_title}
            </Text>
            {plan.company ? (
              <Text style={font(20, c.dirtEdge)}>{plan.company}</Text>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-end justify-between">
          <Text style={font(24)}>Job match</Text>
          <View className="flex-row items-end gap-2">
            {gained > 0 && (
              <View className="flex-row items-center pb-1">
                <Icon name="arrow-up-bold" size={16} color={c.grassDark} />
                <Text style={font(20, c.grassDark)}>{gained}%</Text>
              </View>
            )}
            <Text style={font(44)}>{plan.match_pct}%</Text>
          </View>
        </View>
        <View style={{ marginVertical: 10 }}>
          <JobMatchBar pct={plan.match_pct} />
        </View>
        {gaps.length > 0 && (
          <Text style={font(20)}>
            <Text style={font(20, c.red)}>To learn: </Text>
            {gaps.map((s) => s.name).join(", ")}
          </Text>
        )}
      </View>

      {stages.length === 0 ? (
        <View className="mt-8 items-center gap-2 p-6" style={panel}>
          <Icon name="party-popper" size={44} color={c.dirtEdge} />
          <Text className="text-center" style={font(26)}>
            No skill gaps found
          </Text>
          <Text className="text-center" style={font(20)}>
            Your resume already covers what this posting asks for.
          </Text>
        </View>
      ) : (
        stages.map((stage, si) => (
          <StageSection
            // Keyed on `expanded` so a manual toggle resets when the active stage moves on.
            key={`${stage.id}-${si === activeIndex}`}
            expanded={si === activeIndex}
            stage={stage}
            stageNumber={si + 1}
            skillName={skills.find((s) => s.id === stage.skill_id)?.name ?? ""}
            levelOffset={stages
              .slice(0, si)
              .reduce((a, s) => a + s.levels.length, 0)}
            currentId={current?.id}
          />
        ))
      )}
    </Screen>
  );
}

/** Pixel XP bar: octagon "XP" badge on the left, gold-rimmed dark track, green fill. */
function JobMatchBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View
      className="flex-row items-center"
      accessibilityRole="progressbar"
      accessibilityLabel={`Job match ${pct} percent`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
    >
      <View
        className="h-[34px] flex-1 justify-center"
        style={{
          marginLeft: 22,
          paddingLeft: 26,
          paddingRight: 4,
          backgroundColor: c.outline,
          borderWidth: 3,
          borderColor: c.gold,
          boxShadow: `0 3px 0 ${c.outline}`,
        }}
      >
        <View
          style={{
            width: `${clamped}%`,
            height: 18,
            backgroundColor: XP_GREEN,
            borderWidth: 2,
            borderColor: "#3F7A0F",
          }}
        >
          <View style={{ height: 4, margin: 2, backgroundColor: "#C8F58A" }} />
        </View>
      </View>
      {/* Badge drawn last so it overlaps the track's left end. */}
      <View
        className="absolute left-0 h-[48px] w-[48px] items-center justify-center"
        style={{
          backgroundColor: "#173A1A",
          borderWidth: 4,
          borderColor: c.gold,
          boxShadow: `0 0 0 3px ${c.outline}`,
          borderRadius: 14,
        }}
      >
        <Text style={outlined(22, c.cream)}>XP</Text>
      </View>
    </View>
  );
}

function StageSection({
  stage,
  stageNumber,
  skillName,
  levelOffset,
  currentId,
  expanded,
}: {
  stage: StageWithLevels;
  stageNumber: number;
  skillName: string;
  levelOffset: number;
  currentId?: string;
  expanded: boolean;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const width =
    Math.min(windowWidth, 480) - 32 - (STAGE_PAD + STAGE_BORDER) * 2; // Screen's max width minus padding and border
  const done = stage.levels.filter((l) => l.status === "completed").length;
  const beaten = stage.levels.some(
    (l) => l.type === "boss" && l.status === "completed",
  );
  const locked = stage.levels.every((l) => l.status === "locked");
  const [open, setOpen] = useState(expanded);
  const height = stage.levels.length * ROW_HEIGHT;
  const roadHeight = ROAD_TUCK + height + ROAD_TAIL + STAGE_PAD; // runs through the bottom padding
  const roadWidth = Math.min(width, roadHeight * ROAD_ASPECT);
  const roadLeft = (width - roadWidth) / 2;
  // x on the road for y (in the road box) as a fraction of the road image's height.
  const roadX = (y: number) =>
    roadLeft + roadWidth * roadCenter((y + ROAD_TUCK) / roadHeight);
  const [contentHeight, setContentHeight] = useState(0);

  return (
    <View
      className="mt-8 overflow-hidden"
      style={{
        borderWidth: STAGE_BORDER,
        borderBottomWidth: STAGE_BORDER * 2,
        borderColor: c.outline,
      }}
    >
      {/* Explicit sizes: on web an absolute-fill Image renders at its natural size. */}
      <Image
        source={background}
        resizeMode="cover"
        style={{
          position: "absolute",
          width: width + STAGE_PAD * 2,
          height: contentHeight,
        }}
      />
      <View
        style={{ padding: STAGE_PAD }}
        onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
      >
        {/* Stage banner: glowing gold panel, monkey on the left edge, boss on the right. */}
        <Pressable
          onPress={() => setOpen((o) => !o)}
          disabled={!beaten}
          className="items-center justify-center py-3"
          style={{
            zIndex: 1,
            width,
            paddingHorizontal: ICON_SIZE * 0.6,
            backgroundColor: locked ? c.stone : c.gold,
            borderWidth: 4,
            borderColor: c.outline,
            boxShadow: locked ? "none" : "0 0 14px 4px rgba(255,211,77,0.85)",
          }}
          accessibilityRole={beaten ? "button" : "header"}
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Stage ${stageNumber}: ${stage.title}. Skill: ${skillName}. ${locked ? "Locked" : `${done} of ${stage.levels.length} levels done${beaten ? ", stage beaten" : ""}`}. ${open ? "Expanded" : "Collapsed"}.`}
        >
          <Image
            source={monkey}
            style={{
              position: "absolute",
              left: -ICON_SIZE / 3,
              width: ICON_SIZE,
              height: ICON_SIZE,
            }}
          />
          <Image
            source={bossIcon}
            style={{
              position: "absolute",
              right: -ICON_SIZE / 3,
              width: ICON_SIZE,
              height: ICON_SIZE,
            }}
          />
          <Text className="text-center" style={font(16)}>
            Stage {stageNumber} · {skillName} ·{" "}
            {beaten
              ? "Beaten"
              : locked
                ? "Locked"
                : `${done}/${stage.levels.length}`}
          </Text>
          <Text className="text-center" style={font(26)} numberOfLines={2}>
            {stage.title}
          </Text>
          {stage.summary ? (
            <Text className="text-center" style={font(16)} numberOfLines={3}>
              {stage.summary}
            </Text>
          ) : null}
        </Pressable>

        {/* Road + nodes: the road runs under the banner at the top and under the bottom border at the end. */}
        {open && (
          <View style={{ width, height: height + ROAD_TAIL }}>
            <Image
              source={road}
              resizeMode="stretch"
              style={{
                position: "absolute",
                left: roadLeft,
                top: -ROAD_TUCK,
                width: roadWidth,
                height: roadHeight,
              }}
            />
            {stage.levels.map((level, i) => {
              const t = (i + 0.5) / stage.levels.length;
              return (
                <View
                  key={level.id}
                  style={{
                    position: "absolute",
                    left: roadX(t * height) - 70,
                    top: t * height - NODE_SIZE / 2,
                  }}
                >
                  <LevelNode
                    level={level}
                    number={levelOffset + i + 1}
                    isCurrent={level.id === currentId}
                    onPress={() =>
                      router.push({
                        pathname: "/level/[id]",
                        params: { id: level.id },
                      })
                    }
                  />
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
