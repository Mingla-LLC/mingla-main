/**
 * EditAfterPublishBanner — informational banner shown above editable
 * fields on the EditPublishedScreen.
 *
 * Orange-tinted GlassCard with warning icon + headline + body copy.
 * Communicates: changes go live immediately + most fields are locked.
 *
 * issue #3827 — it promises no message. When buyer emails are on, the route
 * passes the outcome of the last one ("Last update: sent to 249 of 254 …");
 * a failed delivery is shown in red with "Contact support".
 *
 * Per Cycle 9 spec §3.B.2 J-E11.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  semantic,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

import { Icon } from "../ui/Icon";

export interface EditAfterPublishBannerProps {
  /** issue #3827 — how the last buyer email went; null or absent: no line. */
  lastNotice?: { text: string; failed: boolean } | null;
}

export const EditAfterPublishBanner: React.FC<EditAfterPublishBannerProps> = ({
  lastNotice = null,
}) => (
  <View style={styles.host}>
    <View style={styles.iconBadge}>
      <Icon name="flag" size={18} color={accent.warm} />
    </View>
    <View style={styles.textCol}>
      <Text style={styles.heading}>You're editing a live event</Text>
      <Text style={styles.body}>
        Changes save immediately. Existing buyers stay protected — their
        tickets and prices won't change. Review changes tells you whether
        buyers will be emailed about a new date, venue or format. Some
        destructive changes require refunding existing buyers first.
      </Text>
      {lastNotice !== null ? (
        <Text
          style={[styles.lastNotice, lastNotice.failed ? styles.lastNoticeFailed : null]}
          accessibilityRole={lastNotice.failed ? "alert" : undefined}
        >
          {lastNotice.text}
        </Text>
      ) : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + 4,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    marginBottom: spacing.lg,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.42)",
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
  heading: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  lastNotice: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
    marginTop: 6,
    fontVariant: ["tabular-nums"],
  },
  lastNoticeFailed: {
    color: semantic.error,
    fontWeight: "600",
  },
});

export default EditAfterPublishBanner;
