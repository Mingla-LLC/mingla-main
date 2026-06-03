/**
 * EditAfterPublishExperienceBanner — META-ORCH-1059 Sub-E.
 *
 * Orange-tinted "you're editing a live experience" banner shown at the top of
 * the experience edit screen when the experience is scheduled/live (not a
 * draft). Carries the REQUIRED edit-reason input that the save routes through
 * biz_update_live_experience.
 *
 * Mirror of `EditAfterPublishTripBanner.tsx` (trips side) with experience copy
 * (spot / itinerary in place of traveler / day) + an inline reason field
 * (the trip banner is copy-only; Sub-E folds the reason input into the banner
 * so the live-experience edit flow has a single protection surface).
 */

import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "../ui/Icon";

export interface EditAfterPublishExperienceBannerProps {
  /** Current reason text (controlled). */
  reason: string;
  /** Reason change handler. */
  onReasonChange: (next: string) => void;
  /**
   * Inline rejection / validation message to surface under the input (e.g. the
   * server's human-readable reason copy, or "Add a reason"). Null = no error.
   */
  errorMessage?: string | null;
}

const REASON_MAX = 200;

export const EditAfterPublishExperienceBanner: React.FC<
  EditAfterPublishExperienceBannerProps
> = ({ reason, onReasonChange, errorMessage }) => (
  <View style={styles.host}>
    <View style={styles.headerRow}>
      <View style={styles.iconBadge}>
        <Icon name="flag" size={18} color={accent.warm} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.heading}>You&rsquo;re editing a live experience</Text>
        <Text style={styles.body}>
          Changes save immediately. Existing buyers stay protected — their spots
          and price won&rsquo;t change. Some changes (price, dates, capacity below
          what&rsquo;s sold, removing a booked stop) are blocked once people have
          booked.
        </Text>
      </View>
    </View>

    <Text style={styles.label}>Why are you making this change?</Text>
    <TextInput
      value={reason}
      onChangeText={(v) => onReasonChange(v.slice(0, REASON_MAX))}
      placeholder="e.g. Fixing the meeting-point address (10–200 chars)"
      placeholderTextColor={textTokens.quaternary}
      accessibilityLabel="Reason for editing this live experience"
      testID="experience-live-edit-reason"
      multiline
      style={styles.input}
    />
    {errorMessage != null && errorMessage.length > 0 ? (
      <Text style={styles.error} testID="experience-live-edit-error">
        {errorMessage}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  host: {
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + 4,
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
  label: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },
  input: {
    minHeight: 64,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  error: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
  },
});

export default EditAfterPublishExperienceBanner;
