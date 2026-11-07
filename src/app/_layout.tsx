// Root layout: dark theme, accessibility settings, and a header-less stack of screens.
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "../global.css";
import { SettingsProvider } from "@/lib/settings";
import { colors } from "@/lib/theme";

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.ink, card: colors.panel, text: colors.fg, border: colors.line, primary: colors.brand },
};

export default function RootLayout() {
  return (
    <SettingsProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ink } }}>
          <Stack.Screen name="building" options={{ gestureEnabled: false }} />
          <Stack.Screen name="result/[id]" options={{ gestureEnabled: false }} />
        </Stack>
      </ThemeProvider>
    </SettingsProvider>
  );
}
