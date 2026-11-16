// issue #1023 — the pause/play control for the theme entrance motion
// (WCAG 2.2.2: anything that moves for more than 5 s can be paused).
//
// One paused flag per device (motionPauseStore), so this button can live
// wherever it is reachable: inline on the layer, or — on pages whose cover is
// pinned BEHIND the scrolling body — in the scroll content over the cover.
// Hidden when the theme has no motion or the person asked for reduced motion.

import React, { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { motionPauseStore } from "./themeMotionPauseStore";
import { useReduceMotionPreference } from "./useReduceMotionPreference";
import { useThemeMotionSlug } from "./useThemeMotionSlug";

export interface ThemeMotionPauseButtonProps {
  theme: ResolvedTheme;
  style?: StyleProp<ViewStyle>;
  /**
   * issue #4420 — "chrome": a 40pt frosted circle matching the header's close
   * and share buttons; "plain": no circle, glyph in `glyphColor` (the solid
   * glass header). Absent ⇒ the original 32pt disc, unchanged.
   */
  tone?: "default" | "chrome" | "plain";
  glyphColor?: string;
  testID?: string;
}

export const useMotionPaused = (): boolean =>
  useSyncExternalStore(motionPauseStore.subscribe, motionPauseStore.get, motionPauseStore.get);

export const ThemeMotionPauseButton: React.FC<ThemeMotionPauseButtonProps> = ({
  theme,
  style,
  tone = "default",
  glyphColor = "#ffffff",
  testID,
}: ThemeMotionPauseButtonProps) => {
  const slug = useThemeMotionSlug(theme.animation);
  const reduceMotion = useReduceMotionPreference();
  const paused = useMotionPaused();
  React.useEffect(() => {
    void motionPauseStore.hydrate();
  }, []);
  if (slug === "none" || reduceMotion) return null;
  return (
    <Pressable
      onPress={() => motionPauseStore.set(!paused)}
      accessibilityRole="button"
      accessibilityLabel={paused ? "Play animation" : "Pause animation"}
      accessibilityState={{ selected: paused }}
      hitSlop={6}
      style={[tone === "default" ? styles.hit : styles.hitChrome, style]}
      testID={testID ?? "theme-motion-pause"}
    >
      <View
        style={
          tone === "default"
            ? styles.disc
            : tone === "chrome"
              ? styles.discChrome
              : styles.discPlain
        }
      >
        {paused ? (
          <View style={[styles.play, { borderLeftColor: glyphColor }]} />
        ) : (
          <View style={styles.bars}>
            <View style={[styles.bar, { backgroundColor: glyphColor }]} />
            <View style={[styles.bar, { backgroundColor: glyphColor }]} />
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  // 44 × 44 hit target around a 32 pt disc
  hit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  disc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(12,14,18,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  // issue #4420 — header tones.
  hitChrome: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  discChrome: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
  },
  discPlain: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  bars: { flexDirection: "row", gap: 4 },
  bar: { width: 3, height: 11, borderRadius: 1.5, backgroundColor: "#ffffff" },
  play: {
    marginLeft: 3,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#ffffff",
  },
});
