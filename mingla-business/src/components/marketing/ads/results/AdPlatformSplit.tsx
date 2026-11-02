/**
 * #4238 wave 2 — spend per app, capsule bars, the app name always in text
 * (colour is never the only signal) and the result count on the right.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  hostAdCharts,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../constants/designSystem";
import { formatHostAdMoneyCents } from "../hostAdMoney";
import { platformName } from "../hostAdCopy";
import type { PlatformBar } from "./adResultsSeries";

export function platformSplitLabel(bars: readonly PlatformBar[], resultLabel: string): string {
  return `Spend by app: ${bars
    .map((bar) => `${platformName(bar.platform)} ${formatHostAdMoneyCents(bar.cents, bar.currency) ?? "—"}, ${bar.results} ${resultLabel}`)
    .join("; ")}.`;
}

export function AdPlatformSplit(props: {
  bars: readonly PlatformBar[];
  resultLabel: string;
}): React.ReactElement | null {
  if (props.bars.length < 2) return null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={platformSplitLabel(props.bars, props.resultLabel)}
      testID="ad-platform-split"
      style={styles.list}
    >
      {props.bars.map((bar) => {
        const color =
          hostAdCharts.platform[bar.platform as keyof typeof hostAdCharts.platform] ??
          textTokens.tertiary;
        return (
          <View key={bar.platform} style={styles.row}>
            <View style={styles.labels}>
              <Text style={styles.name} numberOfLines={1}>{platformName(bar.platform)}</Text>
              <Text style={styles.value} numberOfLines={1}>
                {`${formatHostAdMoneyCents(bar.cents, bar.currency) ?? "—"} · ${bar.results}`}
              </Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.max(2, Math.round(bar.share * 100))}%`, backgroundColor: color },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginTop: spacing.md },
  row: { gap: spacing.xs },
  labels: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  name: { ...typography.bodySm, color: textTokens.primary, flexShrink: 1 },
  value: { ...typography.bodySm, color: textTokens.secondary, flexShrink: 1, textAlign: "right" },
  track: { height: 8, borderRadius: radius.full, backgroundColor: glass.border.profileElevated, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.full },
});
