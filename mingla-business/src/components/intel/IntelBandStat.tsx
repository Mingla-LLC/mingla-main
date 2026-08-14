import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";

export interface IntelBandStatProps {
  low: number;
  high: number;
  capacity: number;
  benchmark: boolean;
}

export const IntelBandStat: React.FC<IntelBandStatProps> = ({
  low,
  high,
  capacity,
  benchmark,
}) => (
  <View style={styles.row}>
    <View style={styles.copy}>
      <Text style={styles.label}>Expected turnout</Text>
      <Text style={styles.value} testID="turnout-band-value">
        {low}–{high} <Text style={styles.context}>of {capacity}</Text>
      </Text>
    </View>
    <View style={styles.pill}>
      <Text style={styles.pillText}>{benchmark ? "BENCHMARK" : "MODELED"}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  copy: { flex: 1 },
  label: {
    ...typography.labelCap,
    color: text.secondary,
    textTransform: "uppercase",
  },
  value: { ...typography.statValue, color: text.primary, marginTop: 2 },
  context: { ...typography.bodySm, color: text.secondary },
  pill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.badge,
    backgroundColor: glass.tint.badge.idle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pillText: { ...typography.micro, color: text.secondary },
});
