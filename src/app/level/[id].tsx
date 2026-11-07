// Quiz screen for one level. Modes:
//   normal    hints + resources allowed, pass at 60%
//   challenge 20 s per question (40 s with "Longer timers"), no resources, 2× XP, pass at 60%
//   boss      boss HP bar + 3 hearts; win by landing enough hits before your hearts run out
import { BossHPBar } from "@/components/BossHPBar";
import {
  Icon,
  PixelBackground,
  PixelButton,
  TileBar,
  field,
  font,
  outlined,
  panel,
  type IconName,
} from "@/components/pixel";
import { QuestionBlank } from "@/components/QuestionBlank";
import { QuestionMCQ } from "@/components/QuestionMCQ";
import { ResourceSheet } from "@/components/ResourceSheet";
import { ErrorState, LoadingState, Screen } from "@/components/ui";
import { newRunId } from "@/lib/analytics";
import {
  completeLevel,
  ensureLevelGenerated,
  getLevelBundle,
  getPlanBundle,
  prefetchNextLevel,
  recordAttempt,
} from "@/lib/api";
import {
  BOSS_HEARTS,
  PASS_PCT,
  bossMaxHp,
  challengeSeconds,
  correctAnswerText,
  hintFor,
  isCorrect,
  scorePct,
  xpFor,
} from "@/lib/grading";
import { useSettings } from "@/lib/settings";
import { pixelColors as c, levelTypeLabel } from "@/lib/theme";
import type { LevelBundle } from "@/lib/types";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

type Phase = "loading" | "generating" | "error" | "playing" | "saving";

/** Loads a level, generating its questions first if this is the first time it's opened. */
async function loadLevel(
  id: string,
  onGenerating: () => void,
): Promise<LevelBundle> {
  let b = await getLevelBundle(id);
  if (!b.level.generated || b.questions.length === 0) {
    onGenerating();
    await ensureLevelGenerated(id);
    b = await getLevelBundle(id);
  }
  if (b.questions.length === 0)
    throw new Error("This level has no questions yet. Please try again.");
  return b;
}

/** Stores the current time in a ref (outside the component so it isn't treated as render code). */
function markNow(ref: { current: number }) {
  ref.current = Date.now();
}

