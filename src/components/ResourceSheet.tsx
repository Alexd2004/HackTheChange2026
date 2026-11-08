// Bottom sheet listing web resources for a level (from Keenable). Opens links in an in-app browser
// and reports how long each one stayed open (for analytics) through onOpened.
import type { Resource } from "@/lib/types";
import * as WebBrowser from "expo-web-browser";
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettings } from "@/lib/settings";
import { pixelColors as c } from "@/lib/theme";
import { Icon, PixelButton, field, font } from "./pixel";

const SLIDE_MS = 250;

export function ResourceSheet({
  visible,
  resources,
  onClose,
  onOpened,
}: {
  visible: boolean;
  resources: Resource[];
  onClose: () => void;
  /** Called once the user comes back from a resource. durationMs is null when it can't be measured (web). */
  onOpened?: (resource: Resource, durationMs: number | null) => void;
}) {
  const { motionOff } = useSettings();
  // Closing slides the sheet down first; the Modal (and its shade) only goes away once it's down.
  const [closing, setClosing] = useState(false);
  // Reset only when the sheet is opened again: resetting on close would remount the sheet while
  // the Modal is still hiding and slide it down a second time.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setClosing(false);
  }
  const close = () => {
    if (motionOff) return onClose();
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, SLIDE_MS);
  };
  return (
    <Modal
      visible={visible}
      animationType="none" // backdrop shows at once; only the sheet slides up (below)
      transparent
      onRequestClose={close}
    >
      {/* Full-screen shade: fades in/out on its own; never moves with the sheet. */}
      {!closing && (
        <Animated.View
          // Plain styles: NativeWind className isn't applied to Reanimated views here.
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          pointerEvents="none"
          entering={motionOff ? undefined : FadeIn.duration(SLIDE_MS)}
          exiting={motionOff ? undefined : FadeOut.duration(SLIDE_MS)}
        />
      )}
      <Pressable
        className="flex-1"
        onPress={close}
        accessibilityLabel="Close resources"
        accessibilityRole="button"
      />
      {/* Pixel parchment sheet; resource rows match the hint box (cream + wood). */}
      {!closing && (
        <Animated.View
          style={{ maxHeight: "75%" }}
          entering={motionOff ? undefined : SlideInDown.duration(SLIDE_MS)}
          exiting={motionOff ? undefined : SlideOutDown.duration(SLIDE_MS)}
        >
          <SafeAreaView
            edges={["bottom"]}
            style={{
              backgroundColor: c.parchment,
              borderTopWidth: 4,
              borderColor: c.wood,
            }}
          >
            <View className="w-full max-w-[480px] self-center px-4 pt-3">
              <View
                className="mb-4 h-1.5 w-12 self-center"
                style={{ backgroundColor: c.wood }}
              />
              <Text style={font(28)} accessibilityRole="header">
                Resources
              </Text>
              <Text className="mb-4" style={font(18, c.dirtEdge)}>
                Open one, then come back to the question.
              </Text>
              <ScrollView contentContainerClassName="gap-3 pb-4">
                {resources.length === 0 ? (
                  <Text style={font(18)}>
                    No resources found for this level.
                  </Text>
                ) : (
                  resources.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() =>
                        // Only record opens that really happened (a failed/duplicate open is not logged).
                        openAndTime(r.url)
                          .then((ms) => onOpened?.(r, ms))
                          .catch(() => {})
                      }
                      accessibilityRole="link"
                      accessibilityLabel={`${r.title}. Opens in browser.`}
                      className="min-h-[56px] p-3 active:opacity-80"
                      style={{ ...field, borderWidth: 3 }}
                    >
                      <View className="flex-row items-start gap-2">
                        <Text className="flex-1" style={font(20)}>
                          {r.title}
                        </Text>
                        <Icon name="open-in-new" size={18} color={c.wood} />
                      </View>
                      {r.snippet ? (
                        <Text numberOfLines={2} style={font(16)}>
                          {r.snippet}
                        </Text>
                      ) : null}
                      <Text numberOfLines={1} style={font(15, c.dirtEdge)}>
                        {hostOf(r.url)}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
              <View className="pb-14">
                <PixelButton
                  label="Back to question"
                  variant="secondary"
                  onPress={close}
                />
              </View>
            </View>
          </SafeAreaView>
        </Animated.View>
      )}
    </Modal>
  );
}

async function openAndTime(url: string): Promise<number | null> {
  const start = Date.now();
  if (Platform.OS !== "android") {
    await WebBrowser.openBrowserAsync(url);
    return Platform.OS === "web" ? null : Date.now() - start;
  }
  let left = AppState.currentState !== "active";
  const back = new Promise<number | null>((resolve) => {
    const done = (value: number | null) => {
      sub.remove();
      clearTimeout(noLeave);
      clearTimeout(cap);
      resolve(value);
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") left = true;
      else if (left) done(Date.now() - start);
    });
    // If the app never went to the background, the browser didn't take over: use what we have.
    const noLeave = setTimeout(() => {
      if (!left) done(Date.now() - start);
    }, 3000);
    const cap = setTimeout(() => done(null), 30 * 60 * 1000);
  });
  await WebBrowser.openBrowserAsync(url); // listener is attached first, so no state change is missed
  return back;
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)/);
  return m ? m[1].replace(/^www\./, "") : url;
}
