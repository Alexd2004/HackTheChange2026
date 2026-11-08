import { Sprite, type Sheet } from "@/components/pixel";
import { useSettings } from "@/lib/settings";
import { pixelColors as c, pixelFont as pixel } from "@/lib/theme";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// 6 frames of 362×724: 0-2 idle, 3-5 jump, all drawn at one scale on one baseline.
// The crop skips the empty top/bottom of each frame (art spans y≈127-608).
const sheet: Sheet = {
  src: require("../../assets/monkey_full_jump.png"),
  w: 2172,
  h: 724,
};
const frameAt = (i: number) => ({ x: i * 362, y: 110, w: 362, h: 510 });

export function Landing({ onContinue }: { onContinue: () => void }) {
  const [loaded] = useFonts({ Jersey25_400Regular });
  const [jumping, setJumping] = useState(false);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (jumping) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 3), 300);
    return () => clearInterval(t);
  }, [jumping]);

  const { motionOff } = useSettings();
  const opacity = useSharedValue(1);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Play the jump frames once, hold the last one, fade the content out over the grass, then leave.
  const start = () => {
    const fadeMs = motionOff ? 0 : 300;
    setFrame(3);
    setJumping(true);
    setTimeout(() => setFrame(4), 200);
    setTimeout(() => setFrame(5), 400);
    setTimeout(
      () => (opacity.value = withTiming(0, { duration: fadeMs })),
      700,
    );
    setTimeout(onContinue, 700 + fadeMs);
  };

  if (!loaded) return null;
  // Drawn inside the caller's PixelBackground, which stays mounted when the landing leaves.
  return (
    <Animated.View style={[{ flex: 1 }, fade]}>
      <View className="w-full max-w-[480px] flex-1 items-center justify-center self-center px-6">
        <Sprite sheet={sheet} frame={frameAt(frame)} width={120} />
        <Text
          accessibilityRole="header"
          style={{
            fontFamily: pixel,
            marginTop: 12,
            fontSize: 76,
            lineHeight: 80,
            color: c.gold,
            textShadowColor: c.outline,
            textShadowOffset: { width: 5, height: 5 },
            textShadowRadius: 0,
          }}
        >
          SkillQuest
        </Text>

        <View
          className="mt-8 w-full p-5"
          style={{
            backgroundColor: c.parchment,
            borderWidth: 4,
            borderColor: c.wood,
            boxShadow: `6px 6px 0 ${c.outline}`,
          }}
        >
          <Text
            style={{
              fontFamily: pixel,
              fontSize: 24,
              lineHeight: 28,
              color: c.wood,
              textAlign: "center",
            }}
          >
            Turn any job posting into a quest!
          </Text>
        </View>

        <Pressable
          onPress={start}
          disabled={jumping}
          accessibilityRole="button"
          accessibilityLabel="Get started"
          accessibilityHint="Opens the resume and job posting form"
          className="mt-12 items-center"
        >
          {({ pressed }) => (
            <>
              <Text
                style={{
                  fontFamily: pixel,
                  fontSize: 32,
                  color: "#FFFFFF",
                  textShadowColor: c.outline,
                  textShadowOffset: { width: 3, height: 3 },
                  textShadowRadius: 0,
                }}
              >
                Get Started
              </Text>
              <View
                className="mt-3 h-16 w-28 items-center justify-center"
                style={{
                  backgroundColor: c.gold,
                  borderWidth: 4,
                  borderColor: c.outline,
                  boxShadow: pressed ? "none" : `0 6px 0 ${c.outline}`,
                  transform: [{ translateY: pressed ? 6 : 0 }],
                }}
              >
                <Text
                  style={{
                    fontFamily: pixel,
                    fontSize: 40,
                    lineHeight: 44,
                    color: c.outline,
                  }}
                >
                  →
                </Text>
              </View>
            </>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
}
