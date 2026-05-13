/**
 * ComposerSentConfirmation — full-screen overlay shown after Schedule /
 * Send-now succeeds. Explicit user-acknowledged dismissal (no auto-dismiss)
 * — the operator taps "View in Campaigns" (primary, navigates to the list)
 * or "Stay here" (secondary, just closes the overlay).
 *
 * Card uses a solid dark background (NOT the translucent profile tint)
 * so it reads as a confident "you're done" surface, not as a glass
 * peek-through.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  if (!visible) return null;
  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Icon name="check" size={36} color={textTokens.primary} />
        </View>
        <Text style={styles.title}>
          {isSendNow ? "On the way." : "Scheduled."}
        </Text>
        <Text style={styles.body}>
          {isSendNow
            ? "Your campaign goes out in under a minute. Refresh Campaigns to watch the status flip to Sent."
            : "We'll fire it off at the time you picked."}
        </Text>
        <Pressable
          onPress={onViewInCampaigns}
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
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Stay on this screen"
          style={({ pressed }) => [
            styles.dismissBtn,
            pressed ? styles.dismissBtnPressed : null,
          ]}
        >
          <Text style={styles.dismissLabel}>Stay here</Text>
        </Pressable>
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
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
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
