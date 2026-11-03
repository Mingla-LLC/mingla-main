/**
 * #4238 wave 2 — small shared parts for the Host ad results charts: the
 * plot sizing rule and the visually hidden web table that mirrors a chart
 * for screen readers (the SVG itself is hidden from them).
 */

import React, { useCallback, useState } from "react";
import {
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

/** Plot width units; height 132 at phone width, 160 at 768 px or wider. */
export const PLOT_WIDTH = 340;
export const RIGHT_GUTTER = 40;
const WIDE = 768;

export function usePlotHeight(): number {
  const { width } = useWindowDimensions();
  return width >= WIDE ? 160 : 132;
}

/**
 * #4238: the plot's real width in pixels. The SVG viewBox uses this width, so
 * one unit is one pixel at every screen size: a fixed 340-unit viewBox in a
 * 900 px card is letterboxed to the middle while the day labels under it span
 * the whole card, so the line and its labels drift apart (seen at 1280 px).
 */
export function usePlotWidth(): {
  plotWidth: number;
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const [plotWidth, setPlotWidth] = useState(PLOT_WIDTH);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > RIGHT_GUTTER) setPlotWidth((current) => (current === next ? current : next));
  }, []);
  return { plotWidth, onLayout };
}

/** Day labels under a plot: they end where the plot ends (before the gutter). */
export const AXIS_ROW_INSET = { marginRight: RIGHT_GUTTER } as const;

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
