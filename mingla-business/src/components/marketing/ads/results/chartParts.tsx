/**
 * #4238 wave 2 — small shared parts for the Host ad results charts: the
 * plot sizing rule and the visually hidden web table that mirrors a chart
 * for screen readers (the SVG itself is hidden from them).
 */

import React from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

/** Plot width units; height 132 at phone width, 160 at 768 px or wider. */
export const PLOT_WIDTH = 340;
export const RIGHT_GUTTER = 40;
const WIDE = 768;

export function usePlotHeight(): number {
  const { width } = useWindowDimensions();
  return width >= WIDE ? 160 : 132;
}

export function HiddenWebTable(props: {
  caption: string;
  rows: readonly string[];
}): React.ReactElement | null {
  if (Platform.OS !== "web") return null;
  return (
    <View style={styles.hidden} accessibilityRole="list" accessibilityLabel={props.caption}>
      {props.rows.map((row) => (
        <Text key={row}>{row}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
