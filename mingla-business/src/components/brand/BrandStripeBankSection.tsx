/**
 * BrandStripeBankSection — bank verification status surface.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-12.
 *
 * Renders 4 states from `useBrandStripeBankVerification`:
 *  - verified  → green badge + "Bank account ending in 1234"
 *  - pending   → amber badge + "Verification in progress"
 *  - errored   → red badge + reason + "Re-verify your bank" CTA
 *  - missing   → "Add bank account" CTA
 *
 * Mounted inside BrandPaymentsView ABOVE the KPI tiles when stripeStatus
 * is "active" or "restricted". Hidden in "not_connected" / "onboarding".
 *
 * Country-aware label: uses `bankAccountLabel` from country constants
 * ("IBAN" for EEA, "Sort code + account number" for GB, etc.).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Spinner } from "../ui/Spinner";
import { GlassCard } from "../ui/GlassCard";
import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import {
  useBrandStripeBankVerification,
  type BankVerificationState,
} from "../../hooks/useBrandStripeBankVerification";

interface BrandStripeBankSectionProps {
  brandId: string;
  /** Fired when user taps "Re-verify" or "Add bank account" — opens onboarding */
  onResolve?: () => void;
}

const STATE_PALETTE: Record<
  BankVerificationState,
  { color: string; tint: string; label: string }
> = {
  verified: {
    color: color.success,
    tint: color.successTint,
    label: "Verified",
  },
  pending: {
    color: color.warning,
    tint: color.warningTint,
    label: "Verifying",
  },
  errored: {
    color: color.errorText,
    tint: color.errorTint,
    label: "Action needed",
  },
  missing: {
    color: color.text3,
    tint: color.fill.tile,
    label: "Not added",
  },
};

export function BrandStripeBankSection({
  brandId,
  onResolve,
}: BrandStripeBankSectionProps): React.ReactElement | null {
  const verification = useBrandStripeBankVerification(brandId);

  if (verification.isLoading) {
    return (
      <GlassCard variant="base" padding={space[4]} style={styles.card}>
        <View style={styles.loadingRow}>
          <Spinner size={24} color={color.text1} />
          <Text style={styles.loadingText}>Loading bank verification…</Text>
        </View>
      </GlassCard>
    );
  }

  if (verification.isError || !verification.data) {
    // Fail-soft: hide section rather than show a confusing error to
    // brand admins who may not have a connected account yet. The KPI
    // tiles below convey overall state.
    return null;
  }

  const { state, lastFour, bankAccountLabel, errorReason } = verification.data;
  const palette = STATE_PALETTE[state];
  const showCta = state === "errored" || state === "missing";
  const ctaLabel = state === "missing" ? "Add bank account" : "Re-verify your bank";

  return (
    <GlassCard variant="base" padding={space[4]} style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>{bankAccountLabel}</Text>
        <View style={[styles.badge, { backgroundColor: palette.tint }]}>
          <View style={[styles.badgeDot, { backgroundColor: palette.color }]} />
          <Text style={[styles.badgeText, { color: palette.color }]}>
            {palette.label}
          </Text>
        </View>
      </View>

      {state !== "missing" && lastFour ? (
        <Text style={styles.detail}>Bank account ending in {lastFour}</Text>
      ) : null}

      {state === "errored" && errorReason ? (
        <Text style={styles.errorReason}>{errorReason}</Text>
      ) : null}

      {showCta && onResolve ? (
        <Pressable
          onPress={onResolve}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            pressed ? styles.ctaPressed : null,
          ]}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: space[2],
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  loadingText: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLabel: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.full,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  detail: {
    fontSize: type.small.fontSize,
    color: color.text2,
    marginTop: space[1],
  },
  errorReason: {
    fontSize: type.small.fontSize,
    color: color.errorText,
    marginTop: space[1],
  },
  cta: {
    marginTop: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    backgroundColor: color.fill.tabOn,
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
});

export default BrandStripeBankSection;
