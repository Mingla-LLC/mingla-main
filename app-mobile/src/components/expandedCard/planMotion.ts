/**
 * #4347 wave 3 — the plan sheet's motion, on Reanimated, with every timing from
 * motionTokens.ts. Each hook takes `reduced` (Reduce Motion): the animation is
 * then skipped and the end state is shown at once.
 */
import React from 'react';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { EASE_OUT, EASE_POP, PLAN_MOTION } from './motionTokens';

const easeOut = Easing.bezier(...EASE_OUT);
const easePop = Easing.bezier(...EASE_POP);

/**
 * Enter from an offset and fade in, once, on mount. Under Reduce Motion the
 * value starts at 1 (in place, fully visible) and never animates.
 */
export function useEnterStyle(options: {
  readonly reduced: boolean;
  readonly durationMs: number;
  readonly delayMs?: number;
  readonly fromX?: number;
  readonly fromY?: number;
}) {
  const { reduced, durationMs, delayMs = 0, fromX = 0, fromY = 0 } = options;
  const progress = useSharedValue(reduced ? 1 : 0);
  React.useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delayMs, withTiming(1, { duration: durationMs, easing: easeOut }));
    // Mount-only: an entrance plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: (1 - progress.value) * fromX },
      { translateY: (1 - progress.value) * fromY },
    ],
  }));
}

/** A route stop: pops from 0.4 to 1 and fades in after `delayMs`. */
export function useRouteStopStyle(delayMs: number, reduced: boolean) {
  const progress = useSharedValue(reduced ? 1 : 0);
  React.useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delayMs, withTiming(1, { duration: PLAN_MOTION.routeStopMs, easing: easePop }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value),
    transform: [{ scale: PLAN_MOTION.routeStopFromScale + (1 - PLAN_MOTION.routeStopFromScale) * progress.value }],
  }));
}

/** A route leg: draws left to right after `delayMs`. */
export function useRouteLegStyle(delayMs: number, reduced: boolean) {
  const progress = useSharedValue(reduced ? 1 : 0);
  React.useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delayMs, withTiming(1, { duration: PLAN_MOTION.routeLegMs, easing: easeOut }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    transformOrigin: 'left',
    transform: [{ scaleX: progress.value }],
  }));
}

/** The light pulse a stop card gives after a navigator jump. None under Reduce Motion. */
export function usePulseStyle(seq: number | null, reduced: boolean) {
  const ring = useSharedValue(0);
  React.useEffect(() => {
    if (seq === null || reduced) return;
    const half = Math.round(PLAN_MOTION.pulseMs / 2);
    ring.value = withSequence(withTiming(1, { duration: half }), withTiming(0, { duration: half }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  return useAnimatedStyle(() => ({ opacity: ring.value }));
}

/** Show / hide (the sticky navigator). Instant under Reduce Motion. */
export function useShowStyle(shown: boolean, reduced: boolean, fromY: number) {
  const v = useSharedValue(shown ? 1 : 0);
  React.useEffect(() => {
    v.value = reduced ? (shown ? 1 : 0) : withTiming(shown ? 1 : 0, { duration: PLAN_MOTION.navigatorMs, easing: easeOut });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, reduced]);
  return useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * fromY }],
  }));
}

/**
 * A number that counts to its new value (the times after a swapped stop).
 * Returns the value to show. Under Reduce Motion it jumps.
 */
export function useCountTo(value: number, reduced: boolean, durationMs: number = PLAN_MOTION.swapMs): number {
  const [shown, setShown] = React.useState(value);
  // #4347 wave 3 rework — count from the value ON SCREEN, so a second change
  // during a count continues from where the number is, never jumps back to
  // the previous target first.
  const shownRef = React.useRef(value);
  React.useEffect(() => {
    const show = (next: number): void => {
      shownRef.current = next;
      setShown(next);
    };
    const from = shownRef.current;
    if (reduced || from === value || typeof requestAnimationFrame !== 'function') {
      show(value);
      return;
    }
    const started = Date.now();
    let frame = 0;
    const step = (): void => {
      const p = Math.min(1, (Date.now() - started) / durationMs);
      show(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, durationMs]);
  return shown;
}
