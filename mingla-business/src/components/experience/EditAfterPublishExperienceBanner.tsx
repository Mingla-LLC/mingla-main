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
  radius as radiusTokens,
  color,
  space,
  type,
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
  /**
   * issue #3827 — one truthful line under the reason field: whether buyers
   * will be emailed about this change. Absent or empty = no line.
   */
  buyerNoticeLine?: string | null;
}

const REASON_MAX = 200;

export const EditAfterPublishExperienceBanner: React.FC<
  EditAfterPublishExperienceBannerProps
> = ({ reason, onReasonChange, errorMessage, buyerNoticeLine }) => (
  <View style={styles.host}>
    <View style={styles.headerRow}>
      <View style={styles.iconBadge}>
        <Icon name="flag" size={18} color={color.accent} />
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
      placeholderTextColor={color.text4}
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
    {buyerNoticeLine != null && buyerNoticeLine.length > 0 ? (
      <Text style={styles.notice} testID="experience-live-edit-buyer-notice">
        {buyerNoticeLine}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  host: {
    padding: space[4],
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
    marginBottom: space[6],
    gap: space[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2] + 4,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accentTint,
    borderWidth: 1,
    borderColor: color.accentLine,
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
  heading: {
    fontSize: 14,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: color.text2,
  },
  label: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text2,
    marginTop: 2,
  },
  input: {
    minHeight: 64,
    padding: space[2] + 2,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.accentLine,
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    textAlignVertical: "top",
  },
  error: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
  },
  notice: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
});

export default EditAfterPublishExperienceBanner;
