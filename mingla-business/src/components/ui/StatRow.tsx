/**
 * StatRow — #4420 Graphite Glass (spec §3.2). Two to four numbers in one pane,
 * divided by hairlines (the kit's `MoneyStrip`). Each cell: value over label.
 * Cells share the row equally (`minmax(0, 1fr)`): a long value shrinks its
 * font, never pushes a neighbour off the card.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, space, type } from "../../constants/designSystem";

import { GlassCard } from "./GlassCard";

export interface StatRowItem {
  key: string;
  label: string;
  value: string;
}

export interface StatRowProps {
  items: readonly StatRowItem[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const StatRow: React.FC<StatRowProps> = ({ items, testID, style }) => (
  <GlassCard padding={0} style={style} testID={testID} contentStyle={styles.row}>
    {items.slice(0, 4).map((item, index) => (
      <View key={item.key} style={[styles.cell, index > 0 ? styles.divider : null]}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {item.value}
        </Text>
        <Text style={styles.label} numberOfLines={1}>
          {item.label}
        </Text>
      </View>
    ))}
  </GlassCard>
);

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  cell: { flex: 1, minWidth: 0, paddingVertical: space[4], paddingHorizontal: space[4], gap: space[1] },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: color.line },
  value: { ...type.stat, color: color.text1 },
  label: { ...type.caption, color: color.text3 },
});

export default StatRow;
