/**
 * ClaimAdoptionBanner — ORCH-1263 DESIGN §5.1 (the reveal moment).
 *
 * Replaces the create-path poolBanner caption in claim mode. Full card on
 * first paint (c0); collapses to a one-liner after c0 — the reveal earns its
 * 88pt once, on step 6 it would be furniture. `n` is LIVE MATH (count of
 * steps c0–c8 whose adopted payload passes validation), never a constant;
 * n ≤ 2 swaps to the sparse copy (no number bragging).
 *
 * M-1: entry fade/rise 260ms; the collapse is a cross-fade (200ms) — the
 * measured-height arm of M-1 is intentionally approximated by the cross-fade
 * (reanimated layout builders are a proven web-crash hazard, ORCH-1211).
 * Reduced motion: instant renders/swaps (the DESIGN's stated fallback).
 */

import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  durations,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { CLAIM_FILLABLE_TOTAL } from "../venueWizardValidation";
import { GlassCard } from "../../ui/GlassCard";
import { Icon } from "../../ui/Icon";

/** Pure body-copy rule (T-B8): sparse places never get number bragging. */
export function adoptionBannerBody(filledCount: number): string {
  if (filledCount <= 2) {
    return "We've filled in what we have — the rest is yours.";
  }
  return `${filledCount} of ${CLAIM_FILLABLE_TOTAL} steps are filled from your listing. Keep what's right, fix what's not.`;
}

export interface ClaimAdoptionBannerProps {
  venueName: string;
  /** Live count of steps c0–c8 whose adopted payload passes validation. */
  filledCount: number;
  /** One-liner variant after c0 (the full card only on first paint). */
  collapsed: boolean;
  testID?: string;
}

export const ClaimAdoptionBanner: React.FC<ClaimAdoptionBannerProps> = ({
  venueName,
  filledCount,
  collapsed,
  testID,
}) => {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : 8);
  const mounted = useRef(false);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      translateY.value = 0;
      mounted.current = true;
      return;
    }
    if (!mounted.current) {
      mounted.current = true;
      opacity.value = withTiming(1, { duration: durations.entry });
      translateY.value = withTiming(0, { duration: durations.entry });
      return;
    }
    // Collapse/expand cross-fade (M-1 collapse arm, approximated).
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: durations.normal });
  }, [collapsed, opacity, reduceMotion, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (collapsed) {
    return (
      <Animated.View
        style={[styles.host, styles.collapsedRow, animStyle]}
        testID={testID}
      >
        <Icon name="sparkle" size={14} color={accent.warm} />
        <Text style={styles.collapsedText} numberOfLines={1}>
          {filledCount} of {CLAIM_FILLABLE_TOTAL} filled from your listing
        </Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.host, animStyle]}
      testID={testID}
      accessibilityLiveRegion="polite"
    >
      <GlassCard variant="base" radius="lg" padding={spacing.md}>
        <View style={styles.titleRow}>
          <Icon name="sparkle" size={18} color={accent.warm} />
          <Text style={styles.title} numberOfLines={1}>
            We already know {venueName}
          </Text>
        </View>
        <Text style={styles.body}>{adoptionBannerBody(filledCount)}</Text>
      </GlassCard>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  host: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  collapsedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  collapsedText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.secondary,
  },
});

export default ClaimAdoptionBanner;
