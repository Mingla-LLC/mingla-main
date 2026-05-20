/**
 * ComposerSentConfirmation — full-screen overlay shown after Schedule /
 * Send-now succeeds. Explicit user-acknowledged dismissal (no auto-dismiss)
 * — the operator taps "View in Campaigns" (primary, navigates to the list)
 * or "Stay here" (secondary, just closes the overlay).
 *
 * Card uses a solid dark background (NOT the translucent profile tint)
 * so it reads as a confident "you're done" surface, not as a glass
 * peek-through.
 *
 * ORCH-0891 M3 — Premium animation per DESIGN_SPEC §7:
 *   1. Card slides up + fades in (260ms ease-out).
 *   2. Success icon scales 0.4 → 1.15 → 1.0 with spring-settle.
 *   3. Radial accent.warm pulse (single circle, 0.5 → 3.0 scale, 800ms)
 *      emanates from the icon centre.
 *   4. Title fades in (delayed 200ms after icon).
 *   5. CTAs fade in (delayed 400ms).
 *   6. Native haptic burst (Haptics.notificationAsync(Success)) on mount.
 *
 * Reduced motion fallback: skip all scale/pulse — just fade icon + copy
 * + CTAs at final values per WCAG SC 2.3.3.
 */

import React, { useEffect } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { Icon } from "../ui/Icon";
import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerSentConfirmationProps {
  visible: boolean;
  isSendNow: boolean;
  /** Closes the overlay only — leaves the operator on the composer route. */
  onDismiss: () => void;
  /** Closes the overlay AND navigates to the campaigns list. */
  onViewInCampaigns: () => void;
}

export const ComposerSentConfirmation: React.FC<ComposerSentConfirmationProps> = ({
  visible,
  isSendNow,
  onDismiss,
  onViewInCampaigns,
}) => {
  // Reanimated 4 ships `useReducedMotion` which reads the platform's
  // accessibility setting; on web it falls back to the prefers-reduced-
  // motion media query.
  const reducedMotion = useReducedMotion();

  const iconScale = useSharedValue(reducedMotion ? 1 : 0.4);
  const iconOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const pulseScale = useSharedValue(0.5);
  const pulseOpacity = useSharedValue(reducedMotion ? 0 : 0.5);
  const copyOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const ctaOpacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (!visible) {
      // Reset to entry state so a re-open re-animates from scratch.
      iconScale.value = reducedMotion ? 1 : 0.4;
      iconOpacity.value = reducedMotion ? 1 : 0;
      pulseScale.value = 0.5;
      pulseOpacity.value = reducedMotion ? 0 : 0.5;
      copyOpacity.value = reducedMotion ? 1 : 0;
      ctaOpacity.value = reducedMotion ? 1 : 0;
      return;
    }

    // Native-only haptic burst on mount. Per DESIGN_SPEC §7.1 step 4.
    if (Platform.OS !== "web") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Defensive: also announce the success for screen-reader users.
      AccessibilityInfo.announceForAccessibility(
        isSendNow ? "Campaign sent" : "Campaign scheduled",
      );
    }

    if (reducedMotion) {
      // Reduce-motion path: fade everything in over 200ms with no scale
      // or pulse. Per WCAG SC 2.3.3.
      iconOpacity.value = withTiming(1, { duration: 200 });
      copyOpacity.value = withTiming(1, { duration: 200 });
      ctaOpacity.value = withTiming(1, { duration: 200 });
      return;
    }

    // Icon: scale 0.4 → 1.15 → 1.0, opacity 0 → 1
    iconScale.value = withSequence(
      withTiming(1.15, {
        duration: 200,
        easing: Easing.bezier(0.33, 1, 0.68, 1),
      }),
      withSpring(1.0, { damping: 8, stiffness: 100 }),
    );
    iconOpacity.value = withTiming(1, { duration: 200 });

    // Radial pulse: scale 0.5 → 3.0, opacity 0.5 → 0 over 800ms
    pulseScale.value = withTiming(3.0, {
      duration: 800,
      easing: Easing.bezier(0.33, 1, 0.68, 1),
    });
    pulseOpacity.value = withTiming(0, { duration: 800 });

    // Copy and CTAs stagger in
    copyOpacity.value = withDelay(200, withTiming(1, { duration: 200 }));
    ctaOpacity.value = withDelay(400, withTiming(1, { duration: 200 }));
  }, [
    visible,
    reducedMotion,
    isSendNow,
    iconScale,
    iconOpacity,
    pulseScale,
    pulseOpacity,
    copyOpacity,
    ctaOpacity,
  ]);

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));
  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));
  const copyAnimatedStyle = useAnimatedStyle(() => ({
    opacity: copyOpacity.value,
  }));
  const ctaAnimatedStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
  }));

  if (!visible) return null;
  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconStage}>
          <Animated.View
            pointerEvents="none"
            style={[styles.pulseRing, pulseAnimatedStyle]}
          />
          <Animated.View style={[styles.iconCircle, iconAnimatedStyle]}>
            <Icon name="check" size={36} color={textTokens.primary} />
          </Animated.View>
        </View>
        <Animated.View style={copyAnimatedStyle}>
          <Text style={styles.title}>
            {isSendNow ? "On the way." : "Scheduled."}
          </Text>
          <Text style={styles.body}>
            {isSendNow
              ? "Your campaign goes out in under a minute. Refresh Campaigns to watch the status flip to Sent."
              : "We'll fire it off at the time you picked."}
          </Text>
        </Animated.View>
        <Animated.View style={[styles.ctaStack, ctaAnimatedStyle]}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                void Haptics.selectionAsync();
              }
              onViewInCampaigns();
            }}
            accessibilityRole="button"
            accessibilityLabel="View in Campaigns"
            style={({ pressed }) => [
              styles.ctaBtn,
              pressed ? styles.ctaBtnPressed : null,
            ]}
          >
            <Text style={styles.ctaLabel}>View in Campaigns →</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                void Haptics.selectionAsync();
              }
              onDismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel="Stay on this screen"
            style={({ pressed }) => [
              styles.dismissBtn,
              pressed ? styles.dismissBtnPressed : null,
            ]}
          >
            <Text style={styles.dismissLabel}>Stay here</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    zIndex: 999,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    padding: spacing.xl,
    borderRadius: radius.xl,
    // Solid dark card — not the translucent profile tint. Operators need
    // this to feel like a definitive "done" confirmation, not a peek-
    // through panel that the composer is still half-visible behind.
    backgroundColor: "#15171c",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    gap: spacing.sm,
  },
  // ORCH-0891 M3 — stage hosts both the radial pulse + the scale-in
  // icon circle. Pulse is absolutely positioned behind the icon.
  iconStage: {
    width: 72,
    height: 72,
    marginBottom: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: accent.warm,
  },
  ctaStack: {
    width: "100%",
    alignItems: "center",
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  ctaBtn: {
    marginTop: spacing.md,
    width: "100%",
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    ...typography.body,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  dismissBtn: {
    marginTop: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissBtnPressed: {
    opacity: 0.7,
  },
  dismissLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "500",
  },
});
