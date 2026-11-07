// Horizontal progress bar (Job Match %, level progress). Animates width unless motion is off.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSettings } from "@/lib/settings";
import { colors } from "@/lib/theme";

export function ProgressBar({
  pct, color = colors.brand, label, height = 10,
}: { pct: number; color?: string; label: string; height?: number }) {
  const { motionOff } = useSettings();
  const clamped = Math.max(0, Math.min(100, pct));
  const width = useSharedValue(motionOff ? clamped : 0);

  useEffect(() => {
    width.value = motionOff ? clamped : withTiming(clamped, { duration: 700 });
  }, [clamped, motionOff, width]);

  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      className="w-full rounded-full bg-raised overflow-hidden"
      style={{ height }}>
      <Animated.View style={[{ height, backgroundColor: color, borderRadius: height }, fill]} />
    </View>
  );
}
