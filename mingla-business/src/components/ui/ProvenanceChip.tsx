/**
 * ProvenanceChip — ORCH-1263 [claim-adoption] DESIGN §3.
 *
 * The ONE provenance system of the claim walkthrough: a non-interactive
 * micro-chip that travels — field label rows, photo tiles, review rows — with
 * one anatomy everywhere. Deliberately DOTLESS so it can never be misread as a
 * ListingStatusChip (the status chip's 8×8 dot is its signature).
 *
 * States:
 *   adopted → "On Mingla"  (success family — live listing content, kept)
 *   edited  → "Edited"     (neutral — adopted then changed)
 *   new     → "New"        (info family — operator-added, pending review)
 * A `label` override exists for the ONE divergent text ("Suggested", c8).
 *
 * Non-interactive and `accessible={false}` — its text joins the HOST row's
 * accessibilityLabel (e.g. "Phone, from your existing listing").
 *
 * Motion: M-3 (state flip cross-fades in place, 120ms linear) + M-7 (entrance
 * fade/rise after the step settles). Both collapse to instant renders under
 * reduced motion. Built with a component-scoped reanimated style — NEVER a
 * module-top-level builder (ORCH-1211 web-crash lesson).
 */

import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import {
  durations,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type ProvenanceChipState = "adopted" | "edited" | "new";

export interface ProvenanceChipProps {
  state: ProvenanceChipState;
  /** Text override for the c8 "Suggested" variant (info family). */
  label?: string;
  /** Photo-tile overlay variant — composites a dark scrim behind the tint. */
  scrim?: boolean;
  /** M-7 entrance delay (ms) after the step transition settles. */
  entranceDelayMs?: number;
  testID?: string;
}

const STATE_TOKENS: Record<
  ProvenanceChipState,
  { label: string; color: string; bg: string }
> = {
  adopted: {
    label: "On Mingla",
    color: semantic.success,
    bg: semantic.successTint,
  },
  edited: {
    label: "Edited",
    color: textTokens.secondary,
    bg: "rgba(255,255,255,0.10)",
  },
  new: { label: "New", color: semantic.info, bg: semantic.infoTint },
};

export const ProvenanceChip: React.FC<ProvenanceChipProps> = ({
  state,
  label,
  scrim = false,
  entranceDelayMs = 120,
  testID,
}) => {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : 4);
  const mounted = useRef(false);

  // M-7 entrance (mount) + M-3 state-flip cross-fade (state change).
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      translateY.value = 0;
      mounted.current = true;
      return;
    }
    if (!mounted.current) {
      mounted.current = true;
      opacity.value = withDelay(
        entranceDelayMs,
        withTiming(1, { duration: durations.normal }),
      );
      translateY.value = withDelay(
        entranceDelayMs,
        withTiming(0, { duration: durations.normal }),
      );
      return;
    }
    // State flip: fade out/in in place (both labels short — no width jump).
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: durations.fast });
  }, [entranceDelayMs, opacity, reduceMotion, state, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const tokens = STATE_TOKENS[state];
  const pill = (
    <View style={[styles.pill, { backgroundColor: tokens.bg }]}>
      <Animated.Text
        style={[styles.label, { color: tokens.color }, animStyle]}
        numberOfLines={1}
      >
        {label ?? tokens.label}
      </Animated.Text>
    </View>
  );

  if (scrim) {
    return (
      <View
        style={styles.scrim}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        testID={testID}
      >
        {pill}
      </View>
    );
  }
  return (
    <View
      style={styles.host}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {pill}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    alignSelf: "flex-start",
  },
  // Photo-tile overlay: dark scrim behind the tint so contrast holds on a
  // worst-case white photo (DESIGN §3 — ≥4.5:1 via the scrim).
  scrim: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radiusTokens.full,
  },
  pill: {
    borderRadius: radiusTokens.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  label: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
  },
});

export default ProvenanceChip;
