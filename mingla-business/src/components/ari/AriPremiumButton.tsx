/**
 * #3355 — Ari-only premium perimeter treatment.
 *
 * The fill and interaction behavior remain owned by Mingla's canonical Button.
 * The moving gradient is clipped to a 1.5 px shell around it and is kept out
 * of the shared Button primitive so public routes do not pay for Ari motion.
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "../ui/Button";
import { radius } from "../../constants/designSystem";

export interface AriPremiumButtonProps extends ButtonProps {
  edgeEffect?: "animatedGradient";
}

const EDGE_WIDTH = 1.5;
const SIZE_HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };

const EDGE_GRADIENTS: Record<
  ButtonVariant,
  readonly [string, string, string, string, string, string, string]
> = {
  primary: ["#a74317", "#eb7825", "#fff7ef", "#ffb27b", "#54210e", "#eb7825", "#a74317"],
  secondary: ["#4b5058", "#f7f7f8", "#eb7825", "#777e88", "#15171b", "#f7f7f8", "#4b5058"],
  ghost: ["#55230e", "#eb7825", "#fff7ef", "#ffb27b", "#55230e", "#eb7825", "#55230e"],
  destructive: ["#7f1d1d", "#ef4444", "#fff1f2", "#fb7185", "#450a0a", "#ef4444", "#7f1d1d"],
  step: ["#111318", "#eb7825", "#ffffff", "#8b929c", "#111318", "#eb7825", "#111318"],
  destructiveOutline: ["#7f1d1d", "#ef4444", "#fff1f2", "#fb7185", "#450a0a", "#ef4444", "#7f1d1d"],
};

export const AriPremiumButton: React.FC<AriPremiumButtonProps> = ({
  edgeEffect,
  variant = "primary",
  size = "md",
  shape = "pill",
  fullWidth = false,
  disabled = false,
  loading = false,
  style,
  testID,
  ...buttonProps
}) => {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const [measuredWidth, setMeasuredWidth] = useState(160);
  const hasAnimatedEdge = edgeEffect === "animatedGradient";

  useEffect(() => {
    if (!hasAnimatedEdge) {
      progress.value = 0;
      return;
    }

    cancelAnimation(progress);
    if (disabled || reduceMotion) {
      progress.value = 0.5;
      return;
    }

    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: loading ? 1300 : 3600,
        easing: Easing.linear,
      }),
      -1,
      true,
    );

    return () => cancelAnimation(progress);
  }, [disabled, hasAnimatedEdge, loading, progress, reduceMotion]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: measuredWidth * progress.value }],
  }));

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const width = Math.max(160, Math.round(event.nativeEvent.layout.width));
    setMeasuredWidth((current) => (current === width ? current : width));
  }, []);

  if (!hasAnimatedEdge) {
    return (
      <Button
        {...buttonProps}
        variant={variant}
        size={size}
        shape={shape}
        fullWidth={fullWidth}
        disabled={disabled}
        loading={loading}
        style={style}
        testID={testID}
      />
    );
  }

  const borderRadius = shape === "pill" ? radius.full : radius.md;
  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.shell,
        {
          minHeight: SIZE_HEIGHT[size] + EDGE_WIDTH * 2,
          borderRadius,
          alignSelf: fullWidth ? "stretch" : "auto",
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
      testID={testID ? `${testID}-edge` : undefined}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.gradientTrack,
          {
            left: -measuredWidth,
            width: measuredWidth * 3,
          },
          sweepStyle,
        ]}
      >
        <LinearGradient
          colors={EDGE_GRADIENTS[variant]}
          locations={[0, 0.16, 0.3, 0.48, 0.65, 0.82, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Button
        {...buttonProps}
        variant={variant}
        size={size}
        shape={shape}
        fullWidth
        disabled={disabled}
        loading={loading}
        testID={testID}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  shell: {
    position: "relative",
    justifyContent: "center",
    padding: EDGE_WIDTH,
    overflow: "hidden",
    backgroundColor: "#24272d",
  },
  gradientTrack: {
    position: "absolute",
    top: -24,
    bottom: -24,
  },
});

export default AriPremiumButton;
