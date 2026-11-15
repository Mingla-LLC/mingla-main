/**
 * #4238 wave 2 — spend per app, capsule bars, the app name always in text
 * (colour is never the only signal) and the result count on the right.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color as colorTokens, radius, space, type } from "../../../../constants/designSystem";
import { hostAdCharts } from "./hostAdChartColors";
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
          colorTokens.text3;
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
  list: { gap: space[2], marginTop: space[4] },
  row: { gap: space[1] },
  labels: { flexDirection: "row", justifyContent: "space-between", gap: space[2] },
  name: { ...type.small, color: colorTokens.text1, flexShrink: 1 },
  value: { ...type.small, color: colorTokens.text2, flexShrink: 1, textAlign: "right" },
  track: { height: 8, borderRadius: radius.full, backgroundColor: colorTokens.lineStrong, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.full },
});
