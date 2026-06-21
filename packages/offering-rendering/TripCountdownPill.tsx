/**
 * TripCountdownPill — META-ORCH-1174 Leg A [trip-page-standardize] (NEW, §C.5).
 *
 * The animated live countdown pill in the §4 meta-pills row. Rendered ONLY when
 * `deadlineIso` is present + in the future. Pure-presentational (I-MOR-0827); no
 * fetch/auth. Renders the same solid-fill accent pill as the §4 siblings.
 *
 * Tick cadence tightens as the deadline nears (countdownTickMs):
 *   ≥ 1 day → hourly · ≥ 1 hour → every minute · < 1 hour → every second.
 * Re-derives the interval on every tick (no per-second re-render storm at coarse
 * granularity). Clears the interval on unmount + at the deadline (then renders
 * nothing — the surface flips to the closed band via state).
 *
 * Reduce-motion-aware: when AccessibilityInfo.isReduceMotionEnabled() is on, renders
 * the STATIC coarse date label (no ticking, no interval) — accessibility parity.
 *
 * It is presentational only: reaching 0 does NOT gate the CTA — the bookingsClosed
 * flag + deadline check in useTripOfferingState owns the closed state.
 */

import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "./themePalette";
import {
  countdownTickMs,
  formatCountdown,
  formatDeadlineCoarse,
} from "./tripCountdown";

export interface TripCountdownPillProps {
  /** booking_deadline ISO string. */
  deadlineIso: string;
  palette: ThemePalette;
  fontFamily?: string;
  testID?: string;
}

export const TripCountdownPill: React.FC<TripCountdownPillProps> = ({
  deadlineIso,
  palette,
  fontFamily,
  testID,
}) => {
  const deadlineMs = Date.parse(deadlineIso);
  const valid = Number.isFinite(deadlineMs);

  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [reduceMotionResolved, setReduceMotionResolved] = useState<boolean>(false);
  const [label, setLabel] = useState<string | null>(() =>
    valid ? formatCountdown(deadlineMs, Date.now()) : null,
  );
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve + subscribe to the OS reduce-motion preference.
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) {
        setReduceMotion(value);
        setReduceMotionResolved(true);
      }
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => setReduceMotion(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // The ticking driver — runs ONLY when motion is allowed (resolved + not reduced).
  useEffect(() => {
    if (!valid) return;
    if (!reduceMotionResolved || reduceMotion) return;

    const clear = (): void => {
      if (intervalRef.current !== null) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const tick = (): void => {
      const now = Date.now();
      const next = formatCountdown(deadlineMs, now);
      setLabel(next);
      if (next === null) {
        clear();
        return;
      }
      // Re-derive the cadence each tick so the interval tightens as time runs out.
      intervalRef.current = setTimeout(tick, countdownTickMs(deadlineMs - now));
    };

    tick();
    return clear;
  }, [valid, deadlineMs, reduceMotion, reduceMotionResolved]);

  if (!valid) return null;

  // Reduce-motion → static coarse date label (no ticking, no interval).
  const display =
    reduceMotionResolved && reduceMotion
      ? formatDeadlineCoarse(deadlineIso)
      : label;

  if (display === null) return null;

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.pillText,
          { color: palette.primaryText },
          fontFamily !== undefined ? { fontFamily } : null,
        ]}
      >
        {display}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillText: { fontSize: 13, fontWeight: "700" },
});

export default TripCountdownPill;
