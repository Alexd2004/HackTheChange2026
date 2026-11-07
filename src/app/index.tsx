// Upload screen: add a resume (PDF or pasted text) + paste a job posting → build the map.
// Also: continue an existing plan and load the demo plan. Pixel theme shared with the landing.
import { Landing } from "@/components/Landing";
import { field, font } from "@/components/pixel";
import {
  AppError,
  importDemoPlan,
  listPlans,
  setPendingPlanInput,
  USE_MOCK,
} from "@/lib/api";
import { pixelColors as c } from "@/lib/theme";
import type { Plan } from "@/lib/types";
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
import { SafeAreaView } from "react-native-safe-area-context";

let landingSeen = false; // module-level: show the landing once per app session, not on every return to "/"

type ResumeMode = "pdf" | "text";
interface PickedPdf {
  name: string;
  base64: string;
}

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export default function UploadScreen() {
  const [fontLoaded] = useFonts({ Jersey25_400Regular });
  const [started, setStarted] = useState(landingSeen);
  const [mode, setMode] = useState<ResumeMode>("pdf");
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [posting, setPosting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
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

  useFocusEffect(
    useCallback(() => {
      listPlans()
        .then(setPlans)
        .catch(() => setPlans([]));
    }, []),
  );
  // "Continue" = the plan the user last opened (profile), else the newest one.
  const continuePlan = plans.find((p) => p.id === currentPlanId) ?? plans[0];

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
    if (!canBuild) return;
    setPendingPlanInput({
      resume:
        mode === "pdf" && pdf
          ? { pdfBase64: pdf.base64 }
          : { text: resumeText.trim() },
      posting: posting.trim(),
    });
    router.push("/building");
  }

  async function loadDemo() {
    setError(null);
    setDemoLoading(true);
    try {
      const id = await importDemoPlan();
      router.push({ pathname: "/plan/[id]", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the demo plan.");
    } finally {
      setDemoLoading(false);
    }
  }

  if (!started)
    return (
      <Landing
        onContinue={() => {
          landingSeen = true;
          setStarted(true);
        }}
      />
    );

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: c.grass }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        {fontLoaded && (
          <View className="w-full max-w-[480px] flex-1 self-center px-4 pb-3 pt-3">
            <View className="flex-row items-end justify-between">
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

            {plans.length > 0 && (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/plan/[id]",
                    params: { id: plans[0].id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Continue your plan for ${plans[0].job_title}, ${plans[0].match_pct}% match`}
                className="mt-4 flex-row items-center justify-between px-3 py-2 active:opacity-80"
                style={{
                  backgroundColor: c.parchment,
                  borderWidth: 3,
                  borderColor: c.wood,
                  boxShadow: `5px 5px 0 ${c.outline}`,
                }}
              >
                <Text
                  numberOfLines={1}
                  className="flex-1 pr-3"
                  style={font(20)}
                >
                  Continue: {plans[0].job_title}
                </Text>
                <Text style={font(24, c.grassDark)}>{plans[0].match_pct}%</Text>
              </Pressable>
            )}

            {/* Form panel: hugs its content; while typing it fills the screen so the focused field can expand */}
            <View
              className={`mt-6 gap-2 p-3 ${typing ? "flex-1" : ""}`}
              style={{
                backgroundColor: c.parchment,
                borderWidth: 4,
                borderColor: c.wood,
                boxShadow: `5px 5px 0 ${c.outline}`,
              }}
            >
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
                          <Text style={font(20, mode === m ? c.cream : c.wood)}>
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
                  <Text className="mt-6 text-center" style={font(18, c.cream)}>
                    {!resumeReady
                      ? mode === "pdf"
                        ? "Add your resume PDF"
                        : "Paste at least a few lines of your resume"
                      : "Paste the full job posting"}{" "}
                    to continue.
                  </Text>
                )}
                <Pressable
                  onPress={loadDemo}
                  disabled={demoLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Try the demo plan"
                  accessibilityState={{ busy: demoLoading }}
                  className="mt-4 min-h-[44px] items-center justify-center active:opacity-70"
                >
                  <Text
                    style={{
                      ...font(20, c.cream),
                      textDecorationLine: "underline",
                    }}
                  >
                    {demoLoading ? "Loading demo…" : "Try the demo plan"}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </SafeAreaView>
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
