/**
 * KeyValue — #4420 Graphite Glass (spec §3.2). Label–value lines (a receipt,
 * a summary). `separator` draws a hairline above a row; `total` makes the
 * row the emphasised total line. Values never wrap under their label: the
 * label shrinks first (no bleed-outs).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, space, type } from "../../constants/designSystem";

export interface KeyValueItem {
  key: string;
  label: string;
  value: string;
  separator?: boolean;
  total?: boolean;
  /** Muted value (e.g. "None"). */
  muted?: boolean;
}

export interface KeyValueProps {
  items: readonly KeyValueItem[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const KeyValue: React.FC<KeyValueProps> = ({ items, testID, style }) => (
  <View style={[styles.root, style]} testID={testID}>
    {items.map((item) => (
      <View key={item.key} style={[styles.row, item.separator ? styles.separator : null]}>
        <Text style={[styles.label, item.total ? styles.totalText : null]} numberOfLines={2}>
          {item.label}
        </Text>
        <Text
          style={[styles.value, item.muted ? styles.muted : null, item.total ? styles.totalText : null]}
          numberOfLines={1}
        >
          {item.value}
        </Text>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  root: { gap: space[2] },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space[4] },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: space[3],
    marginTop: space[1],
  },
  label: { ...type.small, color: color.text2, flexShrink: 1 },
  value: { ...type.small, color: color.text1, fontWeight: "600", flexShrink: 0 },
  muted: { color: color.text3, fontWeight: "400" },
  totalText: { ...type.row, color: color.text1 },
});

export default KeyValue;
