// Map banner that leads to the resume revamp once at least one stage boss is beaten.
// Self-contained (takes the plan bundle) so the map can keep or move it in one line.
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { questProgress } from "@/lib/resumeDelivery";
import { pixelColors as c } from "@/lib/theme";
import type { PlanBundle } from "@/lib/types";
import { Icon, font, panel } from "./pixel";

export function RevampBanner({ bundle }: { bundle: PlanBundle }) {
  const progress = questProgress(bundle);
  if (!progress.canRevamp) return null;
  const label = progress.complete ? "Quest complete! Revamp your resume" : "Revamp your resume with your new skills";
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/revamp/[id]", params: { id: bundle.plan.id } })}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="mt-4 min-h-[56px] flex-row items-center gap-3 p-3 active:opacity-80"
      style={{ ...panel, backgroundColor: c.gold, borderColor: c.outline }}>
      <Icon name={progress.complete ? "trophy" : "file-document-edit-outline"} size={30} color={c.outline} />
      <View className="flex-1">
        <Text style={font(22, c.outline)}>{label}</Text>
        <Text style={font(18, c.wood)}>
          {progress.stagesBeaten} of {progress.stagesTotal} stages beaten
        </Text>
      </View>
      <Icon name="chevron-right" size={28} color={c.outline} />
    </Pressable>
  );
}
