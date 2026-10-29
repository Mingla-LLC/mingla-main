/**
 * ORCH-0821 / #3355 — AriOrb (three-ring kinetic identity)
 *
 * Ari's visual signature is deliberately simple: three crisp orange circles
 * that ripple and bounce without gradients, blur, glow, or spiritual imagery.
 *
 * Animation layers:
 *   1. Entrance — spring scale 0.7 → 1.0 with subtle overshoot (300ms)
 *   2. Outer ring — slow outward ripple
 *   3. Middle ring — counterpoint ripple
 *   4. Core — restrained vertical bounce while thinking
 *
 * Reduced motion renders the same static three-circle mark.
 */

import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type AriOrbSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Orb diameter per size, in px. Exported so a caller that must reason about
 *  the orb's footprint reads these numbers rather than copying them. */
export const SIZE_PX: Record<AriOrbSize, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 72,
  xl: 112,
};

/** How far the halo extends PAST the orb diameter on every side, in px — so
 *  the ink is `SIZE_PX + HALO_MULT_PX * 2` and overflows the layout box by
 *  `HALO_MULT_PX` on each edge. Exported for the same reason. */
export const HALO_MULT_PX: Record<AriOrbSize, number> = {
  xs: 2,
  sm: 3,
  md: 4,
  lg: 7,
  xl: 10,
};

// Smooth, Apple-like easing — slower out, controlled in. Feels "lived in".
const PREMIUM_EASING = Easing.bezier(0.4, 0.0, 0.2, 1);

export interface AriOrbProps {
  size?: AriOrbSize;
  thinking?: boolean;
  accessibilityLabel?: string;
  /** When true, hides this orb from screen readers (use when an outer
   *  bubble already carries the speech role). */
  decorative?: boolean;
}

export const AriOrb: React.FC<AriOrbProps> = ({
  size = "md",
  thinking = false,
  accessibilityLabel,
  decorative = false,
}) => {
  const dim = SIZE_PX[size];
  const halo = HALO_MULT_PX[size];
  const reduceMotion = useReducedMotion();

  // Entrance animation (scale from 0.7 with subtle overshoot)
  const entranceScale = useSharedValue(reduceMotion ? 1 : 0.7);
  const entranceOpacity = useSharedValue(reduceMotion ? 1 : 0);

  // One bounded cycle drives the three-circle choreography in counterpoint.
  const ripple = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      entranceScale.value = 1;
      entranceOpacity.value = 1;
      ripple.value = 0.5;
      return;
    }

    // Entrance — spring scale with subtle overshoot
    entranceScale.value = withSpring(1, {
      damping: 12,
      stiffness: 180,
      mass: 0.8,
    });
    entranceOpacity.value = withTiming(1, {
      duration: 300,
      easing: PREMIUM_EASING,
    });

    if (thinking) {
      ripple.value = 0;
      ripple.value = withRepeat(
        withSpring(1, {
          damping: 9,
          stiffness: 72,
          mass: 0.72,
          overshootClamping: true,
        }),
        -1,
        true,
      );
    } else {
      // Ready/idle marks settle after their spring entrance. A ripple always
      // means Ari is actively working, never generic decoration.
      ripple.value = withSpring(0, {
        damping: 14,
        stiffness: 150,
        mass: 0.7,
      });
    }

    return (): void => {
      cancelAnimation(entranceScale);
      cancelAnimation(entranceOpacity);
      cancelAnimation(ripple);
    };
  }, [reduceMotion, thinking, entranceScale, entranceOpacity, ripple]);

  const outerRingStyle = useAnimatedStyle(() => {
    return {
      opacity: entranceOpacity.value * (0.28 + ripple.value * 0.22),
      transform: [{ scale: entranceScale.value * (0.95 + ripple.value * 0.05) }],
    };
  });

  const middleRingStyle = useAnimatedStyle(() => {
    return {
      opacity: entranceOpacity.value * (0.52 + (1 - ripple.value) * 0.18),
      transform: [{ scale: entranceScale.value * (0.97 + (1 - ripple.value) * 0.03) }],
    };
  });

  const coreStyle = useAnimatedStyle(() => {
    const scale = thinking ? 0.92 + ripple.value * 0.12 : 0.96 + ripple.value * 0.05;
    const translateY = thinking ? -1.5 + ripple.value * 3 : 0;
    return {
      opacity: entranceOpacity.value,
      transform: [
        { translateY },
        { scale: entranceScale.value * scale },
      ],
    };
  });

  return (
    <View
      style={[styles.host, { width: dim, height: dim }]}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={
        decorative
          ? undefined
          : (accessibilityLabel ?? (thinking ? "Ari is thinking" : "Ari"))
      }
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no" : undefined}
    >
      {/* Three circles, no blur or decorative lighting. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.outerRing,
          {
            width: dim + halo * 2,
            height: dim + halo * 2,
            borderRadius: (dim + halo * 2) / 2,
            top: -halo,
            left: -halo,
          },
          outerRingStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.middleRing,
          {
            width: dim,
            height: dim,
            borderRadius: dim / 2,
          },
          middleRingStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.core,
          {
            width: dim * 0.46,
            height: dim * 0.46,
            borderRadius: dim * 0.23,
          },
          coreStyle,
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  outerRing: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: "#f07a3d",
    backgroundColor: "transparent",
  },
  middleRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#f07a3d",
    backgroundColor: "transparent",
  },
  core: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "#ffb07c",
    backgroundColor: "#f07a3d",
  },
});

export default AriOrb;
