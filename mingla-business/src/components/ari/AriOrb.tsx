/**
 * ORCH-0821 — AriOrb (rework 2026-05-12 — premium pulse + glass feel)
 *
 * Ari's visual signature. A radial-gradient orb (soft peach → coral → ember)
 * with always-on breathing, premium spring entrance, and a glass halo ring.
 *
 * Animation layers:
 *   1. Entrance — spring scale 0.7 → 1.0 with subtle overshoot (300ms)
 *   2. Idle pulse — slow gradient breath (2400ms loop, ease-in-out)
 *   3. Thinking pulse — faster, brighter (1200ms loop)
 *   4. Glass halo — soft outer ring that breathes in counterpoint
 *
 * Reduced motion: skips all animation, renders static gradient.
 * Uses react-native-svg <RadialGradient/> for accurate radial fill.
 * All colors HSL/hex per RN color rule (Cycle 7 FX2 incident).
 */

import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
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

import { ariPalette } from "../../constants/designSystem";

export type AriOrbSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AriOrbSize, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 56,
  xl: 88,
};

// Halo extends past the orb diameter as a percentage
const HALO_MULT_PX: Record<AriOrbSize, number> = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 18,
  xl: 28,
};

const IDLE_PULSE_DURATION_MS = 2400;
const THINKING_PULSE_DURATION_MS = 1200;

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

  // Breathing animation (0 → 1 → 0 loop)
  const breath = useSharedValue(0);

  // Halo breath runs in counterpoint (offset phase)
  const haloBreath = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) {
      entranceScale.value = 1;
      entranceOpacity.value = 1;
      breath.value = 0.5;
      haloBreath.value = 0.5;
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

    // Continuous breathing
    const duration = thinking ? THINKING_PULSE_DURATION_MS : IDLE_PULSE_DURATION_MS;
    breath.value = withRepeat(
      withTiming(1, { duration, easing: PREMIUM_EASING }),
      -1,
      true,
    );
    haloBreath.value = withRepeat(
      withTiming(1, { duration: duration * 1.15, easing: PREMIUM_EASING }),
      -1,
      true,
    );

    return (): void => {
      cancelAnimation(entranceScale);
      cancelAnimation(entranceOpacity);
      cancelAnimation(breath);
      cancelAnimation(haloBreath);
    };
  }, [reduceMotion, thinking, entranceScale, entranceOpacity, breath, haloBreath]);

  // Orb scale subtly breathes from 0.97 → 1.03 (idle) or 0.94 → 1.06 (thinking)
  const orbAnimStyle = useAnimatedStyle(() => {
    const amplitude = thinking ? 0.06 : 0.03;
    const scale = (1 - amplitude) + breath.value * (amplitude * 2);
    return {
      transform: [{ scale: entranceScale.value * scale }],
      opacity: entranceOpacity.value,
    };
  });

  // Halo opacity breathes 0.25 → 0.55 (idle) or 0.4 → 0.75 (thinking)
  const haloAnimStyle = useAnimatedStyle(() => {
    const lo = thinking ? 0.4 : 0.25;
    const hi = thinking ? 0.75 : 0.55;
    const value = lo + haloBreath.value * (hi - lo);
    return {
      opacity: entranceOpacity.value * value,
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
      {/* Glass halo — soft outer ring tinted by the orb color */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            width: dim + halo * 2,
            height: dim + halo * 2,
            borderRadius: (dim + halo * 2) / 2,
            top: -halo,
            left: -halo,
            backgroundColor: ariPalette.glow,
          },
          haloAnimStyle,
        ]}
      />
      {/* Inner glass highlight ring — a thin lighter rim just inside the orb */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.innerRing,
          {
            width: dim,
            height: dim,
            borderRadius: dim / 2,
          },
          orbAnimStyle,
        ]}
      >
        <Svg width={dim} height={dim} viewBox="0 0 100 100">
          <Defs>
            {/* Offset center toward top-left for "lit from upper-left" feel */}
            <RadialGradient
              id={`ari-orb-${size}`}
              cx="36"
              cy="34"
              rx="70"
              ry="70"
              fx="32"
              fy="30"
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0%" stopColor={ariPalette.gold} stopOpacity="1" />
              <Stop offset="55%" stopColor={ariPalette.flame} stopOpacity="1" />
              <Stop offset="100%" stopColor={ariPalette.ember} stopOpacity="1" />
            </RadialGradient>
            {/* Top specular highlight — thin lighter arc at the top */}
            <RadialGradient
              id={`ari-spec-${size}`}
              cx="40"
              cy="22"
              rx="35"
              ry="20"
              fx="40"
              fy="20"
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0%" stopColor="hsl(40, 100%, 92%)" stopOpacity="0.7" />
              <Stop offset="100%" stopColor="hsl(40, 100%, 92%)" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="48" fill={`url(#ari-orb-${size})`} />
          {/* Specular highlight overlay */}
          <Circle cx="50" cy="50" r="48" fill={`url(#ari-spec-${size})`} />
        </Svg>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    ...(Platform.OS === "ios"
      ? {
          shadowColor: ariPalette.flame,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 12,
        }
      : {}),
  },
  innerRing: {
    overflow: "hidden",
  },
});

export default AriOrb;
