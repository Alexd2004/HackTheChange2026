// Accessibility settings (reduce motion, extended timer), saved on the device.
// Reduce motion is also on automatically when the phone's own setting is on.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useReducedMotion } from "react-native-reanimated";

interface Settings {
  reduceMotion: boolean;
  extendedTime: boolean;
}
interface SettingsContextValue extends Settings {
  /** reduceMotion OR the system setting */
  motionOff: boolean;
  setReduceMotion: (v: boolean) => void;
  setExtendedTime: (v: boolean) => void;
}

const KEY = "skillquest.settings";
const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const systemReduced = useReducedMotion();
  const [settings, setSettings] = useState<Settings>({ reduceMotion: false, extendedTime: false });

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings((s) => ({ ...s, ...JSON.parse(raw) })))
      .catch(() => {});
  }, []);

  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        motionOff: settings.reduceMotion || systemReduced,
        setReduceMotion: (v) => update({ reduceMotion: v }),
        setExtendedTime: (v) => update({ extendedTime: v }),
      }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be inside SettingsProvider");
  return ctx;
}
