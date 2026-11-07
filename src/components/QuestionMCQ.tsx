// Multiple-choice question: 4 signboard-style option buttons. After answering, the right option
// gets a check and a picked wrong option gets a cross (icon + text, not color alone).
import { Pressable, Text, View } from "react-native";
import { pixelColors as c } from "@/lib/theme";
import type { Question } from "@/lib/types";
import { Icon, font, type IconName } from "./pixel";

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
        if (i === hiddenOption) return null; // removed by the hint: never the right answer, never pickable
        const isRight = i === question.correct_index;
        const isPicked = i === selected;
        let bg: string = c.cream;
        let border: string = c.wood;
        let mark: { text: string; icon: IconName; color: string } | null = null;
        if (revealed && isRight) {
          bg = "#E6F2D9"; border = c.grassDark;
          mark = { text: "Correct answer", icon: "check-bold", color: c.grassDark };
        } else if (revealed && isPicked) {
          border = c.red;
          mark = { text: "Your answer", icon: "close-thick", color: c.red };
        } else if (isPicked) {
          bg = c.gold; border = c.outline;
        }

        return (
          <Pressable
            key={i}
            onPress={() => onSelect(i)}
            disabled={revealed}
            accessibilityRole="radio"
            accessibilityState={{ checked: isPicked, disabled: revealed }}
            accessibilityLabel={`Option ${LETTERS[i]}: ${opt}${mark ? `. ${mark.text}` : ""}`}
            className="min-h-[56px] flex-row items-center gap-3 px-3 py-2 active:opacity-80"
            style={{
              backgroundColor: bg,
              borderWidth: 3,
              borderColor: border,
              boxShadow: isPicked && !revealed ? `3px 3px 0 ${c.outline}` : "none",
            }}>
            <View
              className="h-9 w-14 items-center justify-center"
              style={{
                backgroundColor: mark ? mark.color : isPicked ? c.outline : c.wood,
                borderWidth: 3,
                borderColor: c.outline,
              }}>
              {mark ? (
                <Icon name={mark.icon} size={22} color={c.cream} />
              ) : (
                <Text style={font(20, c.cream)}>{LETTERS[i]}</Text>
              )}
            </View>
            <View className="flex-1">
              <Text style={font(18, c.outline)}>{opt}</Text>
              {mark && <Text style={font(16, mark.color)}>{mark.text}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
