// Upload screen: add a resume (PDF or pasted text) + paste a job posting → build the map.
// Also: continue an existing plan. Pixel theme shared with the landing.
import { Landing } from "@/components/Landing";
import {
  field,
  font,
  PixelBackground,
  Sprite,
  type Sheet,
} from "@/components/pixel";
import { PlanList } from "@/components/PlanList";
import { ProgressHeader } from "@/components/ProgressHeader";
import {
  AppError,
  listPlanSummaries,
  setPendingPlanInput,
  USE_MOCK,
} from "@/lib/api";
import { getProfile } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { pixelColors as c } from "@/lib/theme";
import type { PlanSummary } from "@/lib/types";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

let landingSeen = false; // module-level: show the landing once per app session, not on every return to "/"

type ResumeMode = "pdf" | "text";
interface PickedPdf {
  name: string;
  base64: string;
}

const MAX_PDF_BYTES = 5 * 1024 * 1024;

// 3 frames of 724×724 (peek, duck, hat only), paws on one baseline at y≈644. Crop trims empty space.
const peekSheet: Sheet = {
  src: require("../../assets/monkey peak.png"),
  w: 2172,
  h: 724,
};
const peekFrame = (i: number) => ({ x: i * 724 + 70, y: 100, w: 600, h: 560 });
const PEEK_W = 96;
// Sprite px above the panel's inner top edge: puts the panel border across the middle of the paws.
const PEEK_HANG = 80;

