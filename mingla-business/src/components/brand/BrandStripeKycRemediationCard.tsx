/**
 * BrandStripeKycRemediationCard — actionable card for KYC remediation.
 *
 * Per B2a Path C V3 SPEC §6 + investigation Thread 18.
 *
 * Reads `requirements` from `useBrandStripeStatus` — picks the FIRST
 * relevant code in priority order:
 *   1. requirements.disabled_reason (highest — currently blocking)
 *   2. requirements.past_due[0]
 *   3. requirements.currently_due[0]
 *
 * Maps the code → friendly copy via `getKycRemediationMessage`. Severity
 * drives the card border color: blocking=red, warning=amber, info=blue.
 *
 * Mounted at the top of BrandPaymentsView when stripeStatus !== "active"
 * and there's a non-empty remediation.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassCard } from "../ui/GlassCard";
import {
  spacing,
  radius,
  typography,
  text as textTokens,
  semantic,
} from "../../constants/designSystem";
import {
  getKycRemediationMessage,
  type KycRemediationMessage,
} from "../../constants/stripeKycRemediationMessages";

interface RequirementsShape {
  disabled_reason?: string | null;
  currently_due?: readonly string[] | null;
  past_due?: readonly string[] | null;
}

interface BrandStripeKycRemediationCardProps {
  requirements: RequirementsShape | null;
  /** Fired when the user taps the CTA */
  onResolve: () => void;
}

const SEVERITY_PALETTE: Record<
  KycRemediationMessage["severity"],
  { borderColor: string; tint: string; ctaColor: string }
> = {
  blocking: {
    borderColor: semantic.error,
    tint: semantic.errorTint,
    ctaColor: semantic.error,
  },
  warning: {
    borderColor: semantic.warning,
    tint: semantic.warningTint,
    ctaColor: semantic.warning,
  },
  info: {
    borderColor: semantic.info,
    tint: semantic.infoTint,
    ctaColor: semantic.info,
  },
};

function pickRemediationCode(req: RequirementsShape | null): string | null {
  if (!req) return null;
  if (req.disabled_reason) return req.disabled_reason;
  if (req.past_due && req.past_due.length > 0) return req.past_due[0];
  if (req.currently_due && req.currently_due.length > 0) return req.currently_due[0];
  return null;
}

export function BrandStripeKycRemediationCard({
  requirements,
  onResolve,
}: BrandStripeKycRemediationCardProps): React.ReactElement | null {
  const code = useMemo(() => pickRemediationCode(requirements), [requirements]);

  if (code === null) return null;

  const message = getKycRemediationMessage(code);
  const palette = SEVERITY_PALETTE[message.severity];

  return (
    <GlassCard
      variant="base"
      padding={spacing.md}
      style={[styles.card, { borderColor: palette.borderColor, backgroundColor: palette.tint }]}
    >
      <Text style={styles.title}>{message.title}</Text>
      <Text style={styles.body}>{message.body}</Text>

      <Pressable
        onPress={onResolve}
        accessibilityRole="button"
        accessibilityLabel={message.ctaLabel}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: palette.ctaColor },
          pressed ? styles.ctaPressed : null,
        ]}
      >
        <Text style={styles.ctaText}>{message.ctaLabel}</Text>
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: spacing.sm,
    borderWidth: 1,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  cta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.4,
  },
});

export default BrandStripeKycRemediationCard;
