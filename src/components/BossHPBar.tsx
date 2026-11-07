// Boss fight header: boss HP bar (each correct answer is a hit) and the player's hearts.
import { Text, View } from "react-native";
import { BOSS_HEARTS } from "@/lib/grading";
import { colors } from "@/lib/theme";
import { ProgressBar } from "./ProgressBar";

export function BossHPBar({ hp, maxHp, hearts }: { hp: number; maxHp: number; hearts: number }) {
  return (
    <View className="gap-3 rounded-2xl border border-boss/40 bg-panel p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-boss">💀 Boss HP</Text>
        <Text className="text-sm font-semibold text-muted">{hp} / {maxHp} hits left</Text>
      </View>
      <ProgressBar pct={(100 * hp) / maxHp} color={colors.boss} label={`Boss health ${hp} of ${maxHp}`} height={14} />
      <View
        className="flex-row items-center gap-2"
        accessible
        accessibilityLabel={`You have ${hearts} of ${BOSS_HEARTS} hearts`}>
        <Text className="text-sm font-semibold text-muted">Your hearts</Text>
        {Array.from({ length: BOSS_HEARTS }).map((_, i) => (
          <Text key={i} className="text-xl" style={{ opacity: i < hearts ? 1 : 0.25 }}>
            {i < hearts ? "❤️" : "🖤"}
          </Text>
        ))}
      </View>
    </View>
  );
}
