// A level button on the map, drawn from the node sprite sheets: blue = playable, gold = completed,
// gray = locked. Bosses use the boss coin. The current level gently pulses.
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { useSettings } from "@/lib/settings";
import { levelTypeLabel, pixelColors as c } from "@/lib/theme";
import type { Level, LevelStatus } from "@/lib/types";
import { Sprite, font, type Frame, type Sheet } from "./pixel";

export const NODE_SIZE = 72;

const nodes: Sheet = { src: require("../../assets/maps sprites/level nodes.png"), w: 1536, h: 1024 };
const nodeFrames: Record<LevelStatus, Frame> = {
  unlocked: { x: 856, y: 150, w: 302, h: 284 },
  completed: { x: 371, y: 554, w: 302, h: 284 },
  locked: { x: 856, y: 554, w: 302, h: 284 },
};

// shortcut: every stage's boss uses the stage-1 coin; switch to "level2 boss node.png" per stage once its layout is mapped.
const boss: Sheet = { src: require("../../assets/maps sprites/level1 boss node.png"), w: 1536, h: 1024 };
const bossFrames: Record<LevelStatus, Frame> = {
  locked: { x: 90, y: 289, w: 400, h: 446 },
  unlocked: { x: 569, y: 289, w: 400, h: 446 },
  completed: { x: 1045, y: 289, w: 400, h: 446 },
};

export function LevelNode({
  level, number, isCurrent, onPress,
}: { level: Level; number: number; isCurrent: boolean; onPress: () => void }) {
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
  const stateText = locked ? "locked" : level.status === "completed" ? `completed, best score ${level.best_score ?? 0}%` : "ready to play";

  return (
    <View className="items-center" style={{ width: 140 }}>
      <Pressable
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={`${levelTypeLabel[level.type]} ${number}: ${level.title}, ${stateText}`}
        accessibilityState={{ disabled: locked }}
        hitSlop={8}>
        <Animated.View style={pulse}>
          <Sprite
            sheet={isBoss ? boss : nodes}
            frame={(isBoss ? bossFrames : nodeFrames)[level.status]}
            width={isBoss ? NODE_SIZE + 12 : NODE_SIZE}
          />
        </Animated.View>
      </Pressable>
      <Text
        numberOfLines={2}
        className="mt-1 px-2 text-center"
        style={{ ...font(18, locked ? c.stoneDark : c.wood), backgroundColor: c.parchment, borderWidth: 2, borderColor: c.wood }}>
        {level.title}
      </Text>
    </View>
  );
}
