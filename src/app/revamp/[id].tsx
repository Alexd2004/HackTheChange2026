// Resume revamp screen (route: /revamp/<planId>). The end of the quest:
//   1. needs at least one beaten stage boss (shows "Quest complete!" once every boss is beaten)
//   2. gets the resume saved on this phone (or asks for it again)
//   3. revamp-resume rewrites it with the skills earned (Person A's AI)
//   4. makes a PDF on the phone, then Save/Share it or Email it (send-resume, AWS SES)
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Jersey25_400Regular, useFonts } from "@expo-google-fonts/jersey-25";
import { AppError, getPlanBundle, revampResume } from "@/lib/api";
import { getAuthState } from "@/lib/auth";
import { loadResume, saveResume, type StoredResume } from "@/lib/resume";
import { emailResume, questProgress, type QuestProgress } from "@/lib/resumeDelivery";
import { createResumePdf, type ResumePdf } from "@/lib/resumePdf";
import { pixelColors as c } from "@/lib/theme";
import type { Plan, RevampedResume } from "@/lib/types";
import { Icon, PixelBackground, PixelButton, TileBar, field, font, outlined, panel } from "@/components/pixel";

type Phase = "loading" | "ready" | "revamping" | "done";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function RevampScreen() {
  const { id: planId } = useLocalSearchParams<{ id: string }>();
  const [fontLoaded] = useFonts({ Jersey25_400Regular });

  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState<QuestProgress | null>(null);
  const [resume, setResume] = useState<StoredResume | null>(null);
  const [revamped, setRevamped] = useState<RevampedResume | null>(null);
  const [pdf, setPdf] = useState<ResumePdf | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<null | "pick" | "pdf" | "share" | "email">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // One action at a time: a ref (not state) so a fast double tap can't start two Gemini calls
  // or open the document picker twice before the screen re-renders.
  const lock = useRef(false);
  const runLocked = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    try {
      await fn();
    } finally {
      lock.current = false;
    }
  }, []);

  // ---- load the plan, the quest progress and the resume saved on this phone
  const [loadKey, setLoadKey] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([getPlanBundle(planId), loadResume(planId).catch(() => null), getAuthState().catch(() => null)])
      .then(([bundle, saved, auth]) => {
        if (!alive) return;
        setPlan(bundle.plan);
        setProgress(questProgress(bundle));
        setResume(saved);
        if (auth?.email) setEmail((cur) => cur || auth.email || "");
        setLoadFailed(false);
        setError(null);
        setPhase("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setError(message(e, "Couldn't load your plan."));
        setLoadFailed(true);
        setPhase("ready");
      });
    return () => { alive = false; };
  }, [planId, loadKey]);

  // ---- re-upload when the phone has no saved resume (reinstall, demo plan, another phone)
  const pickResume = useCallback(() => runLocked(async () => {
    setError(null);
    setBusy("pick");
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (asset.size && asset.size > MAX_PDF_BYTES) throw new AppError("That PDF is over 5 MB. Try a smaller file.");
      const base64 = Platform.OS === "web"
        ? (asset.base64 ?? "").replace(/^data:[^,]*,/, "")
        : await new File(asset.uri).base64();
      if (!base64) throw new AppError("Couldn't read that file. Try another PDF.");
      const stored: StoredResume = { pdfBase64: base64 };
      await saveResume(planId, stored).catch(() => {}); // keep it for next time; fine if this fails
      setResume(stored);
    } catch (e) {
      setError(message(e, "Couldn't open that file. Try another PDF."));
    } finally {
      setBusy(null);
    }
  }), [planId, runLocked]);

  // ---- make the PDF on the phone (web can't make a file). Separate from the revamp so a failed
  // PDF can be retried without paying for another Gemini call.
  const makePdf = useCallback(async (result: RevampedResume) => {
    if (Platform.OS === "web") return;
    try {
      setPdf(await createResumePdf(result));
    } catch (e) {
      setError(message(e, "Couldn't create the resume PDF. Please try again."));
    }
  }, []);

  // ---- revamp, then make the PDF
  const revamp = useCallback(() => runLocked(async () => {
    if (!resume) return;
    setError(null);
    setNotice(null);
    setPhase("revamping");
    try {
      const result = await revampResume(planId, resume);
      setRevamped(result);
      await makePdf(result); // if this fails, the revamp still shows with a "Make PDF again" button
      setPhase("done");
    } catch (e) {
      setError(message(e, "Couldn't update your resume. Please try again."));
      setPhase("ready");
    }
  }), [planId, resume, runLocked, makePdf]);

  const retryPdf = useCallback(() => runLocked(async () => {
    if (!revamped) return;
    setError(null);
    setBusy("pdf");
    try {
      await makePdf(revamped);
    } finally {
      setBusy(null);
    }
  }), [revamped, runLocked, makePdf]);

  const share = useCallback(() => runLocked(async () => {
    if (!pdf) return;
    setError(null);
    setNotice(null);
    setBusy("share");
    try {
      if (!(await Sharing.isAvailableAsync())) throw new AppError("Sharing isn't available on this device.");
      await Sharing.shareAsync(namedCopy(pdf.uri, plan?.job_title), {
        mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Save or share your resume",
      });
    } catch (e) {
      setError(message(e, "Couldn't open the share sheet."));
    } finally {
      setBusy(null);
    }
  }), [pdf, plan, runLocked]);

  const sendEmail = useCallback(() => runLocked(async () => {
    if (!pdf) return;
    setError(null);
    setNotice(null);
    setBusy("email");
    try {
      await emailResume({ planId, to: email, pdfBase64: pdf.base64 });
      setNotice(`Sent! Check ${email.trim()} (and the spam folder) for your resume.`);
    } catch (e) {
      setError(message(e, "Couldn't email your resume."));
    } finally {
      setBusy(null);
    }
  }), [planId, email, pdf, runLocked]);

  const toMap = () => router.dismissTo({ pathname: "/plan/[id]", params: { id: planId } });

  if (!fontLoaded) return <PixelBackground>{null}</PixelBackground>;

  const complete = progress?.complete ?? false;
  const locked = progress !== null && !progress.canRevamp;
  const title = complete ? "Quest complete!" : "Revamp your resume";

  return (
    <PixelBackground>
      <ScrollView className="flex-1" contentContainerClassName="flex-grow" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-[480px] flex-1 gap-5 self-center px-4 py-8">
          {/* Header */}
          <View className="items-center gap-2">
            <View className="h-20 w-20 items-center justify-center" style={{ ...panel, backgroundColor: c.cream }}>
              <Icon name={complete ? "trophy" : "file-document-edit-outline"} size={48} color={complete ? c.gold : c.wood} />
            </View>
            <Text className="mt-2 text-center" style={outlined(40, c.gold)} accessibilityRole="header">{title}</Text>
            {plan && (
              <Text className="text-center" style={outlined(22)}>
                {plan.job_title}{plan.company ? ` · ${plan.company}` : ""}
              </Text>
            )}
          </View>

          {phase === "loading" && <Panel><Text style={font(22)}>Loading your quest…</Text></Panel>}

          {/* Progress */}
          {progress && plan && (
            <Panel>
              <View className="flex-row items-end justify-between">
                <Text style={font(22)}>Stages beaten</Text>
                <Text style={font(32, c.outline)}>{progress.stagesBeaten} / {progress.stagesTotal}</Text>
              </View>
              <TileBar filled={progress.stagesBeaten} total={Math.max(progress.stagesTotal, 1)} color={c.grassDark} height={12}
                label={`${progress.stagesBeaten} of ${progress.stagesTotal} stages beaten`} />
              <Text style={font(20)}>Job match: {plan.match_pct}%</Text>
            </Panel>
          )}

          {locked && (
            <Panel>
              <Row icon="lock" color={c.wood} text="Beat a stage boss to unlock your revamped resume." />
              <PixelButton label="Back to map" icon="map-outline" variant="secondary" onPress={toMap} />
            </Panel>
          )}

          {/* Resume + revamp */}
          {phase !== "loading" && progress?.canRevamp && phase !== "done" && (
            <Panel>
              {resume ? (
                <Row icon="check-bold" color={c.grassDark} text="Your resume is saved on this phone." />
              ) : (
                <>
                  <Row icon="file-alert-outline" color={c.red} text="We need your resume again (it's only kept on the phone you uploaded it on)." />
                  <PixelButton label={busy === "pick" ? "Opening…" : "Upload resume PDF"} icon="upload" variant="secondary"
                    onPress={pickResume} disabled={busy !== null} />
                </>
              )}
              <PixelButton
                label={phase === "revamping" ? "Revamping…" : "Revamp my resume"}
                icon="auto-fix"
                onPress={revamp}
                disabled={!resume || phase === "revamping"}
                hint="Rewrites your resume with the skills you earned"
              />
              {phase === "revamping" && <Text style={font(18)}>This takes about 10 seconds.</Text>}
            </Panel>
          )}

          {/* Result */}
          {phase === "done" && revamped && (
            <>
              <Panel>
                <Text style={font(26, c.outline)}>{revamped.headline}</Text>
                {revamped.added_skills.length > 0 && (
                  <>
                    <Text style={font(20)}>New skills added:</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {revamped.added_skills.map((s) => (
                        <View key={s} className="px-2 py-1" style={{ backgroundColor: c.grass, borderWidth: 2, borderColor: c.outline }}>
                          <Text style={font(18, c.cream)}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
                {revamped.changes.slice(0, 5).map((ch, i) => (
                  <Row key={i} icon="pencil" color={c.wood} text={`${ch.where}: ${ch.reason}`} />
                ))}
              </Panel>

              <Panel>
                <Text style={font(24, c.outline)}>Get your resume</Text>
                {pdf ? (
                  <>
                    <PixelButton label={busy === "share" ? "Opening…" : "Save or share PDF"} icon="download"
                      onPress={share} disabled={busy !== null} />
                    <Text nativeID="email-label" style={font(20)}>Or email it to</Text>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      placeholder="you@example.com"
                      placeholderTextColor={c.stoneDark}
                      accessibilityLabel="Email address to send your resume to"
                      accessibilityLabelledBy="email-label"
                      className="min-h-[52px] px-3"
                      style={{ ...field, borderWidth: 3, ...font(22, c.outline) }}
                    />
                    <PixelButton label={busy === "email" ? "Sending…" : "Email my resume"} icon="email-fast-outline"
                      variant="secondary" onPress={sendEmail} disabled={busy !== null || !email.trim()} />
                  </>
                ) : Platform.OS === "web" ? (
                  <Text style={font(20)}>Open SkillQuest on your phone to download or email the PDF.</Text>
                ) : (
                  <PixelButton label={busy === "pdf" ? "Making PDF…" : "Make PDF again"} icon="file-pdf-box"
                    onPress={retryPdf} disabled={busy !== null} />
                )}
              </Panel>
            </>
          )}

          {error && (
            <View className="gap-3 p-3" style={{ ...panel, borderColor: c.red }} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Row icon="alert" color={c.red} text={error} />
              {loadFailed && (
                <PixelButton label="Try again" icon="refresh" variant="secondary"
                  onPress={() => { setError(null); setPhase("loading"); setLoadKey((k) => k + 1); }} />
              )}
            </View>
          )}
          {notice && (
            <View className="p-3" style={{ ...panel, borderColor: c.grassDark }} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Row icon="check-bold" color={c.grassDark} text={notice} />
            </View>
          )}

          {!locked && <PixelButton label="Back to map" icon="map-outline" variant="secondary" onPress={toMap} />}
        </View>
      </ScrollView>
    </PixelBackground>
  );
}

/** Copies the PDF to "Resume - <job>.pdf" so the shared file has a readable name (falls back to the original). */
function namedCopy(uri: string, jobTitle?: string | null): string {
  try {
    const safe = (jobTitle ?? "").replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 50);
    const dest = new File(Paths.cache, `Resume${safe ? ` - ${safe}` : ""}.pdf`);
    if (dest.exists) dest.delete();
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

function Panel({ children }: { children: React.ReactNode }) {
  return <View className="gap-3 p-4" style={panel}>{children}</View>;
}

function Row({ icon, color, text }: { icon: React.ComponentProps<typeof Icon>["name"]; color: string; text: string }) {
  return (
    <View className="flex-row items-start gap-2">
      <Icon name={icon} size={20} color={color} />
      <Text className="flex-1" style={font(18, color === c.wood ? c.wood : color)}>{text}</Text>
    </View>
  );
}
