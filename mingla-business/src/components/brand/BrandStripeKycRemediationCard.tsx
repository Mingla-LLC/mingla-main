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
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import {
  getKycRemediationMessage,
  type KycRemediationMessage,
  pickKycRemediationCode,
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
    borderColor: color.danger,
    tint: color.errorTint,
    ctaColor: color.errorText,
  },
  warning: {
    borderColor: color.warning,
    tint: color.warningTint,
    ctaColor: color.warning,
  },
  info: {
    borderColor: color.info,
    tint: color.infoTint,
    ctaColor: color.info,
  },
};

export function BrandStripeKycRemediationCard({
  requirements,
  onResolve,
}: BrandStripeKycRemediationCardProps): React.ReactElement | null {
  // #3258 — the picker moved to the pure constants module so it is
  // executable in a plain jest test; behaviour for every actionable code is
  // unchanged.
  const code = useMemo(
    () => pickKycRemediationCode(requirements),
    [requirements],
  );

  if (code === null) return null;

  const message = getKycRemediationMessage(code);
  const palette = SEVERITY_PALETTE[message.severity];
  // Issue #3258 — a `null` ctaLabel means there is genuinely nothing for the
  // seller to do, so render NO button. Every CTA on this card is wired to
  // `onResolve`, which re-opens Stripe onboarding; offering one on a message
  // that says "no action needed" is a dead tap (Constitution rule 1) — it is
  // what sent a pending-verification seller back to a completed form, over and
  // over. The actionable severities are untouched and keep their CTAs.
  const ctaLabel = message.ctaLabel;

  return (
    <GlassCard
      variant="base"
      padding={space[4]}
      style={[styles.card, { borderColor: palette.borderColor, backgroundColor: palette.tint }]}
    >
      <Text style={styles.title}>{message.title}</Text>
      <Text style={[styles.body, ctaLabel === null ? styles.bodyNoCta : null]}>
        {message.body}
      </Text>

      {ctaLabel !== null
        ? (
          <Pressable
            onPress={onResolve}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: palette.ctaColor },
              pressed ? styles.ctaPressed : null,
            ]}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </Pressable>
        )
        : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: space[2],
    borderWidth: 1,
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: "700",
    color: color.text1,
    marginBottom: space[1],
  },
  body: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginBottom: space[4],
  },
  // #3258 — with no CTA below it the body is the last element in the card, so
  // the button's top gap would read as stray padding.
  bodyNoCta: {
    marginBottom: 0,
  },
  cta: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: 0.4,
  },
});

export default BrandStripeKycRemediationCard;
