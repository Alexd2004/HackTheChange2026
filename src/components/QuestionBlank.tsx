// Fill-in-the-blank question: one text box. Submit with the keyboard's "done" or the Check button.
import { Text, TextInput, View } from "react-native";
import { colors } from "@/lib/theme";

export function QuestionBlank({
  value, revealed, onChange, onSubmit,
}: { value: string; revealed: boolean; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-muted" nativeID="blank-label">Your answer for ____</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        editable={!revealed}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        placeholder="Type the missing word"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Your answer for the blank"
        accessibilityLabelledBy="blank-label"
        className="min-h-[56px] rounded-2xl border-2 border-line bg-panel px-4 text-lg text-fg"
      />
    </View>
  );
}
