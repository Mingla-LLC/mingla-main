/**
 * #3355 — Ari's cross-platform action control.
 *
 * The interaction borrows the reference's physical press and expanding click
 * ripple, implemented with the app's existing Reanimated runtime. The visual
 * system is intentionally only black, Mingla orange, and white: no shader,
 * gradient, glow, or new web-only dependency.
 */

import React, { useEffect } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type GestureResponderEvent,
} from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type AriActionButtonVariant = "primary" | "secondary" | "danger";

export interface AriActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: AriActionButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export const AriActionButton: React.FC<AriActionButtonProps> = ({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  accessibilityLabel,
}) => {
  const reduceMotion = useReducedMotion();
  const pressScale = useSharedValue(1);
  const pressDepth = useSharedValue(0);
  const rippleScale = useSharedValue(0);
  const rippleOpacity = useSharedValue(0);
  const rippleX = useSharedValue(0);
  const rippleY = useSharedValue(0);

  useEffect(() => () => {
    cancelAnimation(pressScale);
    cancelAnimation(pressDepth);
    cancelAnimation(rippleScale);
    cancelAnimation(rippleOpacity);
  }, [pressDepth, pressScale, rippleOpacity, rippleScale]);

  const shellStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pressDepth.value },
      { scale: pressScale.value },
    ],
  }));

  const rippleStyle = useAnimatedStyle(() => ({
    left: rippleX.value - 10,
    top: rippleY.value - 10,
    opacity: rippleOpacity.value,
    transform: [{ scale: rippleScale.value }],
  }));

  const handlePressIn = (event: GestureResponderEvent): void => {
    if (disabled || reduceMotion) return;
    const { locationX = 0, locationY = 0 } = event.nativeEvent;
    rippleX.value = locationX;
    rippleY.value = locationY;
    rippleScale.value = 0;
    rippleOpacity.value = 0.32;
    rippleScale.value = withTiming(4.8, { duration: 520 });
    rippleOpacity.value = withTiming(0, { duration: 520 });
    pressScale.value = withSpring(0.975, {
      damping: 16,
      stiffness: 280,
      mass: 0.55,
    });
    pressDepth.value = withSpring(1.5, {
      damping: 18,
      stiffness: 300,
      mass: 0.5,
    });
  };

  const handlePressOut = (): void => {
    if (disabled || reduceMotion) return;
    pressScale.value = withSpring(1, {
      damping: 12,
      stiffness: 210,
      mass: 0.65,
    });
    pressDepth.value = withSpring(0, {
      damping: 13,
      stiffness: 230,
      mass: 0.6,
    });
  };

  const variantStyle = variant === "primary"
    ? styles.primary
    : variant === "danger"
      ? styles.danger
      : styles.secondary;
  const textStyle = variant === "primary"
    ? styles.primaryText
    : variant === "danger"
      ? styles.dangerText
      : styles.secondaryText;
  const rippleColor = variant === "primary" ? styles.whiteRipple : styles.orangeRipple;

  return (
    <Animated.View style={[styles.shell, variantStyle, disabled && styles.disabled, shellStyle]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled }}
        style={styles.pressTarget}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.ripple, rippleColor, rippleStyle]}
        />
        <Text style={[styles.label, textStyle]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  shell: {
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1,
    overflow: "hidden",
  },
  primary: {
    backgroundColor: "#f07a3d",
    borderColor: "#f07a3d",
  },
  secondary: {
    backgroundColor: "#0b0c0f",
    borderColor: "rgba(255,255,255,0.24)",
  },
  danger: {
    backgroundColor: "#0b0c0f",
    borderColor: "#f07a3d",
  },
  pressTarget: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    overflow: "hidden",
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: -0.12,
  },
  primaryText: { color: "#090a0c" },
  secondaryText: { color: "#ffffff" },
  dangerText: { color: "#f07a3d" },
  ripple: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  whiteRipple: { backgroundColor: "#ffffff" },
  orangeRipple: { backgroundColor: "#f07a3d" },
  disabled: { opacity: 0.42 },
});

export default AriActionButton;
