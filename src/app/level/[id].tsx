// Quiz screen for one level. Modes:
//   normal    hints + resources allowed, pass at 60%
//   challenge 20 s per question (40 s with "Longer timers"), no resources, 2× XP, pass at 60%
//   boss      boss HP bar + 3 hearts; win by landing enough hits before your hearts run out
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import {
  completeLevel, ensureLevelGenerated, getLevelBundle, getPlanBundle, prefetchNextLevel, recordAttempt,
} from "@/lib/api";
import {
  BOSS_HEARTS, PASS_PCT, bossMaxHp, challengeSeconds, correctAnswerText, hintFor, isCorrect, scorePct, xpFor,
} from "@/lib/grading";
import { useSettings } from "@/lib/settings";
import { colors, levelColor, levelTypeLabel } from "@/lib/theme";
import type { LevelBundle } from "@/lib/types";
import { BossHPBar } from "@/components/BossHPBar";
import { ProgressBar } from "@/components/ProgressBar";
import { QuestionBlank } from "@/components/QuestionBlank";
import { QuestionMCQ } from "@/components/QuestionMCQ";
import { ResourceSheet } from "@/components/ResourceSheet";
import { Button, ErrorState, LoadingState, Screen, Tag } from "@/components/ui";

type Phase = "loading" | "generating" | "error" | "playing" | "saving";

/** Loads a level, generating its questions first if this is the first time it's opened. */
async function loadLevel(id: string, onGenerating: () => void): Promise<LevelBundle> {
  let b = await getLevelBundle(id);
  if (!b.level.generated || b.questions.length === 0) {
    onGenerating();
    await ensureLevelGenerated(id);
    b = await getLevelBundle(id);
  }
  if (b.questions.length === 0) throw new Error("This level has no questions yet. Please try again.");
  return b;
}

