// Same colors as tailwind.config.js, for places that need raw values (SVG, Reanimated, status bar).
import type { LevelType } from "./types";

export const colors = {
  ink: "#0E1116",
  panel: "#171B22",
  raised: "#1F2530",
  line: "#2A313D",
  fg: "#EEF1F5",
  muted: "#9AA4B2",
  brand: "#B8F35B",
  normal: "#5AB0FF",
  challenge: "#F5B83D",
  boss: "#FF6B78",
  good: "#4ADE80",
  bad: "#FF8A8A",
} as const;

export const levelColor = (type: LevelType) => colors[type];

export const levelTypeLabel: Record<LevelType, string> = {
  normal: "Level",
  challenge: "Challenge",
  boss: "Boss",
};
