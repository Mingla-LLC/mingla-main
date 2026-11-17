/**
 * Meter — #4420 Graphite Glass (spec §3.2). Capacity / progress bar.
 * Progress is one of the few places orange is allowed (`color.accent`).
 * `value` is clamped to [0, max].
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";

export interface MeterProps {
  value: number;
  max: number;
  /** Optional label left and value text right, above the bar. */
  label?: string;
  valueLabel?: string;
  /** `accent` (default, progress) or `neutral` (a quiet capacity bar). */
  tone?: "accent" | "neutral";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const meterFraction = (value: number, max: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
};

export const Meter: React.FC<MeterProps> = ({ value, max, label, valueLabel, tone = "accent", testID, style }) => {
  const fraction = meterFraction(value, max);
  return (
    <View
      style={[styles.root, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.max(0, max), now: Math.min(Math.max(0, value), Math.max(0, max)) }}
      accessibilityLabel={label}
    >
      {label !== undefined || valueLabel !== undefined ? (
        <View style={styles.head}>
          {label !== undefined ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : <View />}
          {valueLabel !== undefined ? <Text style={styles.value}>{valueLabel}</Text> : null}
        </View>
      ) : null}
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${fraction * 100}%`, backgroundColor: tone === "accent" ? color.accent : color.text2 },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: space[2] },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space[3] },
  label: { ...type.small, color: color.text2, flexShrink: 1 },
  value: { ...type.caption, color: color.text1 },
  track: { height: 6, borderRadius: radius.full, backgroundColor: color.fill.step, overflow: "hidden" },
  fill: { height: 6, borderRadius: radius.full },
});

export default Meter;
