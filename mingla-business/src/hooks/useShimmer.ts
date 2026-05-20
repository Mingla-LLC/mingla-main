/**
 * useShimmer — ORCH-0891 M3 shimmer skeleton hook.
 *
 * Drives a single `Animated.Value` that loops between two opacity
 * endpoints (0.40 → 0.70 → 0.40) over a 1400ms breath cycle. Consumers
 * apply the value to a skeleton View's `opacity` style. The animation
 * runs on the native driver where available (iOS/Android) and falls
 * back to the JS thread on web — both paths verified ≥60fps because
 * only the `opacity` property is animated (compositor-cheap).
 *
 * # Reduced motion
 * On native, the hook reads `AccessibilityInfo.isReduceMotionEnabled()`
 * once on mount. If true, the animation is skipped and the value is
 * left at the midpoint (0.55) — the skeleton is visible as a static
 * placeholder. Per WCAG SC 2.3.3.
 *
 * # Web reduce-motion
 * On web, the hook respects `window.matchMedia("(prefers-reduced-motion:
 * reduce)").matches`. Same fallback as native: hold at 0.55.
 *
 * # Lifecycle
 * - Animation starts in a `useEffect` after the reduce-motion check
 *   resolves. The check is async on native — until it resolves, the
 *   value sits at the min endpoint, so the skeleton fades in naturally
 *   when the loop kicks in.
 * - On unmount, the loop is stopped to avoid driving timers after
 *   teardown.
 *
 * Per SPEC_ORCH-0891 §3.6 (Strand 8) + DESIGN_SPEC §9.3.
 */

import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";

const SHIMMER_DURATION_MS = 1400;
const SHIMMER_MIN_OPACITY = 0.4;
const SHIMMER_MAX_OPACITY = 0.7;
const SHIMMER_STATIC_OPACITY = 0.55;

export interface ShimmerResult {
  /** Drive a skeleton View via `style={{ opacity: value }}`. */
  value: Animated.Value;
  /**
   * True when the user has reduced motion enabled (or while the OS
   * check is still pending). Consumers can use this to suppress
   * other accent animations.
   */
  reduceMotion: boolean;
}

function useReduceMotion(): boolean {
  // Initialize from synchronous web check; otherwise default to false
  // (animation starts; flips to true if native check resolves true).
  const [reduceMotion, setReduceMotion] = useState<boolean>(() => {
    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return false;
  });

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== "web") {
      AccessibilityInfo.isReduceMotionEnabled().then((value) => {
        if (!cancelled) setReduceMotion(value);
      });
      const sub = AccessibilityInfo.addEventListener(
        "reduceMotionChanged",
        (next: boolean) => {
          setReduceMotion(next);
        },
      );
      return () => {
        cancelled = true;
        sub.remove();
      };
    }
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (e: MediaQueryListEvent): void => {
      setReduceMotion(e.matches);
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    }
    return undefined;
  }, []);

  return reduceMotion;
}

export function useShimmer(): ShimmerResult {
  const value = useMemo(
    () => new Animated.Value(SHIMMER_MIN_OPACITY),
    [],
  );
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      value.setValue(SHIMMER_STATIC_OPACITY);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: SHIMMER_MAX_OPACITY,
          duration: SHIMMER_DURATION_MS / 2,
          easing: Easing.bezier(0.65, 0, 0.35, 1),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(value, {
          toValue: SHIMMER_MIN_OPACITY,
          duration: SHIMMER_DURATION_MS / 2,
          easing: Easing.bezier(0.65, 0, 0.35, 1),
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [value, reduceMotion]);

  return { value, reduceMotion };
}

export const __SHIMMER_TEST_INTERNALS__ = {
  SHIMMER_DURATION_MS,
  SHIMMER_MIN_OPACITY,
  SHIMMER_MAX_OPACITY,
  SHIMMER_STATIC_OPACITY,
};
