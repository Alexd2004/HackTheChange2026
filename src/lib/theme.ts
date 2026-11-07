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

// Pixel-art palette (landing + upload), borrowed from the quest map.
export const pixelFont = "Jersey25_400Regular";
export const pixelColors = {
  grass: "#5DA03A",
  grassDark: "#3F7A27",
  dirt: "#D9965B",
  dirtEdge: "#A8673A",
  gold: "#FFD34D",
  outline: "#2B1A0E",
  parchment: "#F4E4BC",
  cream: "#FFF8E6",
  wood: "#4A2E1A",
  stone: "#C9CDD3",
  stoneDark: "#6B717A",
  red: "#9E2B25",
} as const;

export const levelColor = (type: LevelType) => colors[type];

export const levelTypeLabel: Record<LevelType, string> = {
  normal: "Level",
  challenge: "Challenge",
  boss: "Boss",
};
