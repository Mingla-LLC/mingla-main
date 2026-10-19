/**
 * #3040 Appendix A §10 (motion) and §11 (accessibility) for the cover upload
 * sheet and the trip-day tiles.
 *
 * Every animation here has the design's reduced-motion variant, chosen by the
 * device's own "reduce motion" setting (`useReduceMotion`). The pure helpers
 * (`MOTION_SPEC`, `announceBucket`, `uploadAnnouncement`, `progressValueText`,
 * `prefersStackedActions`) carry the numbers and the rules, so they are tested
 * without a renderer. Built on React Native's own `Animated` and
 * `LayoutAnimation` only — no native module is added (OTA-deliverable).
 */

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  findNodeHandle,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { MOTION_SPEC, useReduceMotion } from "../../hooks/useMotionPreferences";

// The shared motion numbers and preference hooks live in
// `hooks/useMotionPreferences` (also used by the trip-day tiles); this module
// holds the cover sheet's own animated pieces.
export { MOTION_SPEC, useIosAnnouncement, useReduceMotion } from "../../hooks/useMotionPreferences";

/** Design easing curves (designSystem `easings`) as RN Animated easings. */
const EASE_OUT = Easing.bezier(0.33, 1, 0.68, 1);
const EASE_IN = Easing.bezier(0.32, 0, 0.67, 0);
const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

const useNative = Platform.OS !== "web";

/** Determinate bar: scaleX eases to the new value (200, ease-out); reduced → jump. */
export const AnimatedProgressFill: React.FC<{
  fraction: number;
  style: StyleProp<ViewStyle>;
}> = ({ fraction, style }) => {
  const reduce = useReduceMotion();
  const clamped = Math.max(0, Math.min(1, fraction));
  const scale = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    if (reduce) {
      scale.setValue(clamped);
      return undefined;
    }
    const animation = Animated.timing(scale, {
      toValue: clamped,
      duration: MOTION_SPEC.determinateBar.durationMs,
      easing: EASE_OUT,
      useNativeDriver: useNative,
    });
    animation.start();
    return () => animation.stop();
  }, [clamped, reduce, scale]);
  return <Animated.View style={[style, { transform: [{ scaleX: scale }] }]} />;
};

/** Fades its children in on mount and whenever `swapKey` changes. */
export const FadeOnChange: React.FC<{
  swapKey: string | number;
  durationMs: number;
  reducedMs: number;
  translateY?: number;
  /** false → the first render shows at once; only later changes fade. */
  animateInitial?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}> = ({ swapKey, durationMs, reducedMs, translateY = 0, animateInitial = true, style, children }) => {
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(animateInitial ? 0 : 1)).current;
  const offset = useRef(new Animated.Value(animateInitial ? translateY : 0)).current;
  const firstRun = useRef(true);
  useEffect(() => {
    const initial = firstRun.current;
    firstRun.current = false;
    const duration = reduce ? reducedMs : durationMs;
    if (duration <= 0 || (initial && !animateInitial)) {
      opacity.setValue(1);
      offset.setValue(0);
      return undefined;
    }
    opacity.setValue(0);
    offset.setValue(reduce ? 0 : translateY);
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, easing: EASE_OUT, useNativeDriver: useNative }),
      Animated.timing(offset, { toValue: 0, duration, easing: EASE_OUT, useNativeDriver: useNative }),
    ]);
    animation.start();
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animateInitial only matters on the first run
  }, [durationMs, offset, opacity, reduce, reducedMs, swapKey, translateY]);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: offset }] }]}>
      {children}
    </Animated.View>
  );
};

/**
 * Upload card enter (260, opacity + rise 8) and exit (180, opacity, then the
 * height closes with LayoutAnimation). Reduced motion: opacity 120 both ways.
 * Keeps the last content mounted while it fades out.
 */
