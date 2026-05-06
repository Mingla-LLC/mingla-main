/**
 * IconChrome — 36×36 circular glass icon button.
 *
 * Source: `Mingla_Artifacts/design-package/.../chrome.jsx:89–111`.
 *
 * Composed from `GlassChrome` + `Icon`. Active variant pulls accent tint
 * + warm border + warm-glow shadow from `designSystem.shadows.glassChromeActive`.
 * Optional badge dot in the top-right.
 *
 * Press: scale 0.96 over 120ms (`easings.press`). Reduce-motion fallback
 * collapses to opacity 0.7. Light haptic on native press-down.
 */

import React, { useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  durations,
  glass,
  semantic,
  shadows,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { GlassChrome } from "./GlassChrome";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface IconChromeProps {
  icon: IconName;
  /** Numeric badge (top-right corner). Hidden when `0` or `undefined`. */
  badge?: number;
  active?: boolean;
  onPress?: () => void | Promise<void>;
  size?: number;
  disabled?: boolean;
  /**
   * Required per I-38 / I-39 (Cycle 17c). Removed `?? icon` silent fallback —
   * every consumer must provide a human-readable label. CI gate `i39-pressable-label`
   * enforces, TS strict-build enforces.
   */
  accessibilityLabel: string;
  /**
   * Optional override of the primitive's baked-in default `hitSlop`. The default
   * `{top:4,bottom:4,left:4,right:4}` makes the effective touchable area `36 + 4×2 = 44`
   * per side, satisfying WCAG AA + Apple HIG floor (per I-38, Cycle 17c §A.1).
   * Consumer overrides honored verbatim — combined effective extent must remain ≥ 44.
   */
  hitSlop?: PressableProps["hitSlop"];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_SIZE = 36;
const ICON_SIZE_RATIO = 0.5; // 18 of 36
const PRESS_TIMING = { duration: durations.fast } as const;
const BADGE_SIZE = 18;
// Cycle 17c §A.1 — effective touch area = 36 + 4×2 = 44 per side (WCAG AA + Apple HIG floor).
const DEFAULT_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

export const IconChrome: React.FC<IconChromeProps> = ({
  icon,
  badge,
  active = false,
  onPress,
  size = DEFAULT_SIZE,
  disabled = false,
  accessibilityLabel,
  hitSlop = DEFAULT_HIT_SLOP,
  testID,
  style,
}) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const interactive = !disabled && onPress !== undefined;

  const handlePressIn = useCallback((): void => {
    if (!interactive) return;
    if (Platform.OS !== "web") {
      HapticFeedback.buttonPress();
    }
    if (reduceMotion) {
      opacity.value = withTiming(0.7, PRESS_TIMING);
    } else {
      scale.value = withTiming(0.96, PRESS_TIMING);
    }
  }, [interactive, opacity, reduceMotion, scale]);

  const handlePressOut = useCallback((): void => {
    if (reduceMotion) {
      opacity.value = withTiming(1, PRESS_TIMING);
    } else {
      scale.value = withTiming(1, PRESS_TIMING);
    }
  }, [opacity, reduceMotion, scale]);

  const handlePress = useCallback(async (): Promise<void> => {
    if (onPress === undefined) return;
    try {
      await onPress();
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[IconChrome] onPress threw:", error);
      }
    }
  }, [onPress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.32 : opacity.value,
  }));

  const iconSize = Math.round(size * ICON_SIZE_RATIO);
  const showBadge = badge !== undefined && badge > 0;
  const badgeLabel = badge !== undefined && badge > 99 ? "99+" : String(badge);

  const renderInteractive = (
    _state: PressableStateCallbackType,
  ): React.ReactNode => (
    <Animated.View style={animatedStyle}>
      <GlassChrome
        intensity="chrome"
        tint={active ? "idle" : "idle"}
        tintColor={active ? accent.tint : glass.tint.chrome.idle}
        borderColor={active ? accent.border : glass.border.chrome}
        highlightColor={glass.highlight.profileBase}
        shadow={active ? shadows.glassChromeActive : shadows.glassChrome}
        radius="full"
        style={[styles.glass, { width: size, height: size }]}
      >
        <View style={[styles.iconContainer, { width: size, height: size }]}>
          <Icon
            name={icon}
            size={iconSize}
            color={active ? accent.warm : textTokens.primary}
          />
        </View>
      </GlassChrome>
      {showBadge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel} numberOfLines={1}>
            {badgeLabel}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );

  if (!interactive) {
    return (
      <View testID={testID} style={style}>
        {renderInteractive({ pressed: false, hovered: false })}
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={style}
    >
      {renderInteractive}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  glass: {
    overflow: "visible",
  },
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: semantic.error,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: {
    color: textTokens.inverse,
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
  },
});

export default IconChrome;
