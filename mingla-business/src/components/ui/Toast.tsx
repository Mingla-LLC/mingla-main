/**
 * Toast — top-of-screen notification banner.
 *
 * 4 kinds (success/error/warn/info) each map to a leading icon + tinted
 * accent strip. Auto-dismiss timing per kind: success/info 2600ms,
 * warning 6000ms, error persistent (caller must close).
 *
 * Slide-down + opacity entrance 220ms `easings.out`; exit 160ms
 * `easings.in`. Reduce-motion fallback: opacity-only.
 *
 * Stacks via the layout it lives in — Toast itself is one banner; a
 * container is responsible for stacking with 8px gap (host pattern is
 * deferred to a future cycle).
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
  withTiming,
} from "react-native-reanimated";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastProps {
  visible: boolean;
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ENTRY_DURATION = 220;
const EXIT_DURATION = 160;
const TRANSLATE_FROM = -40;

interface KindTokens {
  icon: IconName;
  accent: string;
}

const KIND_TOKENS: Record<ToastKind, KindTokens> = {
  success: { icon: "check", accent: semantic.success },
  error: { icon: "close", accent: semantic.error },
  warn: { icon: "flag", accent: semantic.warning },
  info: { icon: "bell", accent: semantic.info },
};

const AUTO_DISMISS: Record<ToastKind, number | null> = {
  success: 2600,
  info: 2600,
  warn: 6000,
  error: null,
};

export const Toast: React.FC<ToastProps> = ({
  visible,
  kind,
  message,
  onDismiss,
  testID,
  style,
}) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TRANSLATE_FROM);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
      if (!reduceMotion) {
        translateY.value = withTiming(0, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
      } else {
        translateY.value = 0;
      }
    } else {
      opacity.value = withTiming(0, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) });
      if (!reduceMotion) {
        translateY.value = withTiming(TRANSLATE_FROM, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) });
      }
    }
  }, [opacity, reduceMotion, translateY, visible]);

  useEffect(() => {
    if (!visible) return;
    const ms = AUTO_DISMISS[kind];
    if (ms === null) return;
    const timer = setTimeout(onDismiss, ms);
    return (): void => clearTimeout(timer);
  }, [kind, onDismiss, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
    };
  }, [opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const tokens = KIND_TOKENS[kind];

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.wrap, animatedStyle, style]}
      testID={testID}
    >
      <GlassCard variant="elevated" padding={0} style={styles.card}>
        <View style={[styles.accentStrip, { backgroundColor: tokens.accent }]} />
        <View style={styles.body}>
          <Icon name={tokens.icon} size={20} color={tokens.accent} />
          <Text style={styles.message} numberOfLines={3}>
            {message}
          </Text>
        </View>
      </GlassCard>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 480,
    paddingHorizontal: spacing.md,
  },
  card: {
    flexDirection: "row",
    overflow: "hidden",
  },
  accentStrip: {
    width: 4,
    alignSelf: "stretch",
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  message: {
    flex: 1,
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.body.fontWeight,
  },
});

export default Toast;