export const CardPresence: React.FC<{
  visible: boolean;
  children: React.ReactNode;
}> = ({ visible, children }) => {
  const reduce = useReduceMotion();
  const [mounted, setMounted] = useState(visible);
  const lastChildren = useRef<React.ReactNode>(children);
  if (visible) lastChildren.current = children;
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const offset = useRef(new Animated.Value(0)).current;
  const lastVisible = useRef<boolean | null>(null);
  useEffect(() => {
    // Only a change of `visible` animates; a reduce-motion read does not replay it.
    if (lastVisible.current === visible) {
      // A re-run that is not a change settles at the end state (a stopped
      // animation must never leave the card half-faded).
      if (visible) {
        opacity.setValue(1);
        offset.setValue(0);
      } else {
        opacity.setValue(0);
        setMounted(false);
      }
      return undefined;
    }
    lastVisible.current = visible;
    if (visible) {
      setMounted(true);
      const duration = reduce ? MOTION_SPEC.cardEnter.reducedMs : MOTION_SPEC.cardEnter.durationMs;
      opacity.setValue(0);
      offset.setValue(reduce ? 0 : MOTION_SPEC.cardEnter.translateY);
      const enter = Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration, easing: EASE_OUT, useNativeDriver: useNative }),
        Animated.timing(offset, { toValue: 0, duration, easing: EASE_OUT, useNativeDriver: useNative }),
      ]);
      enter.start();
      return () => enter.stop();
    }
    const duration = reduce ? MOTION_SPEC.cardExit.reducedMs : MOTION_SPEC.cardExit.durationMs;
    const exit = Animated.timing(opacity, { toValue: 0, duration, easing: EASE_IN, useNativeDriver: useNative });
    exit.start(({ finished }) => {
      if (!finished) return;
      if (!reduce) LayoutAnimation.configureNext(LayoutAnimation.create(duration, "easeInEaseOut", "opacity"));
      setMounted(false);
    });
    return () => exit.stop();
  }, [offset, opacity, reduce, visible]);
  if (!mounted && !visible) return null;
  return (
    <Animated.View style={{ opacity, transform: [{ translateY: offset }] }}>
      {visible ? children : lastChildren.current}
    </Animated.View>
  );
};

/** Inline confirm ↔ actions: LayoutAnimation 200 on the swap; reduced → instant. */
export const animateInlineConfirmSwap = (reduce: boolean): void => {
  if (reduce) return;
  LayoutAnimation.configureNext(
    LayoutAnimation.create(MOTION_SPEC.inlineConfirm.durationMs, "easeInEaseOut", "opacity"),
  );
};

/** Stepper segment: fills from the left (260, ease-out) when it becomes current. */
export const StepperSegmentFill: React.FC<{
  active: boolean;
  style: StyleProp<ViewStyle>;
}> = ({ active, style }) => {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || reduce) {
      scale.setValue(1);
      return undefined;
    }
    scale.setValue(0);
    const animation = Animated.timing(scale, {
      toValue: 1,
      duration: MOTION_SPEC.stepperSegment.durationMs,
      easing: EASE_OUT,
      useNativeDriver: useNative,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduce, scale]);
  return <Animated.View style={[style, { transformOrigin: "left", transform: [{ scaleX: scale }] }]} />;
};

/** H-10 offline nudge: ±4 translateX, 3 cycles, 240 ms total; reduced → none. */
export const NudgeOnSignal: React.FC<{
  signal: number;
  children: React.ReactNode;
}> = ({ signal, children }) => {
  const reduce = useReduceMotion();
  const shift = useRef(new Animated.Value(0)).current;
  const lastSignal = useRef(signal);
  useEffect(() => {
    const fresh = signal !== lastSignal.current;
    lastSignal.current = signal;
    if (!fresh || signal <= 0 || reduce) {
      shift.setValue(0);
      return undefined;
    }
    const { totalMs, cycles, distance } = MOTION_SPEC.offlineNudge;
    const leg = totalMs / (cycles * 2);
    const legs: Animated.CompositeAnimation[] = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      legs.push(
        Animated.timing(shift, { toValue: distance, duration: leg / 2, easing: EASE_IN_OUT, useNativeDriver: useNative }),
        Animated.timing(shift, { toValue: -distance, duration: leg, easing: EASE_IN_OUT, useNativeDriver: useNative }),
      );
    }
    legs.push(Animated.timing(shift, { toValue: 0, duration: leg / 2, easing: EASE_IN_OUT, useNativeDriver: useNative }));
    const animation = Animated.sequence(legs);
    animation.start();
    return () => animation.stop();
  }, [reduce, shift, signal]);
  return <Animated.View style={{ transform: [{ translateX: shift }] }}>{children}</Animated.View>;
};

