/**
 * BrandStripeDeadlineBanner — Stripe verification deadline countdown.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-T tier discipline.
 *
 * Renders ONLY when there's a verification deadline within 7 days. Tier-
 * based color + copy:
 *  - 7d → info (blue)
 *  - 3d → warning (amber)
 *  - 1d → blocking (red)
 * Beyond 7 days → returns null (no banner).
 *
 * Mounted in BrandPaymentsView ABOVE the KYC remediation card.
 *
 * Deadline is provided as Unix-seconds (matches Stripe's
 * `requirements.current_deadline` shape).
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

interface BrandStripeDeadlineBannerProps {
  /** Stripe `requirements.current_deadline` — Unix seconds, or null when no deadline */
  deadline: number | null;
  /** Fired when user taps the CTA — opens onboarding flow */
  onResolve: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type Tier = "1d" | "3d" | "7d" | "none";

interface TierConfig {
  borderColor: string;
  tint: string;
  ctaColor: string;
  daysLabel: string;
  severity: "info" | "warning" | "blocking";
}

const TIER_CONFIG: Record<Exclude<Tier, "none">, TierConfig> = {
  "7d": {
    borderColor: semantic.info,
    tint: semantic.infoTint,
    ctaColor: semantic.info,
    daysLabel: "7 days left",
    severity: "info",
  },
  "3d": {
    borderColor: semantic.warning,
    tint: semantic.warningTint,
    ctaColor: semantic.warning,
    daysLabel: "3 days left",
    severity: "warning",
  },
  "1d": {
    borderColor: semantic.error,
    tint: semantic.errorTint,
    ctaColor: semantic.error,
    daysLabel: "Less than 24 hours",
    severity: "blocking",
  },
};

function deadlineToTier(deadline: number | null, nowMs: number = Date.now()): Tier {
  if (deadline === null || deadline <= 0) return "none";
  const remainingMs = deadline * 1000 - nowMs;
  if (remainingMs <= 0) return "1d"; // overdue → treat as most urgent
  const remainingDays = Math.ceil(remainingMs / DAY_MS);
  if (remainingDays <= 1) return "1d";
  if (remainingDays <= 3) return "3d";
  if (remainingDays <= 7) return "7d";
  return "none";
}

function deadlineToDateLabel(deadline: number | null): string {
  if (deadline === null) return "soon";
  try {
    return new Date(deadline * 1000).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "soon";
  }
}

export function BrandStripeDeadlineBanner({
  deadline,
  onResolve,
}: BrandStripeDeadlineBannerProps): React.ReactElement | null {
  const tier = useMemo(() => deadlineToTier(deadline), [deadline]);

  if (tier === "none") return null;

  const config = TIER_CONFIG[tier];
  const dateLabel = deadlineToDateLabel(deadline);

  return (
    <GlassCard
      variant="base"
      padding={spacing.md}
      style={[
        styles.card,
        { borderColor: config.borderColor, backgroundColor: config.tint },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Action needed by {dateLabel}</Text>
        <View style={[styles.chip, { backgroundColor: config.ctaColor }]}>
          <Text style={styles.chipText}>{config.daysLabel}</Text>
        </View>
      </View>

      <Text style={styles.body}>
        Stripe needs verification details to keep your payouts running. Tap
        below to provide them.
      </Text>

      <Pressable
        onPress={onResolve}
        accessibilityRole="button"
        accessibilityLabel={`Resolve verification, ${config.daysLabel}`}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: config.ctaColor },
          pressed ? styles.ctaPressed : null,
        ]}
      >
        <Text style={styles.ctaText}>Continue verification</Text>
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: spacing.sm,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.6,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.md,
    lineHeight: typography.bodySm.lineHeight,
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

export default BrandStripeDeadlineBanner;
