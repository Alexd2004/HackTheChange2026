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
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";
import { Icon } from "./pixel";
import { Button } from "./ui";

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
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/60"
        onPress={onClose}
        accessibilityLabel="Close resources"
        accessibilityRole="button"
      />
      <SafeAreaView
        edges={["bottom"]}
        className="max-h-[75%] rounded-t-3xl border-t border-line bg-panel"
      >
        <View className="w-full max-w-[480px] self-center px-4 pt-3">
          <View className="mb-4 h-1.5 w-12 self-center rounded-full bg-line" />
          <Text
            className="text-xl font-bold text-fg"
            accessibilityRole="header"
          >
            Resources
          </Text>
          <Text className="mt-1 mb-4 text-sm text-muted">
            Open one, then come back to the question.
          </Text>
          <ScrollView contentContainerClassName="gap-3 pb-4">
            {resources.length === 0 ? (
              <Text className="text-base text-muted">
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
                  className="min-h-[56px] rounded-2xl border border-line bg-raised p-4 active:opacity-80">
                  <View className="flex-row items-start gap-2">
                    <Text className="flex-1 text-base font-semibold text-fg">{r.title}</Text>
                    <Icon name="open-in-new" size={18} color={colors.muted} />
                  </View>
                  {r.snippet ? <Text numberOfLines={2} className="mt-1 text-sm leading-5 text-muted">{r.snippet}</Text> : null}
                  <Text numberOfLines={1} className="mt-1 text-xs text-normal">{hostOf(r.url)}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
          <View className="pb-3">
            <Button
              label="Back to question"
              variant="secondary"
              onPress={onClose}
            />
          </View>
        </View>
      </SafeAreaView>
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
