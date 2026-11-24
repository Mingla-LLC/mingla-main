/**
 * Pill — the status pill, plus (#4420) the Chip and Segmented controls.
 *
 * Pill variants (`live | draft | warn | accent | error | info`, #4420 adds
 * `ok | muted`) all share ONE neutral graphite body (`fill.status` + hairline)
 * and differ only by the 6×6 dot, so status reads from the dot, never a
 * coloured slab (Graphite Glass). `accent` is the orange "upcoming" dot — one
 * of the few places orange is allowed. With `livePulse` the dot breathes
 * (scale 1.0 ↔ 1.4) over 1.5s; reduce-motion collapses to opacity only.
 *
 * `Chip` (filter / tag, on = selected material) and `Segmented` (2–5
 * options, one line, stretches before it scrolls) are new and additive.
 */

import React, { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  color,
  materials,
  radius as radiusTokens,
  space,
  type,
} from "../../constants/designSystem";
import { useTouchFloor } from "../../hooks/useTouchFloor";

export type PillVariant = "live" | "draft" | "warn" | "accent" | "error" | "info" | "ok" | "muted";

export interface PillProps {
  variant: PillVariant;
  children: React.ReactNode;
  livePulse?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface VariantTokens {
  background: string;
  border: string;
  dot: string;
  text: string;
}

const body = (dot: string, text: string = color.text1): VariantTokens => ({
  background: color.fill.status,
  border: color.line,
  dot,
  text,
});

const VARIANT_TOKENS: Record<PillVariant, VariantTokens> = {
  live: body(color.live),
  draft: body(color.status.neutral, color.text2),
  warn: body(color.warning),
  accent: body(color.accent),
  error: body(color.danger),
  info: body(color.info),
  ok: body(color.success),
  muted: body(color.status.muted, color.text2),
};

const PULSE_DURATION = 1500;
const DOT_SIZE = 6;

export const Pill: React.FC<PillProps> = ({
  variant,
  children,
  livePulse = false,
  testID,
  style,
}) => {
  const dotScale = useSharedValue(1);
  const dotOpacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const tokens = VARIANT_TOKENS[variant];
  const shouldAnimate = livePulse;

  useEffect(() => {
    if (!shouldAnimate) {
      cancelAnimation(dotScale);
      cancelAnimation(dotOpacity);
      dotScale.value = 1;
      dotOpacity.value = 1;
      return;
    }
    if (reduceMotion) {
      dotOpacity.value = withRepeat(
        withTiming(0.5, { duration: PULSE_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      dotScale.value = withRepeat(
        withTiming(1.4, { duration: PULSE_DURATION, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    }
    return (): void => {
      cancelAnimation(dotScale);
      cancelAnimation(dotOpacity);
    };
  }, [dotOpacity, dotScale, reduceMotion, shouldAnimate]);

  const dotStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: dotOpacity.value };
    }
    return { transform: [{ scale: dotScale.value }] };
  });

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: tokens.background,
          borderColor: tokens.border,
        },
        style,
      ]}
    >
      <Animated.View
        style={[styles.dot, { backgroundColor: tokens.dot }, dotStyle]}
      />
      <Text
        style={[
          styles.label,
          {
            color: tokens.text,
            fontSize: type.label.fontSize,
            lineHeight: type.label.lineHeight,
            fontWeight: type.label.fontWeight,
            letterSpacing: type.label.letterSpacing,
          },
        ]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    paddingHorizontal: 10,
    borderRadius: radiusTokens.full,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6, // between dot + text
    alignSelf: "flex-start",
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  label: {
    textTransform: "uppercase",
  },
});

// ---------------------------------------------------------------------------
// #4420 Chip and Segmented
// ---------------------------------------------------------------------------

// Chip lives in its own module (no reanimated) so a screen that only needs a
// chip does not load the animated pill (#4490); re-exported here for callers.
export { Chip, type ChipProps } from "./Chip";

export interface SegmentedOption<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  disabled?: boolean;
  testID?: string;
}

export interface SegmentedProps<K extends string = string> {
  options: readonly SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Stretch the options across the row (kit `.seg.full`). Default true. */
  full?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * One-line 2–5 option switcher (kit `.seg`). It first stretches and tightens;
 * only when it still cannot fit does it scroll inside its own track.
 */
export function Segmented<K extends string = string>({
  options,
  value,
  onChange,
  full = true,
  accessibilityLabel,
  testID,
  style,
}: SegmentedProps<K>): React.ReactElement {
  // #4490: hitSlop does nothing in a phone browser, so the 36 segment is drawn 44 there.
  const touchFloor = useTouchFloor();
  // A stretched segmented control is a plain row, not a horizontal scroll view: on web the
  // scroll view's content ignored the track width, so a long third label ("Not charged")
  // was cut off at the right edge of a 390 phone. Labels wrap to two lines instead.
  const Row: React.ElementType = full ? View : ScrollView;
  const rowProps = full
    ? { style: [chipStyles.segRow, chipStyles.segRowFull] }
    : { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: chipStyles.segRow };
  return (
    <View style={[chipStyles.segTrack, style]} testID={testID} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      <Row {...rowProps}>
        {options.map((option) => {
          const on = option.key === value;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                if (!option.disabled) onChange(option.key);
              }}
              disabled={option.disabled}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled: option.disabled === true }}
              accessibilityLabel={option.count !== undefined ? `${option.label}, ${option.count}` : option.label}
              testID={option.testID}
              style={[chipStyles.seg, touchFloor > 0 ? { minHeight: touchFloor } : null, full ? chipStyles.segFull : null, on ? chipStyles.segOn : null, option.disabled ? chipStyles.disabled : null]}
            >
              <Text style={[chipStyles.segLabel, full ? chipStyles.segLabelFull : null, on ? chipStyles.labelOn : null]} numberOfLines={full ? 2 : 1} adjustsFontSizeToFit={!full} minimumFontScale={0.85}>
                {option.label}
              </Text>
              {option.count !== undefined ? (
                <Text style={[chipStyles.count, on ? chipStyles.segCountOn : null]}>{option.count}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </Row>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  labelOn: { color: color.textStrong },
  count: { ...type.caption, color: color.text3 },
  segTrack: {
    borderRadius: radiusTokens.full,
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    padding: 3,
    overflow: "hidden",
  },
  segRow: { flexDirection: "row", gap: 2 },
  segRowFull: { flexGrow: 1 },
  seg: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    minHeight: 36,
    paddingHorizontal: space[3],
    borderRadius: radiusTokens.full,
  },
  segFull: { flex: 1, minWidth: 0 },
  segOn: {
    backgroundColor: materials.selected.solidFill,
    borderTopWidth: 1,
    borderTopColor: materials.selected.rim.top ?? materials.selected.rim.edge,
  },
  segLabel: { ...type.chip, color: color.text2, flexShrink: 1 },
  segLabelFull: { textAlign: "center" },
  segCountOn: { color: color.textSelectedMeta },
});

export default Pill;