export default function UploadScreen() {
  const [fontLoaded] = useFonts({ Jersey25_400Regular });
  const [started, setStarted] = useState(landingSeen);
  const [fromLanding] = useState(!landingSeen); // fade the form in only right after the landing, not on every return to "/"
  const { motionOff } = useSettings();
  // Rows fade in one after another, top to bottom.
  const rowIn = (row: number) =>
    fromLanding && !motionOff
      ? FadeIn.duration(250).delay(row * 120)
      : undefined;
  const [mode, setMode] = useState<ResumeMode>("pdf");
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [posting, setPosting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  // While a text field is focused the keyboard eats the screen: show only that field, hide the footer, offer a Done button.
  const [focused, setFocused] = useState<"resume" | "posting" | null>(null);
  const typing = focused !== null;
  const focusProps = (f: "resume" | "posting") => ({
    onFocus: () => setFocused(f),
    onBlur: () => setFocused(null),
  });
  // Typing means the user has moved on, so drop any stale (e.g. clipboard) error.
  const typed = (set: (t: string) => void) => (t: string) => {
    setError(null);
    set(t);
  };

  // Peeking monkey on the form panel: frame index, or null once he has ducked away.
  const [peek, setPeek] = useState<number | null>(0);

  useFocusEffect(
    useCallback(() => {
      setPeek(0); // back on this screen: he's peeking again
      listPlanSummaries()
        .then(setPlans)
        .catch(() => setPlans([]));
      getProfile()
        .then((p) => setCurrentPlanId(p?.current_plan_id ?? null))
        .catch(() => {});
    }, []),
  );
  // "Continue" = the plan the user last opened (profile), else the newest one.
  const continuePlan = (plans.find((p) => p.plan.id === currentPlanId) ?? plans[0])?.plan;

  const resumeReady = mode === "pdf" ? !!pdf : resumeText.trim().length >= 100;
  const postingReady = posting.trim().length >= 80;
  const canBuild = resumeReady && postingReady;

  async function pickPdf() {
    setError(null);
    setPicking(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > MAX_PDF_BYTES)
        throw new AppError("That PDF is over 5 MB. Try a smaller file.");
      const base64 =
        Platform.OS === "web"
          ? (asset.base64 ?? "").replace(/^data:[^,]*,/, "")
          : await new File(asset.uri).base64();
      if (!base64)
        throw new AppError(
          "Couldn't read that file. Try another PDF or paste the text.",
        );
      setPdf({ name: asset.name, base64 });
    } catch (e) {
      setError(
        e instanceof AppError
          ? e.message
          : "Couldn't open that file. Try another PDF or paste the text.",
      );
    } finally {
      setPicking(false);
    }
  }

  // Appends rather than replaces so a stray tap never wipes text the user already entered.
  async function pasteInto(set: (fn: (prev: string) => string) => void) {
    setError(null);
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim())
        return setError(
          "Your clipboard is empty. Copy the text first, then tap Paste.",
        );
      set((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    } catch {
      setError(
        "Couldn't read the clipboard. Tap the field and paste from the keyboard instead.",
      );
    }
  }

  function build() {
    if (!canBuild || peek !== 0) return; // peek !== 0: already leaving, ignore repeat taps
    setPendingPlanInput({
      resume:
        mode === "pdf" && pdf
          ? { pdfBase64: pdf.base64 }
          : { text: resumeText.trim() },
      posting: posting.trim(),
    });
    // The monkey ducks behind the panel (frames 1→3), vanishes, then we leave.
    const step = motionOff || continuePlan ? 0 : 150; // no monkey shown for returning users: nothing to wait for
    setPeek(1);
    setTimeout(() => setPeek(2), step);
    setTimeout(() => {
      setPeek(null);
      router.push("/building");
    }, step * 2);
  }

  // One background for landing and form: it stays mounted so the terrain doesn't flicker at the hand-off.
  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: c.grass }}
      // Android is edge-to-edge (the window no longer resizes for the keyboard), so pad on both
      // platforms. There's no ScrollView or window pan here, so the focused-field mode just fills
      // the padded space: no double shift.
      behavior="padding"
    >
      <PixelBackground grass>
        {!started ? (
          <Landing
            onContinue={() => {
              landingSeen = true;
              setStarted(true);
            }}
          />
        ) : (
          fontLoaded && (
            <View className="w-full max-w-[480px] flex-1 self-center px-4 pb-3 pt-3">
              <Animated.View entering={rowIn(1)}>
                <View className="mt-3 flex-row items-end justify-between">
                  <Text
                    accessibilityRole="header"
                    style={{
                      ...font(44, c.gold),
                      textShadowColor: c.outline,
                      textShadowOffset: { width: 3, height: 3 },
                      textShadowRadius: 0,
                    }}
                  >
                    SkillQuest
                  </Text>
                  {typing ? (
                    <Pressable
                      onPress={Keyboard.dismiss}
                      accessibilityRole="button"
                      accessibilityLabel="Done typing"
                      accessibilityHint="Closes the keyboard"
                      className="min-h-[44px] justify-center px-4 active:opacity-80"
                      style={{
                        backgroundColor: c.gold,
                        borderWidth: 3,
                        borderColor: c.outline,
                      }}
                    >
                      <Text style={font(22, c.outline)}>Done</Text>
                    </Pressable>
                  ) : (
                    USE_MOCK && (
                      <Text style={{ ...font(16, c.cream), marginBottom: 6 }}>
                        Mock mode
                      </Text>
                    )
                  )}
                </View>
              </Animated.View>

              {continuePlan && !typing && (
                <Animated.View entering={rowIn(2)}>
                  {/* "Your quests": every plan on this account, the last-opened one on top as "Continue". */}
                  <PlanList plans={plans} currentPlanId={currentPlanId} />
                </Animated.View>
              )}

              {/* Form panel: hugs its content; while typing it fills the screen so the focused field can expand */}
              <Animated.View
                entering={rowIn(continuePlan ? 3 : 2)}
                style={typing ? { flex: 1 } : undefined}
              >
                <View
                  className={`mt-6 gap-2 p-3 ${typing ? "flex-1" : ""}`}
                  style={{
                    backgroundColor: c.parchment,
                    borderWidth: 4,
                    borderColor: c.wood,
                    boxShadow: `5px 5px 0 ${c.outline}`,
                  }}
                >
                  {/* Paws hang over the top border so he looks like he's holding on; hidden while typing (the Done button sits there)
                      and for returning users, whose Continue card sits above the panel. */}
                  {peek !== null && !typing && !continuePlan && (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        right: 8,
                        top: -PEEK_HANG,
                        zIndex: 1,
                      }}
                    >
                      <Sprite
                        sheet={peekSheet}
                        frame={peekFrame(peek)}
                        width={PEEK_W}
                      />
                    </View>
                  )}
                  {focused !== "posting" && (
                    <>
                      <View className="min-h-[44px] flex-row items-center justify-between">
                        <Text style={font(24)} accessibilityRole="header">
                          1. Your resume
                        </Text>
                        {mode === "text" && !typing && (
                          <PasteButton
                            label="Paste resume"
                            onPress={() => pasteInto(setResumeText)}
                          />
                        )}
                      </View>
                      {!typing && (
                        <View
                          className="flex-row"
                          style={{ borderWidth: 2, borderColor: c.wood }}
                          accessibilityRole="tablist"
                        >
                          {(["pdf", "text"] as const).map((m) => (
                            <Pressable
                              key={m}
                              onPress={() => setMode(m)}
                              accessibilityRole="tab"
                              accessibilityState={{ selected: mode === m }}
                              className="min-h-[44px] flex-1 items-center justify-center"
                              style={{
                                backgroundColor: mode === m ? c.wood : c.cream,
                              }}
                            >
                              <Text
                                style={font(20, mode === m ? c.cream : c.wood)}
                              >
                                {m === "pdf" ? "Upload PDF" : "Paste text"}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      )}

                      {mode === "pdf" ? (
                        <Pressable
                          onPress={pickPdf}
                          disabled={picking}
                          accessibilityRole="button"
                          accessibilityLabel={
                            pdf
                              ? `Resume selected: ${pdf.name}. Tap to choose a different file.`
                              : "Choose your resume PDF"
                          }
                          className="h-24 flex-row items-center gap-3 px-4 active:opacity-80"
                          style={{
                            ...field,
                            borderStyle: pdf ? "solid" : "dashed",
                            backgroundColor: pdf ? "#E6F2D9" : c.cream,
                          }}
                        >
                          <MaterialCommunityIcons
                            name={
                              pdf ? "file-check-outline" : "file-upload-outline"
                            }
                            size={44}
                            color={pdf ? c.grassDark : c.wood}
                          />
                          <View className="flex-1">
                            <Text numberOfLines={1} style={font(22)}>
                              {picking
                                ? "Opening…"
                                : pdf
                                  ? pdf.name
                                  : "Choose a PDF"}
                            </Text>
                            <Text style={font(18, c.stoneDark)}>
                              {pdf ? "Tap to change" : "Up to 5 MB"}
                            </Text>
                          </View>
                        </Pressable>
                      ) : (
                        <TextInput
                          value={resumeText}
                          onChangeText={typed(setResumeText)}
                          {...focusProps("resume")}
                          multiline
                          textAlignVertical="top"
                          placeholder="Paste your resume text here"
                          placeholderTextColor={c.stoneDark}
                          accessibilityLabel="Resume text"
                          className={`${focused === "resume" ? "flex-1" : "h-24"} p-3`}
                          style={{ ...field, ...font(20) }}
                        />
                      )}
                    </>
                  )}

                  {focused !== "resume" && (
                    <>
                      <View className="mt-2 flex-row items-center justify-between">
                        <Text style={font(24)} accessibilityRole="header">
                          2. The job posting
                        </Text>
                        {!typing && (
                          <PasteButton
                            label="Paste job posting"
                            onPress={() => pasteInto(setPosting)}
                          />
                        )}
                      </View>
                      <TextInput
                        value={posting}
                        onChangeText={typed(setPosting)}
                        {...focusProps("posting")}
                        multiline
                        textAlignVertical="top"
                        placeholder="Paste the full job description"
                        placeholderTextColor={c.stoneDark}
                        accessibilityLabel="Job posting text"
                        className={`${focused === "posting" ? "flex-1" : "h-24"} p-3`}
                        style={{ ...field, ...font(20) }}
                      />
                    </>
                  )}
                  {!typing && (
                    <Text style={font(16, c.stoneDark)}>
                      Your resume is analyzed once and never stored.
                    </Text>
                  )}
                </View>
              </Animated.View>

              {error && (
                <View
                  className="mt-3 p-3"
                  style={{
                    backgroundColor: c.cream,
                    borderWidth: 3,
                    borderColor: c.red,
                  }}
                  accessibilityRole="alert"
                >
                  <Text style={font(20, c.red)}>{error}</Text>
                </View>
              )}

              <Animated.View entering={rowIn(continuePlan ? 4 : 3)}>
                {!typing && (
                  <>
                    <Pressable
                      onPress={build}
                      disabled={!canBuild}
                      accessibilityRole="button"
                      accessibilityLabel="Build my map"
                      accessibilityHint="Analyzes your resume and the posting, then builds your levels"
                      accessibilityState={{ disabled: !canBuild }}
                      className="mt-8"
                    >
                      {({ pressed }) => (
                        <View
                          className="min-h-[56px] items-center justify-center"
                          style={{
                            backgroundColor: canBuild ? c.gold : c.stone,
                            borderWidth: 4,
                            borderColor: canBuild ? c.outline : c.stoneDark,
                            boxShadow:
                              pressed || !canBuild
                                ? "none"
                                : `0 5px 0 ${c.outline}`,
                            transform: [
                              { translateY: pressed && canBuild ? 5 : 0 },
                            ],
                          }}
                        >
                          <Text
                            style={font(28, canBuild ? c.outline : c.stoneDark)}
                          >
                            Build my map
                          </Text>
                        </View>
                      )}
                    </Pressable>
                    {!canBuild && (
                      <Text
                        className="mt-6 text-center"
                        style={font(18, c.cream)}
                      >
                        {!resumeReady
                          ? mode === "pdf"
                            ? "Add your resume PDF"
                            : "Paste at least a few lines of your resume"
                          : "Paste the full job posting"}{" "}
                        to continue.
                      </Text>
                    )}
                  </>
                )}
              </Animated.View>
            </View>
          )
        )}
      </PixelBackground>
    </KeyboardAvoidingView>
  );
}

function PasteButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Adds the text on your clipboard to this field"
      className="min-h-[44px] flex-row items-center gap-1 px-3 active:opacity-70"
      style={{ backgroundColor: c.cream, borderWidth: 2, borderColor: c.wood }}
    >
      <MaterialCommunityIcons name="content-paste" size={20} color={c.wood} />
      <Text style={font(20)}>Paste</Text>
    </Pressable>
  );
}
