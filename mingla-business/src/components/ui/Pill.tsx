/**
 * Pill — small chip primitive.
 *
 * Six variants (`live | draft | warn | accent | error | info`) each map to
 * a tinted background, a fixed border colour, and a 6×6 status dot. With
 * `livePulse` the dot breathes (scale 1.0 ↔ 1.4) over 1.5s. Reduce-motion
 * collapses to opacity 0.5 ↔ 1.0, no scale.
 */

import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
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
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type PillVariant = "live" | "draft" | "warn" | "accent" | "error" | "info";

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

const VARIANT_TOKENS: Record<PillVariant, VariantTokens> = {
  live: {
    background: semantic.successTint,
    border: "rgba(34, 197, 94, 0.45)",
    dot: semantic.success,
    text: textTokens.primary,
  },
  draft: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "rgba(255, 255, 255, 0.14)",
    dot: textTokens.tertiary,
    text: textTokens.secondary,
  },
  warn: {
    background: semantic.warningTint,
    border: "rgba(245, 158, 11, 0.45)",
    dot: semantic.warning,
    text: textTokens.primary,
  },
  accent: {
    background: accent.tint,
    border: accent.border,
    dot: accent.warm,
    text: textTokens.primary,
  },
  error: {
    background: semantic.errorTint,
    border: "rgba(239, 68, 68, 0.45)",
    dot: semantic.error,
    text: textTokens.primary,
  },
  info: {
    background: semantic.infoTint,
    border: "rgba(59, 130, 246, 0.45)",
    dot: semantic.info,
    text: textTokens.primary,
  },
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
            fontSize: typography.micro.fontSize,
            lineHeight: typography.micro.lineHeight,
            fontWeight: typography.micro.fontWeight,
            letterSpacing: typography.micro.letterSpacing,
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
    gap: spacing.xs + 2, // 6px between dot + text
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

export default Pill;
