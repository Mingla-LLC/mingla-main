/**
 * #4304 — the Ari orb for Home: AriOrb's three-ring mark and its resting
 * entrance (spring scale 0.7 -> 1, 300 ms fade, rings settled at AriOrb's idle
 * opacity and scale), shown after first paint. Home's orb is always decorative
 * and never "thinking", so this is the whole of what AriOrb draws here.
 *
 * It animates with React Native's own Animated, not reanimated: requiring
 * AriOrb from Home put it in a second web chunk beside Ari's screen, and Metro
 * then hoisted it into the eager __common boot chunk (bundle-baseline-movement).
 * Keep the numbers below in step with src/components/ari/AriOrb.tsx. Until the
 * first effect runs, the still mark with the same geometry shows.
 *
 * Its own file with no text input, so components that only need the orb (the
 * empty-Recent prompt, which scrolls with Home) do not import a TextInput
 * through it (ORCH-0892 / #1841 keyboard gate follows imports).
 */

import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from "react-native";

const ORB_GEOMETRY = { sm: { orb: 24, halo: 3 }, md: { orb: 32, halo: 4 } } as const;
export type HomeAriOrbSize = keyof typeof ORB_GEOMETRY;

function StaticAriMark({ size = "sm" }: { size?: HomeAriOrbSize }): React.ReactElement {
  const { orb, halo } = ORB_GEOMETRY[size];
  return (
    <View
      style={[mark.host, { width: orb, height: orb }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          mark.outer,
          { top: -halo, left: -halo, width: orb + halo * 2, height: orb + halo * 2, borderRadius: (orb + halo * 2) / 2 },
        ]}
      />
      <View style={[mark.middle, { width: orb, height: orb, borderRadius: orb / 2 }]} />
      <View style={[mark.core, { width: orb * 0.46, height: orb * 0.46, borderRadius: orb * 0.23 }]} />
    </View>
  );
}

// AriOrb.tsx — PREMIUM_EASING, the entrance spring and the idle (ripple 0)
// ring values; with reduced motion AriOrb rests at ripple 0.5.
const PREMIUM_EASING = Easing.bezier(0.4, 0.0, 0.2, 1);
const ENTRANCE_SPRING = { damping: 12, stiffness: 180, mass: 0.8 } as const;
const IDLE = { outerOpacity: 0.28, outerScale: 0.95, middleOpacity: 0.7, middleScale: 1, coreScale: 0.96 } as const;
const REDUCED = { outerOpacity: 0.39, outerScale: 0.975, middleOpacity: 0.61, middleScale: 0.985, coreScale: 0.985 } as const;

function AnimatedAriMark({ size, reduceMotion }: { size: HomeAriOrbSize; reduceMotion: boolean }): React.ReactElement {
  const { orb, halo } = ORB_GEOMETRY[size];
  const rest = reduceMotion ? REDUCED : IDLE;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.7)).current;
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const useNativeDriver = Platform.OS !== "web";
    const entrance = Animated.parallel([
      Animated.spring(scale, { toValue: 1, ...ENTRANCE_SPRING, useNativeDriver }),
      Animated.timing(opacity, { toValue: 1, duration: 300, easing: PREMIUM_EASING, useNativeDriver }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [opacity, reduceMotion, scale]);
  const ring = (ringOpacity: number, ringScale: number) => ({
    opacity: Animated.multiply(opacity, ringOpacity),
    transform: [{ scale: Animated.multiply(scale, ringScale) }],
  });
  return (
    <View
      style={[mark.host, { width: orb, height: orb }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="home-ari-orb-animated"
    >
      <Animated.View
        pointerEvents="none"
        style={[
          mark.outer,
          { top: -halo, left: -halo, width: orb + halo * 2, height: orb + halo * 2, borderRadius: (orb + halo * 2) / 2 },
          ring(rest.outerOpacity, rest.outerScale),
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[mark.middle, { width: orb, height: orb, borderRadius: orb / 2 }, ring(rest.middleOpacity, rest.middleScale)]}
      />
      <Animated.View
        pointerEvents="none"
        style={[mark.core, { width: orb * 0.46, height: orb * 0.46, borderRadius: orb * 0.23 }, ring(1, rest.coreScale)]}
      />
    </View>
  );
}

/** #4304 — the still mark on first paint, then AriOrb's entrance. */
export function HomeAriOrb({ size = "sm" }: { size?: HomeAriOrbSize }): React.ReactElement {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {
        // The setting could not be read: animate, as AriOrb does by default.
        if (alive) setReduceMotion(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return reduceMotion === null ? <StaticAriMark size={size} /> : <AnimatedAriMark size={size} reduceMotion={reduceMotion} />;
}

const mark = StyleSheet.create({
  host: { alignItems: "center", justifyContent: "center" },
  outer: { position: "absolute", borderWidth: 1.5, borderColor: "#f07a3d" },
  middle: { position: "absolute", borderWidth: 2, borderColor: "#f07a3d" },
  core: { position: "absolute", borderWidth: 1, borderColor: "#ffb07c", backgroundColor: "#f07a3d" },
});