const haptic = (kind: "good" | "bad") => {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(
    kind === "good"
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
};

export default function LevelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { motionOff, extendedTime } = useSettings();
  const [fontLoaded] = useFonts({ Jersey25_400Regular });

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<LevelBundle | null>(null);

  // Game state
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [lastCorrect, setLastCorrect] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [hearts, setHearts] = useState(BOSS_HEARTS);
  const [hp, setHp] = useState(1);
  const [hint, setHint] = useState<{
    text: string;
    hiddenOption: number | null;
  } | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showResources, setShowResources] = useState(false);

  // Analytics: one run id per play of this level; when the current question appeared.
  // (Both are set when the level finishes loading, before any question is shown.)
  const runIdRef = useRef("");
  const questionStartRef = useRef(0);

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  // ---- load (+ generate questions if this level is new)
  const fetchLevel = useCallback(
    () =>
      loadLevel(id, () => setPhase("generating")).then(
        (b) => {
          setBundle(b);
          setQIndex(0);
          setSelected(null);
          setTyped("");
          setRevealed(false);
          setHint(null);
          setCorrectCount(0);
          setHearts(BOSS_HEARTS);
          setHp(bossMaxHp(b.questions.length));
          setTimeLeft(challengeSeconds(extendedTime));
          runIdRef.current = newRunId();
          questionStartRef.current = Date.now();
          setPhase("playing");
          // Prefetch the next level's questions in the background.
          getPlanBundle(b.plan_id)
            .then((pb) => prefetchNextLevel(pb, id))
            .catch(() => {});
        },
        (e) => {
          setError(
            e instanceof Error ? e.message : "Couldn't load this level.",
          );
          setPhase("error");
        },
      ),
    [id, extendedTime],
  );

  // First load runs once per level; retry resets the screen first.
  useEffect(() => {
    fetchLevel();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = () => {
    setError(null);
    setPhase("loading");
    fetchLevel();
  };

  const type = bundle?.level.type ?? "normal";
  const questions = bundle?.questions ?? [];
  const q = questions[qIndex];
  const total = questions.length;
  const isBoss = type === "boss";
  const isChallenge = type === "challenge";

  // ---- answer
  const submit = useCallback(
    (answer: number | string | null) => {
      if (!q || revealed) return;
      const ok = isCorrect(q, answer);
      setLastCorrect(ok);
      setRevealed(true);
      recordAttempt(q.id, ok);
      if (ok) {
        setCorrectCount((c) => c + 1);
        if (isBoss) setHp((h) => Math.max(0, h - 1));
        haptic("good");
      } else {
        if (isBoss) setHearts((h) => Math.max(0, h - 1));
        haptic("bad");
        if (!motionOff) {
          shake.set(
            withSequence(
              withTiming(-10, { duration: 50 }),
              withTiming(10, { duration: 50 }),
              withTiming(-6, { duration: 50 }),
              withTiming(0, { duration: 50 }),
            ),
          );
        }
      }
    },
    [q, revealed, isBoss, motionOff, shake],
  );

  // ---- challenge timer: counts down each question; at 0 the question counts as wrong.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  useEffect(() => {
    if (!isChallenge || phase !== "playing" || revealed || !q) return;
    let left = challengeSeconds(extendedTime); // timeLeft was reset when this question started
    const t = setInterval(() => {
      left -= 1;
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(t);
        submitRef.current(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isChallenge, phase, revealed, qIndex, q, extendedTime]);

  // ---- next / finish
  const bossOver = isBoss && (hp === 0 || hearts === 0);
  const isLast = qIndex >= total - 1;

  async function next() {
    if (bossOver || isLast) return finish();
    setQIndex((i) => i + 1);
    setSelected(null);
    setTyped("");
    setRevealed(false);
    setHint(null);
    setTimeLeft(challengeSeconds(extendedTime));
    markNow(questionStartRef);
  }

  async function finish() {
    if (!bundle) return;
    const score = scorePct(correctCount, total);
    const passed = isBoss ? hp === 0 : score >= PASS_PCT;
    const xp = xpFor(correctCount, type);
    let after = null as null | {
      match_pct: number;
      next_level_id: string | null;
    };
    const before = await getPlanBundle(bundle.plan_id)
      .then((p) => p.plan.match_pct)
      .catch(() => null);
    if (passed) {
      setPhase("saving");
      try {
        after = await completeLevel(bundle.level.id, score, xp);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't save your progress.",
        );
        setPhase("error");
        return;
      }
    }
    router.replace({
      pathname: "/result/[id]",
      params: {
        id: bundle.level.id,
        planId: bundle.plan_id,
        type,
        score: String(score),
        correct: String(correctCount),
        total: String(total),
        // Server decides the XP (0 when replaying without beating your best score).
        xp: String(passed ? (after?.xp_awarded ?? xp) : 0),
        passed: passed ? "1" : "0",
        before: String(before ?? after?.match_pct ?? 0),
        after: String(after?.match_pct ?? before ?? 0),
        next: after?.next_level_id ?? "",
        bossLost: isBoss && !passed ? "1" : "0",
      },
    });
  }

  // ---- render states
  if (phase === "error") {
    return (
      <Screen>
        <ErrorState
          message={error ?? "Something went wrong."}
          onRetry={retry}
          onBack={() => router.back()}
        />
      </Screen>
    );
  }
  if (phase === "loading")
    return (
      <Screen>
        <LoadingState message="Loading level…" />
      </Screen>
    );
  if (phase === "generating")
    return (
      <Screen>
        <LoadingState message="Writing your questions… (about 10 seconds)" />
      </Screen>
    );
  if (phase === "saving" || !bundle || !q)
    return (
      <Screen>
        <LoadingState message="Saving your progress…" />
      </Screen>
    );

  const canAnswer =
    q.kind === "mcq" ? selected !== null : typed.trim().length > 0;
  const lowTime = timeLeft <= 5;

  const timerTiles = Math.ceil(
    (10 * Math.max(0, timeLeft)) / challengeSeconds(extendedTime),
  );
  const timedOut = isChallenge && timeLeft <= 0 && selected === null && !typed;
  const verdict = lastCorrect
    ? { text: "Correct!", icon: "check-circle" as const, color: c.grassDark }
    : timedOut
      ? { text: "Time's up", icon: "timer-off-outline" as const, color: c.red }
      : { text: "Not quite", icon: "close-circle" as const, color: c.red };

  if (!fontLoaded) return <PixelBackground>{null}</PixelBackground>;

  return (
    <PixelBackground>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow pb-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full max-w-[480px] self-center px-4">
            {/* Top bar */}
            <View className="flex-row items-center justify-between pt-3">
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Quit level and go back to the map"
                hitSlop={8}
                className="h-11 w-11 items-center justify-center active:opacity-70"
                style={{
                  backgroundColor: c.cream,
                  borderWidth: 3,
                  borderColor: c.wood,
                }}
              >
                <Icon name="close-thick" size={24} />
              </Pressable>
              <View className="flex-row items-center gap-2">
                <PixelTag label={levelTypeLabel[type]} />
                {isChallenge && (
                  <PixelTag label="2× XP" icon="lightning-bolt" />
                )}
                {isBoss && <PixelTag label="3× XP" icon="skull" />}
              </View>
            </View>

            <Text
              className="mt-3"
              style={outlined(34, c.gold)}
              accessibilityRole="header"
            >
              {bundle.level.title}
            </Text>
            <Text style={outlined(24)}>
              Question {qIndex + 1} of {total} · {bundle.skill.name}
            </Text>
            <View className="mt-3">
              <TileBar
                filled={qIndex + (revealed ? 1 : 0)}
                total={total}
                height={10}
                label={`Question ${qIndex + 1} of ${total}`}
              />
            </View>

            {isBoss && (
              <View className="mt-4">
                <BossHPBar hp={hp} maxHp={bossMaxHp(total)} hearts={hearts} />
              </View>
            )}

            {isChallenge && !revealed && (
              <View
                className="mt-4 gap-1"
                accessibilityLiveRegion={lowTime ? "assertive" : "none"}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1">
                    <Icon name="timer-outline" size={24} color={c.cream} />
                    <Text style={outlined(24)}>Time left</Text>
                  </View>
                  <Text style={outlined(28, lowTime ? "#FF8A7A" : c.gold)}>
                    {Math.max(0, timeLeft)}s
                  </Text>
                </View>
                <TileBar
                  filled={timerTiles}
                  total={10}
                  color={lowTime ? c.red : c.gold}
                  height={12}
                  label={`${Math.max(0, timeLeft)} seconds left`}
                />
              </View>
            )}

            {/* Question */}
            <Animated.View style={shakeStyle}>
              <View className="mt-5 gap-4 p-4" style={panel}>
                <Text style={font(22, c.outline)} accessibilityRole="text">
                  {q.prompt}
                </Text>
                {q.kind === "mcq" ? (
                  <QuestionMCQ
                    question={q}
                    selected={selected}
                    revealed={revealed}
                    hiddenOption={hint?.hiddenOption ?? null}
                    onSelect={setSelected}
                  />
                ) : (
                  <QuestionBlank
                    value={typed}
                    revealed={revealed}
                    onChange={setTyped}
                    onSubmit={() => canAnswer && submit(typed)}
                  />
                )}
              </View>
            </Animated.View>

            {/* Hint + resources (normal only) */}
            {type === "normal" && !revealed && (
              <View className="mt-5 flex-row gap-3">
                <View className="flex-1">
                  <PixelButton
                    label={hint ? "Hint used" : "Hint"}
                    icon="lightbulb-on-outline"
                    variant="secondary"
                    disabled={!!hint}
                    onPress={() => setHint(hintFor(q))}
                  />
                </View>
                <View className="flex-1">
                  <PixelButton
                    label="Resources"
                    icon="book-open-variant"
                    hint={`${bundle.resources.length} links for this level`}
                    variant="secondary"
                    onPress={() => setShowResources(true)}
                  />
                </View>
              </View>
            )}
            {hint && !revealed && (
              <View
                className="mt-3 flex-row gap-2 p-3"
                style={{ ...field, borderWidth: 3 }}
              >
                <Icon name="lightbulb-on-outline" size={22} />
                <Text className="flex-1" style={font(20)}>
                  {hint.text}
                </Text>
              </View>
            )}

            {/* Feedback */}
            {revealed && (
              <View
                className="mt-5 gap-2 p-4"
                style={{ ...panel, borderColor: verdict.color }}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                <View className="flex-row items-center gap-2">
                  <Icon name={verdict.icon} size={24} color={verdict.color} />
                  <Text style={font(26, verdict.color)}>{verdict.text}</Text>
                </View>
                {!lastCorrect && (
                  <Text style={font(20, c.outline)}>
                    Answer: {correctAnswerText(q)}
                  </Text>
                )}
                {q.explanation ? (
                  <Text style={font(18)}>{q.explanation}</Text>
                ) : null}
                {isBoss && (
                  <View className="flex-row items-center gap-2">
                    <Icon
                      name={lastCorrect ? "sword" : "heart-broken"}
                      size={20}
                      color={c.red}
                    />
                    <Text style={font(18, c.red)}>
                      {lastCorrect ? "You hit the boss!" : "You lost a heart"}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Main action */}
            <View className="mt-6">
              {revealed ? (
                <PixelButton
                  label={
                    bossOver
                      ? hp === 0
                        ? "Finish the boss"
                        : "See results"
                      : isLast
                        ? "See results"
                        : "Next question"
                  }
                  onPress={next}
                  variant={isBoss ? "danger" : "primary"}
                />
              ) : (
                <PixelButton
                  label="Check answer"
                  disabled={!canAnswer}
                  onPress={() => submit(q.kind === "mcq" ? selected : typed)}
                />
              )}
            </View>
          </View>
        </ScrollView>
        <ResourceSheet
          visible={showResources}
          resources={bundle.resources}
          onClose={() => setShowResources(false)}
        />
      </KeyboardAvoidingView>
    </PixelBackground>
  );
}

function PixelTag({ label, icon }: { label: string; icon?: IconName }) {
  return (
    <View
      className="flex-row items-center gap-1 px-2 py-0.5"
      style={{
        backgroundColor: c.wood,
        borderWidth: 2,
        borderColor: c.outline,
      }}
    >
      {icon && <Icon name={icon} size={16} color={c.gold} />}
      <Text style={font(18, c.cream)}>{label}</Text>
    </View>
  );
}
