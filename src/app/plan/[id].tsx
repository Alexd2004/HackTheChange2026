// Game map: Job Match %, XP, and each stage's winding path of level nodes.
import {
  IdleMonkey,
  LevelNode,
  MONKEY_HEIGHT,
  MONKEY_WIDTH,
  NODE_SIZE,
  playerFeetY,
  RUN_HEIGHT,
  RUN_WIDTH,
  RunningMonkey,
} from "@/components/LevelNode";
import {
  font,
  Icon,
  outlined,
  panel,
  Sprite,
  type Frame,
  type Sheet,
} from "@/components/pixel";
import { PrepStatus } from "@/components/PrepStatus";
import { RevampBanner } from "@/components/RevampBanner";
import { ErrorState, LoadingState, Screen } from "@/components/ui";
import { catchUpStages, getPlanBundle, startLevelPrep, subscribePrep, type PrepState } from "@/lib/api";
import { setCurrentPlan } from "@/lib/auth";
import { levelTitle } from "@/lib/bosses";
import { takeFinishedLevel } from "@/lib/progress";
import { useSettings } from "@/lib/settings";
import { pixelColors as c } from "@/lib/theme";
import type { PlanBundle, StageWithLevels } from "@/lib/types";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";


// Monkey's run to the next level: idle at the finished level, crossfade into running (already
// moving), run along the road, crossfade back to idle on arrival. Idle + run opacity always sum to 1.
const RUN_HOLD = 250;
const RUN_MS = 1400;
const RUN_FADE = 160;
const RUN_TOTAL = RUN_HOLD + RUN_MS + RUN_FADE / 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
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
// Road center as a fraction of the image width, sampled at 33 even heights, top to bottom, tracked row by row.
const ROAD_CENTER = [
  0.68, 0.65, 0.68, 0.8, 0.84, 0.84, 0.74, 0.49, 0.35, 0.25, 0.23, 0.34, 0.5,
  0.69, 0.75, 0.68, 0.5, 0.32, 0.22, 0.21, 0.28, 0.5, 0.69, 0.78, 0.77, 0.68,
  0.49, 0.35, 0.25, 0.24, 0.36, 0.47, 0.49,
];

// Stage 1 boss castle: the boss sits on the road's last curve, the castle stands just to its right.
const TOWER_ROOM = 40; // extra room in stage 1 above the boss
const APEX_FRAC = 1920 / 2172; // last left-hand curve of the winding road image
const tower: Sheet = {
  src: require("../../../assets/maps sprites/level1 boss tower.png"),
  w: 1536,
  h: 1024,
};
const TOWER_CROP: Frame = { x: 316, y: 90, w: 887, h: 865 }; // castle's solid bounds
// Castle box in winding-road-image fractions: just right of the boss coin, centred on it, measured
// clear of the sandy road.
const CASTLE_BOX = { left: 0.488, top: 0.8283, width: 0.347 };
// Node index -> road-image fraction of the curve it sits on (measured from the road centreline).
const CURVE_FRACS: Record<number, number> = { 1: 0.272, 2: 0.587 };

