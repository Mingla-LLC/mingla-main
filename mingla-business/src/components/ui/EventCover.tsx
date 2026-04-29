/**
 * EventCover — hue-driven striped placeholder for missing event imagery.
 *
 * Source: `Mingla_Artifacts/design-package/.../primitives.jsx:101–122`.
 *
 * The web reference uses CSS `repeating-linear-gradient` with `oklch()`
 * values. RN does not support either, so we render the stripe pattern
 * via parallel `<Rect>` elements rotated 45° inside `react-native-svg`,
 * with `oklch(0.55 0.18 hue)` and `oklch(0.50 0.16 hue)` approximated to
 * `hsl(hue, 60%, 45%)` and `hsl(hue, 60%, 40%)` respectively. The dark
 * vignette at the bottom is rendered via `expo-linear-gradient`.
 *
 * Children render on top (overlay slot for play buttons / pills).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Rect, G, ClipPath, Defs } from "react-native-svg";

import { spacing, typography } from "../../constants/designSystem";

export interface EventCoverProps {
  /** Stripe colour hue, 0–360. Default 25 (warm orange). */
  hue?: number;
  /** Container border radius in pixels. Default 16. */
  radius?: number;
  /** Top-left label. Default "Cover" — uppercased on render. */
  label?: string;
  height?: DimensionValue;
  width?: DimensionValue;
  children?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const STRIPE_WIDTH = 14;
const STRIPE_GAP = 14;
const PATTERN_SIZE = 600; // square SVG canvas — wide enough to cover any reasonable cover

const hsl = (hue: number, sat: number, light: number): string =>
  `hsl(${hue}, ${sat}%, ${light}%)`;

export const EventCover: React.FC<EventCoverProps> = ({
  hue = 25,
  radius = 16,
  label = "Cover",
  height = "100%",
  width = "100%",
  children,
  testID,
  style,
}) => {
  const baseColour = hsl(hue, 60, 45);
  const stripeAlt = hsl(hue, 60, 40);
  const stripeBase = hsl(hue, 60, 50);

  // Generate parallel rects rotated 45° to simulate
  // `repeating-linear-gradient(135deg, base 0 14px, alt 14px 28px)`.
  const stripes: React.ReactNode[] = [];
  const total = PATTERN_SIZE * 2;
  for (let offset = -PATTERN_SIZE; offset < total; offset += STRIPE_WIDTH + STRIPE_GAP) {
    stripes.push(
      <Rect
        key={`stripe-${offset}`}
        x={offset}
        y={-PATTERN_SIZE}
        width={STRIPE_WIDTH}
        height={total}
        fill={stripeAlt}
      />,
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        { height, width, borderRadius: radius },
        style,
      ]}
    >
      {/* Base fill */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: baseColour }]}
      />
      {/* Diagonal stripe pattern */}
      <Svg
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${PATTERN_SIZE} ${PATTERN_SIZE}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <ClipPath id="cover-clip">
            <Rect x="0" y="0" width={PATTERN_SIZE} height={PATTERN_SIZE} />
          </ClipPath>
        </Defs>
        <Rect x="0" y="0" width={PATTERN_SIZE} height={PATTERN_SIZE} fill={stripeBase} />
        <G transform={`rotate(45 ${PATTERN_SIZE / 2} ${PATTERN_SIZE / 2})`} clipPath="url(#cover-clip)">
          {stripes}
        </G>
      </Svg>
      {/* Bottom vignette */}
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.72)"]}
        locations={[0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Label */}
      <View style={styles.labelWrap} pointerEvents="none">
        <Text style={styles.label}>{label.toUpperCase()}</Text>
      </View>
      {/* Overlay slot */}
      {children !== undefined ? <View style={styles.overlay}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
  },
  labelWrap: {
    position: "absolute",
    top: spacing.sm + 4,
    left: spacing.sm + 4,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: 0.5,
    color: "rgba(255, 255, 255, 0.55)",
  },
  overlay: {
    flex: 1,
  },
});

export default EventCover;
