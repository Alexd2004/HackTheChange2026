// Upload screen: add a resume (PDF or pasted text) + paste a job posting → build the map.
// Also: continue an existing plan, load the demo plan, and accessibility toggles.
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { AppError, importDemoPlan, listPlans, setPendingPlanInput, USE_MOCK } from "@/lib/api";
import { getProfile } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { colors } from "@/lib/theme";
import type { Plan } from "@/lib/types";
import { ProgressHeader } from "@/components/ProgressHeader";
import { Button, Screen } from "@/components/ui";

type ResumeMode = "pdf" | "text";
interface PickedPdf { name: string; base64: string }

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export default function UploadScreen() {
  const settings = useSettings();
  const [mode, setMode] = useState<ResumeMode>("pdf");
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [posting, setPosting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listPlans().then(setPlans).catch(() => setPlans([]));
      getProfile().then((p) => setCurrentPlanId(p?.current_plan_id ?? null)).catch(() => {});
    }, []),
  );
  // "Continue" = the plan the user last opened (profile), else the newest one.
  const continuePlan = plans.find((p) => p.id === currentPlanId) ?? plans[0];

  const resumeReady = mode === "pdf" ? !!pdf : resumeText.trim().length >= 100;
  const postingReady = posting.trim().length >= 80;

  async function pickPdf() {
    setError(null);
    setPicking(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > MAX_PDF_BYTES) throw new AppError("That PDF is over 5 MB. Try a smaller file.");
      const base64 = Platform.OS === "web"
        ? (asset.base64 ?? "").replace(/^data:[^,]*,/, "")
        : await new File(asset.uri).base64();
      if (!base64) throw new AppError("Couldn't read that file. Try another PDF or paste the text.");
      setPdf({ name: asset.name, base64 });
    } catch (e) {
      setError(e instanceof AppError ? e.message : "Couldn't open that file. Try another PDF or paste the text.");
    } finally {
      setPicking(false);
    }
  }

  function build() {
    if (!resumeReady || !postingReady) return;
    setPendingPlanInput({
      resume: mode === "pdf" && pdf ? { pdfBase64: pdf.base64 } : { text: resumeText.trim() },
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

  return (
    <KeyboardAvoidingView className="flex-1 bg-ink" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <ProgressHeader />
        <View className="pt-4 pb-2">
          <Text className="text-sm font-bold uppercase tracking-widest text-brand">SkillQuest</Text>
          <Text className="mt-2 text-3xl font-extrabold leading-9 text-fg" accessibilityRole="header">
            Turn a job posting into a game you can win.
          </Text>
          <Text className="mt-3 text-base leading-6 text-muted">
            We compare your resume to the job, find the skills you’re missing, and build levels to close each gap.
          </Text>
          {USE_MOCK && <Text className="mt-2 text-xs font-semibold text-challenge">Mock mode: using sample data</Text>}
        </View>

        {continuePlan && (
          <Pressable
            onPress={() => router.push({ pathname: "/plan/[id]", params: { id: continuePlan.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Continue your plan for ${continuePlan.job_title}, ${continuePlan.match_pct}% match`}
            className="mt-4 flex-row items-center justify-between rounded-2xl border border-brand/40 bg-panel p-4 active:opacity-80">
            <View className="flex-1 pr-3">
              <Text className="text-xs font-bold uppercase tracking-wider text-muted">Continue</Text>
              <Text numberOfLines={1} className="mt-1 text-base font-bold text-fg">{continuePlan.job_title}</Text>
            </View>
            <Text className="text-2xl font-extrabold text-brand">{continuePlan.match_pct}%</Text>
          </Pressable>
        )}

        {/* Step 1: resume */}
        <View className="mt-6 gap-3">
          <Text className="text-lg font-bold text-fg" accessibilityRole="header">1. Your resume</Text>
          <View className="flex-row rounded-2xl bg-panel p-1" accessibilityRole="tablist">
            {(["pdf", "text"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                className={`min-h-[44px] flex-1 items-center justify-center rounded-xl ${mode === m ? "bg-raised" : ""}`}>
                <Text className={`font-semibold ${mode === m ? "text-fg" : "text-muted"}`}>
                  {m === "pdf" ? "Upload PDF" : "Paste text"}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === "pdf" ? (
            <Pressable
              onPress={pickPdf}
              disabled={picking}
              accessibilityRole="button"
              accessibilityLabel={pdf ? `Resume selected: ${pdf.name}. Tap to choose a different file.` : "Choose your resume PDF"}
              className={`min-h-[96px] items-center justify-center rounded-2xl border-2 border-dashed px-4 py-5 active:opacity-80 ${pdf ? "border-brand bg-brand/10" : "border-line bg-panel"}`}>
              <Text className="text-2xl">{pdf ? "📄" : "⬆️"}</Text>
              <Text numberOfLines={1} className="mt-2 text-base font-semibold text-fg">
                {picking ? "Opening…" : pdf ? pdf.name : "Choose a PDF"}
              </Text>
              <Text className="mt-1 text-sm text-muted">{pdf ? "Tap to change" : "Up to 5 MB"}</Text>
            </Pressable>
          ) : (
            <TextInput
              value={resumeText}
              onChangeText={setResumeText}
              multiline
              textAlignVertical="top"
              placeholder="Paste your resume text here"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Resume text"
              className="min-h-[160px] rounded-2xl border-2 border-line bg-panel p-4 text-base leading-6 text-fg"
            />
          )}
        </View>

        {/* Step 2: posting */}
        <View className="mt-6 gap-3">
          <Text className="text-lg font-bold text-fg" accessibilityRole="header">2. The job posting</Text>
          <TextInput
            value={posting}
            onChangeText={setPosting}
            multiline
            textAlignVertical="top"
            placeholder="Paste the full job description"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Job posting text"
            className="min-h-[160px] rounded-2xl border-2 border-line bg-panel p-4 text-base leading-6 text-fg"
          />
        </View>

        <Text className="mt-4 text-sm leading-5 text-muted">🔒 Your resume is analyzed once and never stored.</Text>

        {error && (
          <View className="mt-4 rounded-2xl border border-bad/50 bg-bad/10 p-4" accessibilityRole="alert">
            <Text className="text-base text-bad">⚠️ {error}</Text>
          </View>
        )}

        <View className="mt-5 gap-3">
          <Button
            label="Build my map"
            onPress={build}
            disabled={!resumeReady || !postingReady}
            hint="Analyzes your resume and the posting, then builds your levels"
          />
          {!resumeReady || !postingReady ? (
            <Text className="text-center text-sm text-muted">
              {!resumeReady ? (mode === "pdf" ? "Add your resume PDF" : "Paste at least a few lines of your resume") : "Paste the full job posting"} to continue.
            </Text>
          ) : null}
          <Button label="Try the demo plan" variant="ghost" onPress={loadDemo} loading={demoLoading} />
        </View>

        {/* Accessibility */}
        <View className="mt-8 gap-1 rounded-2xl bg-panel p-4">
          <Text className="mb-1 text-base font-bold text-fg" accessibilityRole="header">Accessibility</Text>
          <ToggleRow label="Reduce motion" hint="Turns off animations" value={settings.reduceMotion} onChange={settings.setReduceMotion} />
          <ToggleRow label="Longer timers" hint="Challenge levels give 40 seconds instead of 20" value={settings.extendedTime} onChange={settings.setExtendedTime} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View className="min-h-[52px] flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text className="text-base text-fg">{label}</Text>
        <Text className="text-sm text-muted">{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ true: colors.brand, false: colors.line }}
        thumbColor={colors.fg}
      />
    </View>
  );
}
