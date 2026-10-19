/**
 * #3040 Appendix A §10/§11 — the motion numbers and the two accessibility
 * preferences every upload surface shares (the cover sheet and the trip-day
 * tiles): the device's reduce-motion setting, and iOS announcements.
 * React Native core only — no native module (OTA-deliverable).
 */
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { durations } from "../constants/designSystem";

/**
 * Appendix A §10, row by row. `reduced` is the reduced-motion variant: a
 * duration in ms (opacity only), or 0 for "instant / jump / none".
 */
export const MOTION_SPEC = {
  determinateBar: { durationMs: durations.normal, reducedMs: 0 },
  indeterminateBar: { durationMs: 1400, reducedMs: 0 },
  cardTitle: { durationMs: durations.fast, reducedMs: 0 },
  stepperSegment: { durationMs: durations.entry, reducedMs: 0 },
  cardEnter: { durationMs: durations.entry, reducedMs: durations.fast, translateY: 8 },
  cardExit: { durationMs: durations.exit, reducedMs: durations.fast },
  coverSwap: { durationMs: durations.slow, reducedMs: durations.fast },
  badgePop: { from: 0.6, mass: 1, stiffness: 260, damping: 18 },
  inlineConfirm: { durationMs: durations.normal, reducedMs: 0 },
  offlineNudge: { totalMs: 240, cycles: 3, distance: 4, reducedMs: 0 },
  galleryRing: { durationMs: durations.normal, reducedMs: 0 },
} as const;

/** The device's reduce-motion setting, live (null until read = full motion). */
export const useReduceMotion = (): boolean => {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduce(enabled === true);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (enabled: boolean) => setReduce(enabled === true),
    );
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);
  return reduce;
};

/**
 * iOS has no polite live region: it announces only when told. Announce the
 * text whenever it changes (it changes only on a phase change or a % step).
 * Android and web read the visually hidden live-region Text instead.
 */
export const useIosAnnouncement = (text: string | null): void => {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "ios" || text === null || text === last.current) return;
    last.current = text;
    AccessibilityInfo.announceForAccessibility?.(text);
  }, [text]);
};

