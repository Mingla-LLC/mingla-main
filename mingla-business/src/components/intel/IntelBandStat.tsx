import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius,
  space,
  type,
  color,
  materials,
} from "../../constants/designSystem";
import { formatCount } from "../../utils/currency";

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
        {formatCount(low)}–{formatCount(high)}{" "}
        <Text style={styles.context}>of {formatCount(capacity)}</Text>
      </Text>
    </View>
    <View style={styles.pill}>
      <Text style={styles.pillText}>{benchmark ? "BENCHMARK" : "MODELED"}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
  copy: { flex: 1 },
  label: {
    ...type.label,
    color: color.text2,
    textTransform: "uppercase",
  },
  value: { ...type.stat, color: color.text1, marginTop: 2 },
  context: { ...type.small, color: color.text2 },
  pill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: materials.onPhoto.solidFill,
    paddingHorizontal: space[2],
    paddingVertical: 4,
  },
  pillText: { ...type.label, color: color.text2 },
});
