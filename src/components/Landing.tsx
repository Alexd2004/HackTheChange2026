import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { pixelColors as c, pixelFont as pixel } from "@/lib/theme";

// Pixel flowers/tufts: [left %, top %, color].
const dots: [number, number, string][] = [
  [8, 8, "#F6A6D8"],
  [86, 14, "#FFFFFF"],
  [12, 30, c.grassDark],
  [80, 38, "#F6A6D8"],
  [6, 56, "#FFFFFF"],
  [88, 62, c.grassDark],
  [14, 80, "#F6A6D8"],
  [78, 88, "#FFFFFF"],
];

/** grass background with pixel flowers, shared by the landing and loading screens. */
export function PixelBackground({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: c.grass }}
      edges={["top", "bottom"]}
    >
      <View
        className="absolute inset-0"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {dots.map(([l, t, color], i) => (
          <View
            key={`d${i}`}
            className="absolute h-3 w-3"
            style={{ left: `${l}%`, top: `${t}%`, backgroundColor: color }}
          />
        ))}
      </View>
      {children}
    </SafeAreaView>
  );
}

export function Landing({ onContinue }: { onContinue: () => void }) {
  const [loaded] = useFonts({ Jersey25_400Regular });

  return (
    <PixelBackground>
      {loaded && (
        <View className="w-full max-w-[480px] flex-1 items-center justify-center self-center px-6">
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: pixel,
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
            onPress={onContinue}
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
      )}
    </PixelBackground>
  );
}
