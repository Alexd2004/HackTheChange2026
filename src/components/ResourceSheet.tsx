// Bottom sheet listing web resources for a level (from Keenable). Opens links in an in-app browser.
import * as WebBrowser from "expo-web-browser";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Resource } from "@/lib/types";
import { Button } from "./ui";

export function ResourceSheet({
  visible, resources, onClose,
}: { visible: boolean; resources: Resource[]; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} accessibilityLabel="Close resources" accessibilityRole="button" />
      <SafeAreaView edges={["bottom"]} className="max-h-[75%] rounded-t-3xl border-t border-line bg-panel">
        <View className="w-full max-w-[480px] self-center px-4 pt-3">
          <View className="mb-4 h-1.5 w-12 self-center rounded-full bg-line" />
          <Text className="text-xl font-bold text-fg" accessibilityRole="header">Resources</Text>
          <Text className="mt-1 mb-4 text-sm text-muted">Open one, then come back to the question.</Text>
          <ScrollView contentContainerClassName="gap-3 pb-4">
            {resources.length === 0 ? (
              <Text className="text-base text-muted">No resources found for this level.</Text>
            ) : (
              resources.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => WebBrowser.openBrowserAsync(r.url).catch(() => {})}
                  accessibilityRole="link"
                  accessibilityLabel={`${r.title}. Opens in browser.`}
                  className="min-h-[56px] rounded-2xl border border-line bg-raised p-4 active:opacity-80">
                  <Text className="text-base font-semibold text-fg">{r.title} ↗</Text>
                  {r.snippet ? <Text numberOfLines={2} className="mt-1 text-sm leading-5 text-muted">{r.snippet}</Text> : null}
                  <Text numberOfLines={1} className="mt-1 text-xs text-normal">{hostOf(r.url)}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
          <View className="pb-3">
            <Button label="Back to question" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)/);
  return m ? m[1].replace(/^www\./, "") : url;
}
