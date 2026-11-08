// Small map notice while this stage's remaining levels are still being written in the background
// (see startLevelPrep in src/lib/api.ts). Hidden once they're all ready.
import { ActivityIndicator, Text, View } from "react-native";
import type { PrepState } from "@/lib/api";
import { pixelColors as c } from "@/lib/theme";
import { font, panel } from "./pixel";

export function PrepStatus({ state }: { state: PrepState | null }) {
  if (!state || !state.running || state.ready >= state.total) return null;
  return (
    <View
      className="mt-4 flex-row items-center gap-3 p-3"
      style={panel}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Preparing your levels: ${state.ready} of ${state.total} ready. You can start playing now.`}>
      <ActivityIndicator color={c.wood} />
      <Text className="flex-1" style={font(20)}>
        Preparing your levels: {state.ready} of {state.total} ready. You can start playing now.
      </Text>
    </View>
  );
}