/** The castle beside the stage-1 boss, positioned in the road image's own coordinates. Decorative. */
function Castle({
  roadLeft,
  roadWidth,
  roadHeight,
}: {
  roadLeft: number;
  roadWidth: number;
  roadHeight: number;
}) {
  return (
    <View
      style={{
        position: "absolute",
        left: roadLeft + CASTLE_BOX.left * roadWidth - 25,
        top: CASTLE_BOX.top * roadHeight - ROAD_TUCK - 35,
      }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Sprite
        sheet={tower}
        frame={TOWER_CROP}
        width={CASTLE_BOX.width * roadWidth + 10}
      />
    </View>
  );
}

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
  const [prep, setPrep] = useState<PrepState | null>(null);
  // Level just passed (from the result screen): the monkey runs from it to the current level.
  const [runFrom, setRunFrom] = useState<string | null>(null);
  const onRunDone = useCallback(() => setRunFrom(null), []);

  const load = useCallback(() => {
    setError(null);
    getPlanBundle(id)
      .then((b) => {
        setBundle(b);
        setCurrentPlan(b.plan.id); // remembered on the profile for "Continue"
        startLevelPrep(b.plan.id); // keep writing built stages' levels (no-op if already running)
        catchUpStages(b); // after an app restart: build a next stage whose boss fight already began
        setRunFrom(takeFinishedLevel());
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't load your map."),
      );
  }, [id]);

  // Reload every time we come back from a level so unlocks show up.
  useFocusEffect(load);

  // Background preparation progress; refresh the map each time another level is ready.
  // A counter drops a slower, older response so it can't overwrite a newer one.
  useEffect(() => {
    let latest = 0;
    return subscribePrep(id, (state) => {
      setPrep(state);
      const mine = ++latest;
      getPlanBundle(id).then((b) => { if (mine === latest) setBundle(b); }).catch(() => {});
    });
  }, [id]);

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
  // Earned (stage boss beaten) skills leave "To learn"; the DB keeps is_gap for the resume revamp.
  const gaps = skills.filter((s) => s.is_gap && !s.earned_at);
  const earned = skills.filter((s) => s.earned_at);
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
        {earned.length > 0 && (
          <Text style={font(20)}>
            <Text style={font(20, c.grassDark)}>Earned: </Text>
            {earned.map((s) => s.name).join(", ")}
          </Text>
        )}
        {gaps.length > 0 && (
          <Text style={font(20)}>
            <Text style={font(20, c.red)}>To learn: </Text>
            {gaps.map((s) => s.name).join(", ")}
          </Text>
        )}
      </View>

      <PrepStatus state={prep} />
      <RevampBanner bundle={bundle} />

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
            runFrom={runFrom}
            onRunDone={onRunDone}
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
  runFrom,
  onRunDone,
}: {
  stage: StageWithLevels;
  stageNumber: number;
  skillName: string;
  levelOffset: number;
  currentId?: string;
  expanded: boolean;
  runFrom: string | null;
  onRunDone: () => void;
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
  const hasTower = stageNumber === 1;
  const height = stage.levels.length * ROW_HEIGHT + (hasTower ? TOWER_ROOM : 0);
  const bossIndex = stage.levels.findIndex((l) => l.type === "boss");
  const roadHeight = ROAD_TUCK + height + ROAD_TAIL + STAGE_PAD; // runs through the bottom padding
  const roadWidth = Math.min(width, roadHeight * ROAD_ASPECT);
  const roadLeft = (width - roadWidth) / 2;
  // x on the road for y (in the road box) as a fraction of the road image's height.
  const roadX = (y: number) =>
    roadLeft + roadWidth * roadCenter((y + ROAD_TUCK) / roadHeight);
  // Stage 1's boss sits on the road's last curve, levels 2 and 3 on their nearest curves,
  // anything else is spaced evenly.
  const nodeY = (i: number) =>
    hasTower && i === bossIndex
      ? APEX_FRAC * roadHeight - ROAD_TUCK
      : i in CURVE_FRACS
        ? CURVE_FRACS[i] * roadHeight - ROAD_TUCK
        : (i + 0.5) * ROW_HEIGHT;
  const [contentHeight, setContentHeight] = useState(0);

  // Run the monkey along the road from the level just passed to the current one (same stage only).
  const { motionOff } = useSettings();
  const fromI = runFrom ? stage.levels.findIndex((l) => l.id === runFrom) : -1;
  const toI = stage.levels.findIndex((l) => l.id === currentId);
  const running = open && !motionOff && fromI !== -1 && toI > fromI;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - start;
      if (e < RUN_TOTAL) return setElapsed(e);
      clearInterval(id);
      setElapsed(0); // ready for the next run
      onRunDone();
    }, 16);
    return () => clearInterval(id);
  }, [running, onRunDone]);
  const p = clamp01((elapsed - RUN_HOLD) / RUN_MS);
  // 1 = idle sprite showing, 0 = running sprite; crossfades centred on leaving and arriving.
  const idleness = running
    ? Math.max(
        1 - clamp01((elapsed - RUN_HOLD + RUN_FADE / 2) / RUN_FADE),
        clamp01((elapsed - RUN_HOLD - RUN_MS + RUN_FADE / 2) / RUN_FADE),
      )
    : 1;
  // The overlay stays mounted (invisible when not running) so both sheets are loaded before a run.
  const restI = toI !== -1 ? toI : 0;
  const ovFrom = running ? fromI : restI;
  const ovTo = running ? toI : restI;
  const runY = nodeY(ovFrom) + (nodeY(ovTo) - nodeY(ovFrom)) * p;
  // A stage still being built in the background has no levels yet: no player to place.
  const fromLevel = stage.levels[ovFrom];
  const toLevel = stage.levels[ovTo];
  const feetY =
    fromLevel && toLevel
      ? runY +
        playerFeetY(fromLevel) +
        (playerFeetY(toLevel) - playerFeetY(fromLevel)) * p
      : 0;

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
            {hasTower && bossIndex !== -1 && (
              <Castle
                roadLeft={roadLeft}
                roadWidth={roadWidth}
                roadHeight={roadHeight}
              />
            )}
            {stage.levels.map((level, i) => {
              const y = nodeY(i);
              return (
                <View
                  key={level.id}
                  style={{
                    position: "absolute",
                    left: roadX(y) - 70,
                    top: y - NODE_SIZE / 2,
                  }}
                >
                  <LevelNode
                    level={level}
                    title={levelTitle(level, stageNumber - 1)}
                    number={levelOffset + i + 1}
                    isCurrent={level.id === currentId}
                    hidePlayer={running}
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
            {stage.levels.length > 0 && (
              <View
                style={{
                  position: "absolute",
                  left: roadX(runY),
                  top: feetY,
                  opacity: running ? 1 : 0,
                }}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View
                  style={{
                    position: "absolute",
                    left: -MONKEY_WIDTH / 2,
                    top: -MONKEY_HEIGHT,
                    opacity: idleness,
                  }}
                >
                  <IdleMonkey />
                </View>
                <View
                  style={{
                    position: "absolute",
                    left: -RUN_WIDTH / 2,
                    top: -RUN_HEIGHT,
                    opacity: 1 - idleness,
                  }}
                >
                  {/* Face the way the road is heading. */}
                  <RunningMonkey
                    flip={roadX(runY + 1) < roadX(runY)}
                    animate={running}
                  />
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
