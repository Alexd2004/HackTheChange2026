/** @type {import('tailwindcss').Config} */
// SkillQuest design tokens. Dark "game night" theme, one accent per level type.
// Every text/background pair here meets WCAG AA contrast on `ink`/`panel`.
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // "class" (not the default "media") stops NativeWind on web from throwing
  // "Cannot manually set color scheme". The app is always dark; we never use dark: classes.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "#0E1116", // app background
        panel: "#171B22", // cards
        raised: "#1F2530", // inputs, pressed cards
        line: "#2A313D", // borders
        fg: "#EEF1F5", // main text
        muted: "#9AA4B2", // secondary text
        brand: "#B8F35B", // primary actions, XP, match %
        normal: "#5AB0FF",
        challenge: "#F5B83D",
        boss: "#FF6B78",
        good: "#4ADE80",
        bad: "#FF8A8A",
      },
    },
  },
  plugins: [],
};
