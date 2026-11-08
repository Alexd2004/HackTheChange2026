// Quiz screen for one level. Modes:
//   normal    hints + resources allowed, pass at 60%
//   challenge 20 s per question (40 s with "Longer timers"), no resources, 2× XP, pass at 60%
//   boss      monkey vs boss scene, 3 HP each, same countdown as challenge; a right answer hits the
//             boss, a wrong one (or running out of time) hits you
import { BattleScene } from "@/components/BattleScene";
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
import { newRunId, recordResourceOpen } from "@/lib/analytics";
import {
  completeLevel,
  generateLevelWithRetry,
  getLevelBundle,
  getPlanBundle,
  getPlanMatchPct,
  isPreparing,
  prefetchNextLevel,
  prepareNextStage,
  recordAttempt,
} from "@/lib/api";
import { levelTitle } from "@/lib/bosses";
import {
  ADMIN_BYPASS,
  BOSS_HEARTS,
  BOSS_HP,
  PASS_PCT,
  challengeSeconds,
  correctAnswerText,
  hintFor,
  isCorrect,
  scorePct,
  xpFor,
} from "@/lib/grading";
import { useSettings } from "@/lib/settings";
import { pixelColors as c } from "@/lib/theme";
import type {
  CompleteLevelResultV2,
  LevelBundle,
  LevelType,
  Question,
} from "@/lib/types";
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

type Phase = "loading" | "generating" | "error" | "playing";

/** A finished run waiting to be saved: kept so "Retry" after a failed save re-sends just this. */
interface PendingResult {
  levelId: string;
  planId: string;
  type: LevelType;
  score: number; // shown on the result screen
  savedScore: number; // sent to the server (at least the pass mark with the admin bypass)
  correct: number;
  total: number; // questions scored against (a boss win: the ones answered)
  xp: number;
  passed: boolean;
  bypassed: boolean;
  bossLost: boolean;
  before: number | null; // Job Match % when the level opened
}

/** The answer as text for analytics: the chosen option for multiple choice, "" when timed out. */
function answerText(q: Question, answer: number | string | null): string {
  if (answer === null) return "";
  if (typeof answer === "number") return q.options?.[answer] ?? String(answer);
  return answer;
}

