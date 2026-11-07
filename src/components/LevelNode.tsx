// A round level button on the map: lock icon when locked, star when completed,
// number / bolt / skull for normal / challenge / boss. The current level gently pulses.
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { useSettings } from "@/lib/settings";
import { colors, levelColor, levelTypeLabel } from "@/lib/theme";
import type { Level } from "@/lib/types";
import { Icon } from "./pixel";

export const NODE_SIZE = 72;

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
  const done = level.status === "completed";
  const accent = levelColor(level.type);
  const size = level.type === "boss" ? NODE_SIZE + 12 : NODE_SIZE;

  const icon = locked ? "lock" : done ? "star" : level.type === "boss" ? "skull" : level.type === "challenge" ? "lightning-bolt" : null;
  const stateText = locked ? "locked" : done ? `completed, best score ${level.best_score ?? 0}%` : "ready to play";

  return (
    <View className="items-center" style={{ width: 140 }}>
      <Pressable
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={`${levelTypeLabel[level.type]} ${number}: ${level.title}, ${stateText}`}
        accessibilityState={{ disabled: locked }}
        hitSlop={8}>
        <Animated.View
          style={[
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: locked ? colors.raised : done ? accent : colors.panel,
              borderWidth: 4,
              borderColor: locked ? colors.line : accent,
              borderBottomWidth: 8, // chunky "button" depth
            },
            pulse,
          ]}>
          {icon ? (
            <Icon name={icon} size={locked ? 26 : 32} color={done ? colors.ink : locked ? colors.muted : accent} />
          ) : (
            <Text style={{ fontSize: 26, fontWeight: "800", color: accent }}>{number}</Text>
          )}
        </Animated.View>
      </Pressable>
      <Text
        numberOfLines={2}
        className={`mt-2 overflow-hidden rounded-lg bg-ink px-2 py-0.5 text-center text-sm font-semibold ${locked ? "text-muted" : "text-fg"}`}>
        {level.title}
      </Text>
    </View>
  );
}
