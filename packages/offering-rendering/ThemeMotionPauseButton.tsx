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
  testID?: string;
}

export const useMotionPaused = (): boolean =>
  useSyncExternalStore(motionPauseStore.subscribe, motionPauseStore.get, motionPauseStore.get);

export const ThemeMotionPauseButton: React.FC<ThemeMotionPauseButtonProps> = ({
  theme,
  style,
  testID,
}) => {
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
      style={[styles.hit, style]}
      testID={testID ?? "theme-motion-pause"}
    >
      <View style={styles.disc}>
        {paused ? (
          <View style={styles.play} />
        ) : (
          <View style={styles.bars}>
            <View style={styles.bar} />
            <View style={styles.bar} />
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
