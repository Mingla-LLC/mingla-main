/**
 * Ve3 — surfaces physical-venue claim_status on Hub screens.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";
import {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "../../services/venueClaimService";

interface VenueClaimStatusBannerProps {
  brand: Brand | null | undefined;
}

export function VenueClaimStatusBanner({
  brand,
}: VenueClaimStatusBannerProps): React.ReactElement | null {
  if (brand === null || brand === undefined || brand.kind !== "physical") {
    return null;
  }

  const variant = venueClaimBannerVariant({
    kind: "physical",
    claim_status: brand.claimStatus ?? "none",
    rejection_reason: brand.rejectionReason ?? null,
    claim_follow_up_at: brand.claimFollowUpAt ?? null,
  });

  if (variant === null || variant === "verified") {
    return null;
  }

  const copy = venueClaimBannerCopy(variant, brand.rejectionReason);
  if (copy === null) return null;

  const toneStyle =
    variant === "rejected"
      ? styles.toneError
      : variant === "follow_up"
        ? styles.toneWarning
        : styles.toneInfo;

  return (
    <View style={[styles.wrap, toneStyle]} accessibilityRole="summary">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  title: {
    ...typography.subhead,
    fontWeight: "600",
    marginBottom: spacing.xs,
    color: textTokens.primary,
  },
  body: {
    ...typography.caption,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  toneError: {
    backgroundColor: semantic.errorTint,
    borderColor: semantic.error,
  },
  toneWarning: {
    backgroundColor: semantic.warningTint,
    borderColor: semantic.warning,
  },
  toneInfo: {
    backgroundColor: semantic.infoTint,
    borderColor: semantic.info,
  },
});