/** Loads a level, generating its questions first if this is the first time it's opened. */
async function loadLevel(
  id: string,
  onGenerating: () => void,
): Promise<LevelBundle> {
  let b = await getLevelBundle(id);
  if (!b.level.generated || b.questions.length === 0) {
    onGenerating();
    await generateLevelWithRetry(id); // shares the request if the background runner is already writing it
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
  // Boss fight: one event per answer, played by BattleScene (who attacks, who takes the hit).
  const [hit, setHit] = useState<{ id: number; monkeyWins: boolean } | null>(
    null,
  );
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
  // Set once the player taps the last "Next": blocks a double tap from saving the level twice.
  const finishingRef = useRef(false);
  // Saving a win keeps the level on screen: the final button turns into a disabled "Saving…".
  const [saving, setSaving] = useState(false);
  // The finished run while it's being saved; "Retry" after a failed save re-sends it.
  const pendingRef = useRef<PendingResult | null>(null);
  // Job Match % when the level opened (the result screen's "before"), read once at load.
  const beforeRef = useRef<number | null>(null);

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
          setHp(BOSS_HP);
          setHit(null);
          setTimeLeft(challengeSeconds(extendedTime));
          runIdRef.current = newRunId();
          questionStartRef.current = Date.now();
          finishingRef.current = false;
          pendingRef.current = null;
          setPhase("playing");
          // Boss fight started: design the next stage now (it unlocks when this boss is beaten).
          if (b.level.type === "boss") prepareNextStage(b.plan_id, b.stage.idx);
          // Prefetch the next level's questions in the background (this is what writes a boss while
          // the level before it is played), and remember the Job Match % for the result screen.
          // While the background runner is preparing it already covers the next level: just read the %.
          beforeRef.current = null;
          if (isPreparing(b.plan_id)) {
            getPlanMatchPct(b.plan_id).then((m) => {
              beforeRef.current = m;
            });
          } else {
            getPlanBundle(b.plan_id)
              .then((pb) => {
                beforeRef.current = pb.plan.match_pct;
                prefetchNextLevel(pb, id);
              })
              .catch(() => {});
          }
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
    // A failed save: re-send the finished run instead of restarting the quiz.
    const pending = pendingRef.current;
    if (pending) {
      saveAndShow(pending);
      return;
    }
    setPhase("loading");
    fetchLevel();
  };

  const type = bundle?.level.type ?? "normal";
  const questions = bundle?.questions ?? [];
  const q = questions[qIndex];
  const total = questions.length;
  const isBoss = type === "boss";
  const isChallenge = type === "challenge";
  const isTimed = isChallenge || isBoss; // boss fights run on the same per-question countdown

  // ---- answer
  const submit = useCallback(
    (answer: number | string | null) => {
      if (!q || revealed) return;
      const ok = isCorrect(q, answer);
      setLastCorrect(ok);
      setRevealed(true);
      recordAttempt(q.id, ok, {
        runId: runIdRef.current,
        timeMs: Date.now() - questionStartRef.current,
        answer: answerText(q, answer),
      });
      if (isBoss) setHit((h) => ({ id: (h?.id ?? 0) + 1, monkeyWins: ok }));
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
    if (!isTimed || phase !== "playing" || revealed || !q) return;
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
  }, [isTimed, phase, revealed, qIndex, q, extendedTime]);

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

  function finish() {
    if (!bundle || finishingRef.current) return;
    finishingRef.current = true;
    const bossWon = isBoss && hp === 0;
    // A boss fight ends as soon as its HP hits 0, so a win is scored on the questions actually
    // answered (a flawless win = 100%). A win always means at least 60% of them were hits.
    const scoredTotal = bossWon ? Math.min(total, qIndex + 1) : total;
    const score = bossWon
      ? Math.max(PASS_PCT, scorePct(correctCount, scoredTotal))
      : scorePct(correctCount, total);
    const earnedPass = isBoss ? bossWon : score >= PASS_PCT;
    // Admin bypass (EXPO_PUBLIC_ADMIN_BYPASS=1): pass anyway; the server needs at least the pass mark.
    const bypassed = ADMIN_BYPASS && !earnedPass;
    const passed = earnedPass || bypassed;
    const pending: PendingResult = {
      levelId: bundle.level.id,
      planId: bundle.plan_id,
      type,
      score,
      savedScore: bypassed ? Math.max(score, PASS_PCT) : score,
      correct: correctCount,
      total: scoredTotal,
      xp: xpFor(correctCount, type),
      passed,
      bypassed,
      bossLost: isBoss && !passed,
      before: beforeRef.current,
    };
    pendingRef.current = pending;
    saveAndShow(pending);
  }

  /** Saves a passed run (if any), then opens the result screen. On failure the run stays pending. */
  async function saveAndShow(r: PendingResult) {
    let after: CompleteLevelResultV2 | null = null;
    if (r.passed) {
      setSaving(true);
      setPhase("playing"); // a Retry from the error screen comes back to the finished level
      try {
        after = await completeLevel(r.levelId, r.savedScore, r.xp);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't save your progress.",
        );
        setSaving(false);
        setPhase("error"); // Retry calls saveAndShow(pendingRef.current) again
        return;
      }
    }
    pendingRef.current = null;
    router.replace({
      pathname: "/result/[id]",
      params: {
        id: r.levelId,
        planId: r.planId,
        type: r.type,
        score: String(r.score),
        correct: String(r.correct),
        total: String(r.total),
        // Server decides the XP (0 when replaying without beating your best score).
        xp: String(r.passed ? (after?.xp_awarded ?? r.xp) : 0),
        passed: r.passed ? "1" : "0",
        before: String(r.before ?? after?.match_pct ?? 0),
        after: String(after?.match_pct ?? r.before ?? 0),
        bossLost: r.bossLost ? "1" : "0",
        bypass: r.bypassed ? "1" : "0",
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
  if (!bundle || !q)
    return (
      <Screen>
        <LoadingState message="Loading level…" />
      </Screen>
    );

  const canAnswer =
    q.kind === "mcq" ? selected !== null : typed.trim().length > 0;
  const lowTime = timeLeft <= 5;

  const timerTiles = Math.ceil(
    (10 * Math.max(0, timeLeft)) / challengeSeconds(extendedTime),
  );
  const timedOut = isTimed && timeLeft <= 0 && selected === null && !typed;
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
        behavior="padding" // Android is edge-to-edge: the window no longer resizes for the keyboard
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow pb-8"
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full max-w-[480px] self-center px-4">
            {/* Top bar: close button, then the level title beside it */}
            <View className="flex-row items-center gap-3 pt-3">
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
              <Text
                className="flex-1 text-center"
                style={outlined(34, c.gold)}
                accessibilityRole="header"
              >
                {levelTitle(bundle.level, bundle.stage.idx)}
              </Text>
              {/* Only challenges show a tag (2× XP); otherwise balance the close button so the title sits truly centered. */}
              {isChallenge && !isBoss ? (
                <PixelTag label="2× XP" icon="lightning-bolt" />
              ) : (
                <View className="w-11" />
              )}
            </View>

            <Text className="mt-2 text-center" style={outlined(24)}>
              Question {qIndex + 1} of {total} · {bundle.skill.name}
            </Text>
            {/* Timed levels show only the countdown bar, not question progress. */}
            {!isTimed && (
              <View className="mt-3">
                <TileBar
                  filled={qIndex + (revealed ? 1 : 0)}
                  total={total}
                  height={10}
                  label={`Question ${qIndex + 1} of ${total}`}
                />
              </View>
            )}

            {isBoss && (
              <View className="mt-4">
                <BattleScene
                  bossNum={(bundle.stage.idx % 3) + 1}
                  bossHp={hp}
                  monkeyHp={hearts}
                  maxHp={BOSS_HP}
                  hit={hit}
                />
              </View>
            )}

            {isTimed && !revealed && (
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
                  disabled={saving}
                  label={
                    saving
                      ? "Saving…"
                      : bossOver
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
          onOpened={(r, durationMs) =>
            recordResourceOpen({
              resource_id: r.id,
              level_id: bundle.level.id,
              question_id: q.id,
              run_id: runIdRef.current,
              duration_ms: durationMs,
            })
          }
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
