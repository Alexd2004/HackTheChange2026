// "Building your map…" screen: sends the resume + posting to create-plan, then opens the map.
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { createPlan, takePendingPlanInput } from "@/lib/api";
import type { CreatePlanInput } from "@/lib/types";
import { ErrorState, Screen } from "@/components/ui";
import { PixelBackground } from "@/components/Landing";
import { pixelColors as c, pixelFont } from "@/lib/theme";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";

const TILES = 10;

const STEPS = [
  "Reading your resume…",
  "Reading the job posting…",
  "Matching your skills to the job…",
  "Finding your skill gaps…",
  "Drawing your map…",
];

export default function BuildingScreen() {
  const input = useRef<CreatePlanInput | null>(takePendingPlanInput());
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!input.current) {
      router.replace("/");
      return;
    }
    setError(null);
    setStep(0);
    try {
      const id = await createPlan(input.current);
      input.current = null; // drop the resume from memory as soon as we're done
      router.replace({ pathname: "/plan/[id]", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build your map.");
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // never send the same resume twice (e.g. dev double-mount)
    started.current = true;
    run();
  }, [run]);

  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(t);
  }, [error]);

  const [fontLoaded] = useFonts({ Jersey25_400Regular });

  if (error) {
    return (
      <Screen scroll={false}>
        <ErrorState message={error} onRetry={run} onBack={() => router.replace("/")} />
      </Screen>
    );
  }

  const filled = Math.round(((step + 1) / STEPS.length) * TILES);

  return (
    <PixelBackground>
      {fontLoaded && (
        <View className="w-full max-w-[480px] flex-1 items-center justify-center self-center px-6">
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontFamily: pixelFont,
              fontSize: 32,
              lineHeight: 36,
              color: "#FFFFFF",
              textAlign: "center",
              textShadowColor: c.outline,
              textShadowOffset: { width: 3, height: 3 },
              textShadowRadius: 0,
            }}>
            {STEPS[step]}
          </Text>

          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: TILES, now: filled }}
            className="mt-8 w-full flex-row gap-1 p-1"
            style={{
              backgroundColor: c.parchment,
              borderWidth: 4,
              borderColor: c.outline,
              boxShadow: `6px 6px 0 ${c.outline}`,
            }}>
            {Array.from({ length: TILES }, (_, i) => (
              <View
                key={i}
                className="flex-1 aspect-square"
                style={{ backgroundColor: i < filled ? c.gold : "transparent" }}
              />
            ))}
          </View>

          <Text style={{ fontFamily: pixelFont, fontSize: 20, color: c.cream, marginTop: 24 }}>
            This takes about 15 seconds.
          </Text>
        </View>
      )}
    </PixelBackground>
  );
}
