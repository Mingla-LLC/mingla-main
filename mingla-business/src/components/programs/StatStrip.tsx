/**
 * #3872 round 2 — the one compact strip of up to three numbers. Its own
 * module so the brand page can show it without loading the Creator and
 * Referral program kit (ProgramKit re-exports it for program screens).
 *
 * #3872 Promote polish:
 * - 16pt top/bottom inside the card (it now actually applies on web, see
 *   GlassCard), cells 12pt apart from their dividers, labels top-aligned and
 *   two lines tall so every value shares one baseline.
 * - `tone: "muted"` shows a value in the quiet tertiary colour (zeros, so an
 *   all-zero strip reads calm instead of shouting "nothing" three times).
 *   Spend is never green.
 * - `layout="wide"` (desktop) left-aligns each cell, puts the label above
 *   the value and uses the larger stat type.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassCard } from "../ui/GlassCard";
import {
  glass,
  typography,
  text as textTokens,
} from "../../constants/designSystem";
import { stripItems } from "./programLayout";

export type StatStripItem = {
  value: string;
  label: string;
  onPress?: () => void;
  accessibilityHint?: string;
  /** "muted" = quiet tertiary value colour (zeros). */
  tone?: "muted";
};

export function StatStrip({
  items,
  layout = "compact",
}: {
  items: ReadonlyArray<StatStripItem | null | undefined | false>;
  /** "wide" = desktop: left-aligned cells, label above value. */
  layout?: "compact" | "wide";
}): React.ReactElement {
  const shown = stripItems(items);
  const wide = layout === "wide";
  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={0}
      contentStyle={wide ? styles.stripWide : styles.strip}
    >
      {shown.map((item, index) => {
        const value = (
          <Text
            key="value"
            style={[
              styles.stripValue,
              wide && styles.stripValueWide,
              item.tone === "muted" && styles.stripValueMuted,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {item.value}
          </Text>
        );
        const label = (
          <Text
            key="label"
            style={[styles.stripLabel, wide && styles.stripLabelWide]}
            numberOfLines={2}
          >
            {item.label}
          </Text>
        );
        const body = wide ? [label, value] : [value, label];
        const cellStyle = [
          styles.stripCell,
          wide && styles.stripCellWide,
          index > 0 && styles.stripDivider,
        ];
        return item.onPress ? (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.value}`}
            accessibilityHint={item.accessibilityHint}
            style={({ pressed }) => [...cellStyle, pressed && styles.pressed]}
          >
            {body}
          </Pressable>
        ) : (
          <View
            key={item.label}
            style={cellStyle}
            accessible
            accessibilityLabel={`${item.label}: ${item.value}`}
          >
            {body}
          </View>
        );
      })}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", paddingVertical: 16 },
  stripWide: { flexDirection: "row", paddingVertical: 20 },
  stripCell: {
    flex: 1,
    // `minWidth: 0` lets a long value ellipsize on web, where
    // `adjustsFontSizeToFit` does nothing.
    minWidth: 0,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 4,
  },
  stripCellWide: { paddingHorizontal: 24, alignItems: "flex-start", gap: 6 },
  stripDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: glass.border.profileElevated,
  },
  stripValue: {
    color: textTokens.primary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    maxWidth: "100%",
  },
  stripValueWide: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
  },
  stripValueMuted: { color: textTokens.tertiary },
  stripLabel: {
    ...typography.caption,
    color: textTokens.secondary,
    textAlign: "center",
    // Two lines tall so a one-line label ("Spent") and a two-line label
    // ("Sold via promotion") leave every value on the same baseline.
    minHeight: 32,
  },
  stripLabelWide: { fontSize: 13, lineHeight: 18, textAlign: "left", minHeight: 0 },
  pressed: { opacity: 0.85 },
});
