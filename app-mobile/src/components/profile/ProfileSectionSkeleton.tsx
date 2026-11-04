// #4265 — Profile section placeholders that hold the section's final space while
// its first load runs, so sections no longer pop in and push each other down
// (approved loading design, Profile column: neutral blocks, 1.4 s shimmer
// between 55% and 100% opacity, static when Reduce Motion is on).
//
// They show only when a section has nothing to render yet; with the persisted
// cache that is the very first open on a phone.
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { glass } from "../../constants/designSystem";
import { useA11yPreferences } from "../../hooks/useA11yPreferences";

const SHIMMER_HALF_MS = 700;
// Widths of the chip placeholders: about two rows of the real chips.
const CHIP_WIDTHS = [104, 128, 92, 116, 84];

function useShimmer(): Animated.Value {
  const { reduceMotion } = useA11yPreferences();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: SHIMMER_HALF_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: SHIMMER_HALF_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return opacity;
}

/** Placeholder for the interests chips (same chip height and gaps as the real row). */
export function ProfileChipsSkeleton(): React.ReactElement {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[styles.chips, { opacity }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      testID="profile-chips-skeleton"
    >
      {CHIP_WIDTHS.map((width) => (
        <View key={width} style={[styles.chip, { width }]} />
      ))}
    </Animated.View>
  );
}

/** Placeholder for settings-style rows (icon circle, label, two-line description). */
export function ProfileRowsSkeleton({ rows = 1 }: { rows?: number }): React.ReactElement {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={{ opacity }}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      testID="profile-rows-skeleton"
    >
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, index < rows - 1 && styles.rowBorder]}>
          <View style={styles.icon} />
          <View style={styles.lines}>
            <View style={[styles.line, styles.lineLabel]} />
            <View style={[styles.line, styles.lineBody]} />
            <View style={[styles.line, styles.lineBodyShort]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: glass.profile.chip.rowGap,
    columnGap: glass.profile.chip.columnGap,
  },
  chip: {
    height: glass.profile.chip.height,
    borderRadius: glass.profile.chip.radius,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: glass.profile.settingsRow.verticalPadding,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: glass.profile.settingsRow.rowDivider,
  },
  icon: {
    width: glass.profile.settingsRow.iconCircleSize,
    height: glass.profile.settingsRow.iconCircleSize,
    borderRadius: glass.profile.settingsRow.iconCircleRadius,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginRight: 12,
  },
  lines: { flex: 1, gap: 6 },
  line: { borderRadius: 6 },
  // Label 15 pt, description 13 pt over two lines — the "Earn with Mingla" row.
  lineLabel: { height: 14, width: "46%", backgroundColor: "rgba(255, 255, 255, 0.08)" },
  lineBody: { height: 12, width: "88%", backgroundColor: "rgba(255, 255, 255, 0.05)" },
  lineBodyShort: { height: 12, width: "64%", backgroundColor: "rgba(255, 255, 255, 0.05)" },
});
