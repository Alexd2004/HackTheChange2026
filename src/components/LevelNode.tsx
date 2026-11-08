// A level button on the map, drawn from the node sprite sheets: blue = playable, gold = completed,
// gray = locked. Bosses use the boss coin. The current level gently pulses, with the player monkey beside it.
import { useSettings } from "@/lib/settings";
import { pixelColors as c, levelTypeLabel } from "@/lib/theme";
import type { Level, LevelStatus } from "@/lib/types";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { Sprite, font, type Frame, type Sheet } from "./pixel";

export const NODE_SIZE = 60;

const nodes: Sheet = { src: require("../../assets/maps sprites/level nodes.png"), w: 1536, h: 1024 };
const nodeFrames: Record<LevelStatus, Frame> = {
  unlocked: { x: 856, y: 150, w: 302, h: 284 },
  completed: { x: 371, y: 554, w: 302, h: 284 },
  locked: { x: 856, y: 554, w: 302, h: 284 },
};

type BossCoin = { sheet: Sheet; frames: Record<LevelStatus, Frame> };
const bossCoins: Record<number, BossCoin> = {
  1: {
    sheet: { src: require("../../assets/maps sprites/level1 boss node.png"), w: 1536, h: 1024 },
    frames: {
      locked: { x: 90, y: 289, w: 400, h: 446 },
      unlocked: { x: 569, y: 289, w: 400, h: 446 },
      completed: { x: 1045, y: 289, w: 400, h: 446 },
    },
  },
  2: {
    sheet: { src: require("../../assets/maps sprites/level2 boss node.png"), w: 2172, h: 724 },
    frames: {
      locked: { x: 97, y: 25, w: 618, h: 666 },
      unlocked: { x: 778, y: 25, w: 618, h: 666 },
      completed: { x: 1459, y: 25, w: 618, h: 666 },
    },
  },
};
// shortcut: stages past 2 reuse the stage-1 coin; add a bossCoins entry when their art exists.
const bossCoinFor = (stage: number) => bossCoins[stage] ?? bossCoins[1];
const frameFor = (level: Level, stage: number) =>
  (level.type === "boss" ? bossCoinFor(stage).frames : nodeFrames)[level.status];

const monkey: Sheet = { src: require("../../assets/level1 monkey idle2.png"), w: 2172, h: 724 };
// First 3 of the 6 idle2 frames (362px columns); rows trimmed to the character, feet on the same row.
const monkeyFrames: Frame[] = [0, 1, 2].map((i) => ({ x: i * 362, y: 120, w: 362, h: 490 }));
export const MONKEY_WIDTH = 54; // about 73px tall, same height as before
export const MONKEY_HEIGHT = (monkeyFrames[0].h * MONKEY_WIDTH) / monkeyFrames[0].w;

/** The player character standing idle. Holds the first frame when motion is off. */
export function IdleMonkey() {
  const { motionOff } = useSettings();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (motionOff) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % monkeyFrames.length), 250);
    return () => clearInterval(id);
  }, [motionOff]);
  return <Sprite sheet={monkey} frame={monkeyFrames[motionOff ? 0 : frame]} width={MONKEY_WIDTH} />;
}

const running: Sheet = { src: require("../../assets/monkey running.png"), w: 2172, h: 724 };
// 3 run frames, one per 724px column, character facing right; rows trimmed to the character.
const runFrames: Frame[] = [0, 1, 2].map((i) => ({ x: i * 724, y: 30, w: 724, h: 690 }));
export const RUN_WIDTH = 76;
export const RUN_HEIGHT = (runFrames[0].h * RUN_WIDTH) / runFrames[0].w; // ~72px, same as the idle monkey

/** The player running along the map road; `flip` faces it left. Frames only cycle while `animate`. */
export function RunningMonkey({ flip, animate }: { flip: boolean; animate: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % runFrames.length), 100);
    return () => clearInterval(id);
  }, [animate]);
  return (
    <View
      style={{ width: RUN_WIDTH, transform: [{ scaleX: flip ? -1 : 1 }] }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Sprite sheet={running} frame={runFrames[frame]} width={RUN_WIDTH} />
    </View>
  );
}

/** Where the standing player's feet are, relative to the node's centre (feet at the coin's middle). */
export const playerFeetY = (level: Level, stage: number) => {
  const f = frameFor(level, stage);
  return (f.h * NODE_SIZE) / f.w / 2 - NODE_SIZE / 2;
};

export function LevelNode({
  level, stage, title = level.title, number, isCurrent, hidePlayer, onPress,
}: {
  level: Level;
  /** 1-based stage number: picks that stage's boss coin art. */
  stage: number;
  title?: string;
  number: number;
  isCurrent: boolean;
  hidePlayer?: boolean;
  onPress: () => void;
}) {
  const { motionOff } = useSettings();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isCurrent && !motionOff) {
      scale.value = withRepeat(withSequence(withTiming(1.08, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
    } else {
      cancelAnimation(scale);
      scale.value = 1;
    }
  }, [isCurrent, motionOff, scale]);

  const pulse = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const locked = level.status === "locked";
  const isBoss = level.type === "boss";
  const nodeFrame = frameFor(level, stage);
  const nodeHeight = (nodeFrame.h * NODE_SIZE) / nodeFrame.w;
  const stateText = locked ? "locked" : level.status === "completed" ? `completed, best score ${level.best_score ?? 0}%` : "ready to play";

  return (
    <View className="items-center" style={{ width: 140 }}>
      <Pressable
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={`${levelTypeLabel[level.type]} ${number}: ${title}, ${stateText}${isCurrent ? ", you are here" : ""}`}
        accessibilityState={{ disabled: locked }}
        hitSlop={8}>
        <Animated.View style={pulse}>
          <Sprite sheet={isBoss ? bossCoinFor(stage).sheet : nodes} frame={nodeFrame} width={NODE_SIZE} />
        </Animated.View>
      </Pressable>
      {isCurrent && (
        // Stands on the node: feet at the coin's middle so its lower half stays visible. Hidden by
        // opacity (not unmounted) during the map's run so it is already drawn when the run hands over.
        <View
          style={{
            position: "absolute",
            left: (140 - MONKEY_WIDTH) / 2,
            top: nodeHeight * 0.5 - MONKEY_HEIGHT,
            opacity: hidePlayer ? 0 : 1,
          }}
          pointerEvents="none">
          <IdleMonkey />
        </View>
      )}
      <Text
        numberOfLines={2}
        className="mt-1 px-2 text-center"
        style={{ ...font(18, locked ? c.stoneDark : c.wood), backgroundColor: c.parchment, borderWidth: 2, borderColor: c.wood }}>
        {title}
      </Text>
    </View>
  );
}
