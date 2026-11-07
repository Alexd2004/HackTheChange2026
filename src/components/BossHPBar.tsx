// Boss fight header: boss HP tiles (each correct answer is a hit) and the player's hearts.
import { Text, View } from "react-native";
import { BOSS_HEARTS } from "@/lib/grading";
import { pixelColors as c } from "@/lib/theme";
import { Icon, TileBar, font, panel } from "./pixel";

export function BossHPBar({ hp, maxHp, hearts }: { hp: number; maxHp: number; hearts: number }) {
  return (
    <View className="gap-2 p-3" style={{ ...panel, borderColor: c.red }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Icon name="skull" size={24} color={c.red} />
          <Text style={font(24, c.red)}>Boss HP</Text>
        </View>
        <Text style={font(20)}>{hp} / {maxHp} hits left</Text>
      </View>
      <TileBar filled={hp} total={maxHp} color={c.red} height={14} label={`Boss health ${hp} of ${maxHp}`} />
      <View
        className="flex-row items-center gap-1"
        accessible
        accessibilityLabel={`You have ${hearts} of ${BOSS_HEARTS} hearts`}>
        <Text style={{ ...font(20), marginRight: 4 }}>Your hearts</Text>
        {Array.from({ length: BOSS_HEARTS }, (_, i) => (
          <Icon key={i} name={i < hearts ? "heart" : "heart-outline"} size={26} color={c.red} />
        ))}
      </View>
    </View>
  );
}
