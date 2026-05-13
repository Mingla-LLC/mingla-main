/**
 * ComposerSentConfirmation — full-screen overlay shown after Schedule /
 * Send-now succeeds. Auto-dismisses after 3s or on CTA tap.
 */

import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "../ui/Icon";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerSentConfirmationProps {
  visible: boolean;
  isSendNow: boolean;
  onDismiss: () => void;
  onViewInCampaigns: () => void;
  autoDismissMs?: number;
}

export const ComposerSentConfirmation: React.FC<ComposerSentConfirmationProps> = ({
  visible,
  isSendNow,
  onDismiss,
  onViewInCampaigns,
  autoDismissMs = 3000,
}) => {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [visible, autoDismissMs, onDismiss]);

  if (!visible) return null;
  return (
    <View style={styles.host} pointerEvents="box-none">
      <View style={styles.card}>
        <Icon name="check" size={40} color={accent.warm} />
        <Text style={styles.title}>
          {isSendNow ? "Sent." : "Scheduled."}
        </Text>
        <Text style={styles.body}>
          {isSendNow
            ? "Your campaign is on its way to inboxes."
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
    backgroundColor: "rgba(0, 0, 0, 0.78)",
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
    backgroundColor: glass.tint.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  ctaBtn: {
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
});
