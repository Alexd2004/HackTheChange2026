// Shared pixel-art pieces (landing, upload, building, level): background, text style, panels, buttons, tile bar.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Image, Pressable, Text, View, type ImageSourcePropType, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { pixelColors as c, pixelFont } from "@/lib/theme";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export const font = (fontSize: number, color: string = c.wood): TextStyle => ({
  fontFamily: pixelFont,
  fontSize,
  lineHeight: fontSize * 1.15,
  color,
});

/** Big text that sits directly on grass: needs the outline shadow to stay readable. */
export const outlined = (fontSize: number, color: string = c.cream): TextStyle => ({
  ...font(fontSize, color),
  textShadowColor: c.outline,
  textShadowOffset: { width: 3, height: 3 },
  textShadowRadius: 0,
});

export const field = {
  backgroundColor: c.cream,
  borderWidth: 2,
  borderColor: c.wood,
} as const;

export const panel: ViewStyle = {
  backgroundColor: c.parchment,
  borderWidth: 4,
  borderColor: c.wood,
  boxShadow: `5px 5px 0 ${c.outline}`,
};

// Pixel flowers/tufts: [left %, top %, color].
const dots: [number, number, string][] = [
  [8, 8, "#F6A6D8"],
  [86, 14, "#FFFFFF"],
  [12, 30, c.grassDark],
  [80, 38, "#F6A6D8"],
  [6, 56, "#FFFFFF"],
  [88, 62, c.grassDark],
  [14, 80, "#F6A6D8"],
  [78, 88, "#FFFFFF"],
  [40, 4, c.grassDark],
  [62, 20, "#FFFFFF"],
  [24, 44, "#F6A6D8"],
  [94, 32, c.grassDark],
  [26, 94, "#FFFFFF"],
  [2, 70, c.grassDark],
  [92, 76, "#F6A6D8"],
  [52, 94, c.grassDark],
];

// One tuft centered on a 1536×1024 canvas; the frame crops to the tuft plus its glow.
const grassSheet: Sheet = { src: require("../../assets/maps sprites/extra grass.png"), w: 1536, h: 1024 };
const tuft: Frame = { x: 520, y: 340, w: 500, h: 350 };
// Scattered tufts: [left %, top %, width px]. Kept to the edges so they don't crowd the content.
const tufts: [number, number, number][] = [
  [4, 4, 56], [70, 6, 44], [30, 16, 36], [86, 24, 52], [2, 40, 44],
  [84, 48, 40], [8, 66, 52], [74, 72, 56], [36, 88, 44], [88, 90, 36],
];

/** Grass background with pixel flowers; `grass` adds sprite tufts (landing + upload share it so the hand-off is seamless). */
export function PixelBackground({ children, grass }: { children: ReactNode; grass?: boolean }) {
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: c.grass }} edges={["top", "bottom"]}>
      <View
        className="absolute inset-0"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {dots.map(([l, t, color], i) => (
          <View
            key={`d${i}`}
            className="absolute h-3 w-3"
            style={{ left: `${l}%`, top: `${t}%`, backgroundColor: color }}
          />
        ))}
        {grass &&
          tufts.map(([l, t, w], i) => (
            <View key={`t${i}`} style={{ position: "absolute", left: `${l}%`, top: `${t}%` }}>
              <Sprite sheet={grassSheet} frame={tuft} width={w} />
            </View>
          ))}
      </View>
      {children}
    </SafeAreaView>
  );
}

/** Decorative icon: hidden from screen readers because the text next to it says the same thing. */
export function Icon({ name, size = 22, color = c.wood }: { name: IconName; size?: number; color?: string }) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      aria-hidden
    />
  );
}

type Variant = "primary" | "secondary" | "danger";
const variants: Record<Variant, { bg: string; border: string; text: string }> = {
  primary: { bg: c.gold, border: c.outline, text: c.outline },
  secondary: { bg: c.cream, border: c.wood, text: c.wood },
  danger: { bg: c.red, border: c.outline, text: c.cream },
};

/** Chunky button that presses down into its shadow. */
export function PixelButton({
  label, onPress, disabled, variant = "primary", icon, hint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  icon?: IconName;
  hint?: string;
}) {
  const v = variants[variant];
  const big = variant !== "secondary";
  const depth = big ? 5 : 3;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}>
      {({ pressed }) => (
        <View
          className={`${big ? "min-h-[56px]" : "min-h-[48px]"} flex-row items-center justify-center gap-2 px-4`}
          style={{
            backgroundColor: disabled ? c.stone : v.bg,
            borderWidth: big ? 4 : 3,
            borderColor: disabled ? c.stoneDark : v.border,
            boxShadow: pressed || disabled ? "none" : `0 ${depth}px 0 ${c.outline}`,
            transform: [{ translateY: pressed && !disabled ? depth : 0 }],
          }}>
          {icon && <Icon name={icon} size={big ? 26 : 22} color={disabled ? c.stoneDark : v.text} />}
          <Text style={font(big ? 28 : 22, disabled ? c.stoneDark : v.text)}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export interface Sheet {
  src: ImageSourcePropType;
  w: number;
  h: number;
}
/** Frame rectangle on a sheet, in sheet pixels. */
export type Frame = { x: number; y: number; w: number; h: number };

/** One frame of a sprite sheet, scaled to `width`. Decorative: the parent carries the accessibility label. */
export function Sprite({ sheet, frame, width }: { sheet: Sheet; frame: Frame; width: number }) {
  const s = width / frame.w;
  return (
    <View style={{ width, height: frame.h * s, overflow: "hidden" }} pointerEvents="none">
      <Image
        source={sheet.src}
        style={{ position: "absolute", left: -frame.x * s, top: -frame.y * s, width: sheet.w * s, height: sheet.h * s }}
      />
    </View>
  );
}

/** Horizontal bar of square tiles. Without `height` the tiles are square. */
export function TileBar({
  filled, total, color = c.gold, height, label,
}: { filled: number; total: number; color?: string; height?: number; label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: filled }}
      className="w-full flex-row gap-1 p-1"
      style={{ backgroundColor: c.parchment, borderWidth: 3, borderColor: c.outline }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className={height ? "flex-1" : "flex-1 aspect-square"}
          style={{ height, backgroundColor: i < filled ? color : "transparent" }}
        />
      ))}
    </View>
  );
}
