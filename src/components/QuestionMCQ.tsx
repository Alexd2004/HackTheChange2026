// Multiple-choice question: 4 big option buttons. After answering, the right option
// gets a ✓ and a picked wrong option gets a ✗ (icon + text, not color alone).
import { Pressable, Text, View } from "react-native";
import type { Question } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D"];

export function QuestionMCQ({
  question, selected, revealed, hiddenOption, onSelect,
}: {
  question: Question;
  selected: number | null;
  revealed: boolean;
  hiddenOption: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <View className="gap-3" accessibilityRole="radiogroup">
      {(question.options ?? []).map((opt, i) => {
        if (i === hiddenOption && !revealed) return null;
        const isRight = i === question.correct_index;
        const isPicked = i === selected;
        let box = "bg-panel border-line";
        let mark = "";
        if (revealed && isRight) { box = "bg-good/15 border-good"; mark = "✓ Correct answer"; }
        else if (revealed && isPicked) { box = "bg-bad/15 border-bad"; mark = "✗ Your answer"; }
        else if (isPicked) box = "bg-raised border-brand";

        return (
          <Pressable
            key={i}
            onPress={() => onSelect(i)}
            disabled={revealed}
            accessibilityRole="radio"
            accessibilityState={{ checked: isPicked, disabled: revealed }}
            accessibilityLabel={`Option ${LETTERS[i]}: ${opt}${mark ? `. ${mark}` : ""}`}
            className={`min-h-[56px] flex-row items-center gap-3 rounded-2xl border-2 px-4 py-3 ${box}`}>
            <View className="h-8 w-8 items-center justify-center rounded-lg bg-raised">
              <Text className="font-bold text-muted">{LETTERS[i]}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base leading-6 text-fg">{opt}</Text>
              {mark ? (
                <Text className={`mt-1 text-sm font-bold ${isRight ? "text-good" : "text-bad"}`}>{mark}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