/** H-15 badge pop: scale 0.6 → 1 on a spring; reduced → no pop. */
export const PopOnSignal: React.FC<{
  signal: string | null;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}> = ({ signal, style, children }) => {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const lastSignal = useRef<string | null>(signal);
  useEffect(() => {
    const fresh = signal !== lastSignal.current;
    lastSignal.current = signal;
    if (!fresh || signal === null || reduce) {
      scale.setValue(1);
      return undefined;
    }
    const { from, mass, stiffness, damping } = MOTION_SPEC.badgePop;
    scale.setValue(from);
    const animation = Animated.spring(scale, { toValue: 1, mass, stiffness, damping, useNativeDriver: useNative });
    animation.start();
    return () => animation.stop();
  }, [reduce, scale, signal]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
};

// ---------------------------------------------------------------------------
// Accessibility (§11)

/** % is announced only at 25 / 50 / 75 / 100 — the step reached, or null. */
export const announceBucket = (percent: number | null): 25 | 50 | 75 | 100 | null => {
  if (percent === null || !Number.isFinite(percent)) return null;
  const step = Math.floor(Math.max(0, Math.min(100, percent)) / 25) * 25;
  return step === 0 ? null : (step as 25 | 50 | 75 | 100);
};

/** What the card's polite live region holds: the title, plus % at the steps. */
export const uploadAnnouncement = (title: string, percent: number | null): string => {
  const bucket = announceBucket(percent);
  return bucket === null ? title : `${title}, ${bucket} percent`;
};

const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/** Progressbar value text: "42 percent, 7.1 of 16.8 megabytes". */
export const progressValueText = (
  percent: number,
  confirmedBytes: number | null | undefined,
  totalBytes: number | null | undefined,
): string => {
  const pct = `${Math.round(percent)} percent`;
  if (typeof totalBytes !== "number" || totalBytes <= 0) return pct;
  const sent = typeof confirmedBytes === "number" && confirmedBytes > 0 ? confirmedBytes : 0;
  return `${pct}, ${megabytes(sent)} of ${megabytes(totalBytes)} megabytes`;
};

/**
 * Focus moves to the card title ONCE when a needs-action state (alert role)
 * replaces an active one, so a screen reader lands on what to do next.
 */
export const useFocusOnAlertEntry = (
  ref: React.RefObject<unknown>,
  stateId: string,
  isAlert: boolean,
): void => {
  const previous = useRef<{ stateId: string; isAlert: boolean } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { stateId, isAlert };
    if (!isAlert || before === null || before.isAlert || before.stateId === stateId) return;
    const target = ref.current as { focus?: () => void } | null;
    if (Platform.OS === "web") {
      target?.focus?.();
      return;
    }
    const node = target ? findNodeHandle(target as never) : null;
    if (node !== null && typeof AccessibilityInfo.setAccessibilityFocus === "function") {
      AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [isAlert, ref, stateId]);
};

/**
 * Dynamic Type (§3): two-up actions fall back to stacked when a label could
 * truncate — at accessibility text sizes, or when the half-width column is too
 * narrow for the longest label at the current scale.
 */
export const prefersStackedActions = (input: {
  wide: boolean;
  fontScale: number;
  sheetWidth: number;
  longestLabelChars: number;
}): boolean => {
  if (!input.wide) return true;
  if (input.fontScale >= 1.35) return true;
  // buttonLg ≈ 16 pt; an average glyph is ~0.55 em; 18 pt icon + 8 gap + 40 padding.
  const columnWidth = (input.sheetWidth - 8) / 2;
  const needed = input.longestLabelChars * 16 * 0.55 * input.fontScale + 18 + 8 + 40;
  return needed > columnWidth;
};
