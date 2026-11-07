// Fill-in-the-blank question: one text box. Submit with the keyboard's "done" or the Check button.
import { Text, TextInput, View } from "react-native";
import { pixelColors as c } from "@/lib/theme";
import { field, font } from "./pixel";

export function QuestionBlank({
  value, revealed, onChange, onSubmit,
}: { value: string; revealed: boolean; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <View className="gap-2">
      <Text style={font(18, c.wood)} nativeID="blank-label">Your answer for ____</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        editable={!revealed}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        placeholder="Type the missing word"
        placeholderTextColor={c.stoneDark}
        accessibilityLabel="Your answer for the blank"
        accessibilityLabelledBy="blank-label"
        className="min-h-[56px] px-3"
        style={{ ...field, borderWidth: 3, ...font(22, c.outline) }}
      />
    </View>
  );
}
