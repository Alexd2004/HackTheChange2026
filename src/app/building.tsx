// "Building your map…" screen: sends the resume + posting to create-plan, waits until the FIRST
// level's questions are written, then opens the map. The other levels keep being written one after
// another in the background (startLevelPrep), so they're ready by the time the player reaches them.
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { createPlan, prepareFirstLevel, startLevelPrep, takePendingPlanInput } from "@/lib/api";
import { saveResume } from "@/lib/resume";
import type { CreatePlanInput } from "@/lib/types";
import { ErrorState, Screen } from "@/components/ui";
import { PixelBackground, TileBar, outlined } from "@/components/pixel";
import { pixelColors as c } from "@/lib/theme";
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
  const planId = useRef<string | null>(null); // set once the map exists, so Retry doesn't rebuild it
  const [step, setStep] = useState(0);
  const [writingFirst, setWritingFirst] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!input.current && !planId.current) {
      router.replace("/");
      return;
    }
    setError(null);
    try {
      if (!planId.current && input.current) {
        setStep(0);
        const id = await createPlan(input.current);
        // Keep the resume on the phone (never on the server) so the resume revamp can use it later.
        // A failed save only means the revamp screen asks for the resume again.
        await saveResume(id, input.current.resume).catch(() => {});
        input.current = null; // drop the resume from memory as soon as we're done
        planId.current = id;
      }
      const id = planId.current!;
      setWritingFirst(true);
      await prepareFirstLevel(id); // the map opens with level 1 ready to play
      startLevelPrep(id); // the rest are written one after another while the player plays
      router.replace({ pathname: "/plan/[id]", params: { id } });
    } catch (e) {
      setWritingFirst(false);
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

  const filled = writingFirst ? TILES - 1 : Math.round(((step + 1) / STEPS.length) * (TILES - 2));
  const message = writingFirst ? "Writing your first level…" : STEPS[step];

  return (
    <PixelBackground>
      {fontLoaded && (
        <View className="w-full max-w-[480px] flex-1 items-center justify-center self-center px-6">
          <Text accessibilityLiveRegion="polite" style={{ ...outlined(32, "#FFFFFF"), textAlign: "center" }}>
            {message}
          </Text>

          <View className="mt-8 w-full" style={{ boxShadow: `6px 6px 0 ${c.outline}` }}>
            <TileBar filled={filled} total={TILES} label="Building your map" />
          </View>

          <Text style={{ ...outlined(24), marginTop: 24 }}>This takes about 20 seconds.</Text>
        </View>
      )}
    </PixelBackground>
  );
}