const haptic = (kind: "good" | "bad") => {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(
    kind === "good" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
};

export default function LevelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { motionOff, extendedTime } = useSettings();

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
  const [hint, setHint] = useState<{ text: string; hiddenOption: number | null } | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showResources, setShowResources] = useState(false);

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  // ---- load (+ generate questions if this level is new)
  const fetchLevel = useCallback(
    () =>
      loadLevel(id, () => setPhase("generating")).then(
        (b) => {
          setBundle(b);
          setQIndex(0); setSelected(null); setTyped(""); setRevealed(false); setHint(null);
          setCorrectCount(0); setHearts(BOSS_HEARTS); setHp(bossMaxHp(b.questions.length));
          setTimeLeft(challengeSeconds(extendedTime));
          setPhase("playing");
          // Prefetch the next level's questions in the background.
          getPlanBundle(b.plan_id).then((pb) => prefetchNextLevel(pb, id)).catch(() => {});
        },
        (e) => {
          setError(e instanceof Error ? e.message : "Couldn't load this level.");
          setPhase("error");
        },
      ),
    [id, extendedTime],
  );

  // First load runs once per level; retry resets the screen first.
  useEffect(() => { fetchLevel(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = () => { setError(null); setPhase("loading"); fetchLevel(); };

  const type = bundle?.level.type ?? "normal";
  const questions = bundle?.questions ?? [];
  const q = questions[qIndex];
  const total = questions.length;
  const isBoss = type === "boss";
  const isChallenge = type === "challenge";
  const accent = levelColor(type);

  // ---- answer
  const submit = useCallback((answer: number | string | null) => {
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
        shake.set(withSequence(
          withTiming(-10, { duration: 50 }), withTiming(10, { duration: 50 }),
          withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 }),
        ));
      }
    }
  }, [q, revealed, isBoss, motionOff, shake]);

  // ---- challenge timer: counts down each question; at 0 the question counts as wrong.
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; }, [submit]);
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
    setSelected(null); setTyped(""); setRevealed(false); setHint(null);
    setTimeLeft(challengeSeconds(extendedTime));
  }

  async function finish() {
    if (!bundle) return;
    const score = scorePct(correctCount, total);
    const passed = isBoss ? hp === 0 : score >= PASS_PCT;
    const xp = xpFor(correctCount, type);
    let after = null as null | { match_pct: number; next_level_id: string | null };
    const before = await getPlanBundle(bundle.plan_id).then((p) => p.plan.match_pct).catch(() => null);
    if (passed) {
      setPhase("saving");
      try {
        after = await completeLevel(bundle.level.id, score, xp);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your progress.");
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
        xp: String(passed ? xp : 0),
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
    return <Screen><ErrorState message={error ?? "Something went wrong."} onRetry={retry} onBack={() => router.back()} /></Screen>;
  }
  if (phase === "loading") return <Screen><LoadingState message="Loading level…" /></Screen>;
  if (phase === "generating") return <Screen><LoadingState message="Writing your questions… (about 10 seconds)" /></Screen>;
  if (phase === "saving" || !bundle || !q) return <Screen><LoadingState message="Saving your progress…" /></Screen>;

  const canAnswer = q.kind === "mcq" ? selected !== null : typed.trim().length > 0;
  const timerPct = (100 * Math.max(0, timeLeft)) / challengeSeconds(extendedTime);
  const lowTime = timeLeft <= 5;

  return (
    <KeyboardAvoidingView className="flex-1 bg-ink" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        {/* Top bar */}
        <View className="flex-row items-center justify-between pt-4">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Quit level and go back to the map"
            hitSlop={8}
            className="min-h-[44px] min-w-[44px] justify-center">
            <Text className="text-2xl text-fg">✕</Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            <Tag label={levelTypeLabel[type]} color={accent} />
            {isChallenge && <Tag label="2× XP" color={colors.challenge} />}
            {isBoss && <Tag label="3× XP" color={colors.boss} />}
          </View>
        </View>

        <Text className="mt-2 text-xl font-extrabold text-fg" accessibilityRole="header">{bundle.level.title}</Text>
        <Text className="mt-1 text-sm text-muted">Question {qIndex + 1} of {total} · {bundle.skill.name}</Text>
        <View className="mt-3">
          <ProgressBar pct={(100 * (qIndex + (revealed ? 1 : 0))) / total} color={accent} label={`Question ${qIndex + 1} of ${total}`} height={8} />
        </View>

        {isBoss && <View className="mt-4"><BossHPBar hp={hp} maxHp={bossMaxHp(total)} hearts={hearts} /></View>}

        {isChallenge && !revealed && (
          <View className="mt-4 gap-2" accessibilityLiveRegion={lowTime ? "assertive" : "none"}>
            <View className="flex-row justify-between">
              <Text className="text-sm font-semibold text-muted">⏱ Time left</Text>
              <Text className={`text-sm font-extrabold ${lowTime ? "text-bad" : "text-challenge"}`}>{Math.max(0, timeLeft)}s</Text>
            </View>
            <ProgressBar pct={timerPct} color={lowTime ? colors.bad : colors.challenge} label={`${Math.max(0, timeLeft)} seconds left`} height={6} />
          </View>
        )}

        {/* Question */}
        <Animated.View style={shakeStyle}>
          <View className="mt-5 gap-5">
          <Text className="text-xl font-semibold leading-8 text-fg" accessibilityRole="text">{q.prompt}</Text>

          {q.kind === "mcq" ? (
            <QuestionMCQ question={q} selected={selected} revealed={revealed} hiddenOption={hint?.hiddenOption ?? null} onSelect={setSelected} />
          ) : (
            <QuestionBlank value={typed} revealed={revealed} onChange={setTyped} onSubmit={() => canAnswer && submit(typed)} />
          )}
          </View>
        </Animated.View>

        {/* Hint + resources (normal only) */}
        {type === "normal" && !revealed && (
          <View className="mt-4 flex-row gap-3">
            <View className="flex-1">
              <Button label={hint ? "Hint used" : "💡 Hint"} variant="secondary" disabled={!!hint} onPress={() => setHint(hintFor(q))} />
            </View>
            <View className="flex-1">
              <Button label="📚 Resources" hint={`${bundle.resources.length} links for this level`} variant="secondary" onPress={() => setShowResources(true)} />
            </View>
          </View>
        )}
        {hint && !revealed && <Text className="mt-3 text-sm leading-5 text-normal">💡 {hint.text}</Text>}

        {/* Feedback */}
        {revealed && (
          <View
            className={`mt-5 gap-2 rounded-2xl border-2 p-4 ${lastCorrect ? "border-good bg-good/10" : "border-bad bg-bad/10"}`}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive">
            <Text className={`text-lg font-extrabold ${lastCorrect ? "text-good" : "text-bad"}`}>
              {lastCorrect ? "✓ Correct!" : isChallenge && timeLeft <= 0 && selected === null && !typed ? "⏱ Time's up" : "✗ Not quite"}
            </Text>
            {!lastCorrect && (
              <Text className="text-base text-fg">
                Answer: <Text className="font-bold">{correctAnswerText(q)}</Text>
              </Text>
            )}
            {q.explanation ? <Text className="text-base leading-6 text-muted">{q.explanation}</Text> : null}
            {isBoss && lastCorrect && <Text className="text-sm font-bold text-boss">💥 You hit the boss!</Text>}
            {isBoss && !lastCorrect && <Text className="text-sm font-bold text-bad">💔 You lost a heart</Text>}
          </View>
        )}

        {/* Main action */}
        <View className="mt-5">
          {revealed ? (
            <Button
              label={bossOver ? (hp === 0 ? "Finish the boss" : "See results") : isLast ? "See results" : "Next question"}
              onPress={next}
              color={isBoss ? colors.boss : undefined}
            />
          ) : (
            <Button label="Check answer" disabled={!canAnswer} onPress={() => submit(q.kind === "mcq" ? selected : typed)} />
          )}
        </View>

        <ResourceSheet visible={showResources} resources={bundle.resources} onClose={() => setShowResources(false)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
