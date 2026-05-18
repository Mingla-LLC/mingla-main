/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — <RefundPreviewBody />.
 *
 * Shared composition used by BOTH operator <RefundPreviewSheet /> AND buyer
 * route /booking/{orderId}/cancel. Single source of visual truth per design
 * §6.3 + OQ-D-3.
 *
 * Renders:
 *   - Trip cover + name + dates (compact hero row; cover optional)
 *   - "CANCELLATION PREVIEW" eyebrow
 *   - Hero refund number ("You'll receive £X back" / "Refund £X to the buyer")
 *   - Tier explanation ("100% refund applies because cancelling 80 days before")
 *   - "Quoted at {timestamp} · confirm within 15 minutes" caption (SC-22)
 *   - GlassCard payment breakdown (per-installment rows + future-installment
 *     cancellation rows)
 *   - 0%-tier banner when tierPct === 0 (semantic.warning tint)
 *
 * Does NOT render CTAs or auth-mode-specific copy — those live on the parent
 * (operator sheet OR buyer route) so this component is mode-agnostic.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { RefundPreview } from "../../services/cancelTripBookingService";
import { GlassCard } from "../ui/GlassCard";

export interface RefundPreviewBodyProps {
  preview: RefundPreview;
  /** 'buyer' renders "You'll receive £X back"; 'operator' renders "Refund £X to the buyer". */
  mode: "buyer" | "operator";
  /** Optional trip metadata for hero (component renders without if absent). */
  tripName?: string | null;
  tripDateRange?: string | null;
  /**
   * 'concise' for operator sheet (skip explainer caption); 'full' for buyer
   * route (include SC-22 freshness caption + future-installments line).
   * Defaults to 'full'.
   */
  density?: "concise" | "full";
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatQuoteTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function tierPhrase(tierPct: number, tierKind: string, daysRemaining: number): string {
  if (tierPct === 0) {
    return "No refund applies because your cancellation policy doesn't cover refunds at this time.";
  }
  const policyKind = tierKind === "none" ? "the" : `the ${tierKind}`;
  if (daysRemaining < 0) {
    return `${tierPct}% refund applies. Trip already started ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago (${policyKind} cancellation policy).`;
  }
  return `${tierPct}% refund applies because cancelling ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} before the trip starts (${policyKind} cancellation policy).`;
}

export const RefundPreviewBody: React.FC<RefundPreviewBodyProps> = ({
  preview,
  mode,
  tripName,
  tripDateRange,
  density = "full",
}) => {
  const heroLabel =
    mode === "buyer" ? "You'll receive back" : "Refund to the buyer";
  const heroAmount = formatMoney(preview.refundTotalCents, preview.currency);
  const explainer = tierPhrase(preview.tierPct, preview.tierKind, preview.daysRemaining);
  const collectedRows = preview.perPaymentRefund.filter(
    (p) => p.paidCents > 0,
  );
  const hasInstallments = collectedRows.some((p) => p.installmentId !== null);
  const isZeroRefund = preview.refundTotalCents === 0;

  return (
    <View style={styles.container}>
      {/* Optional trip header (caller passes name + date range). */}
      {(tripName || tripDateRange) && (
        <View style={styles.tripHeader}>
          {tripName && <Text style={styles.tripName}>{tripName}</Text>}
          {tripDateRange && <Text style={styles.tripDates}>{tripDateRange}</Text>}
        </View>
      )}

      <Text style={styles.eyebrow}>CANCELLATION PREVIEW</Text>

      {/* Hero */}
      <Text style={styles.heroLabel}>{heroLabel}</Text>
      <Text
        style={[styles.heroAmount, isZeroRefund && styles.heroAmountMuted]}
        accessibilityLabel={`${heroLabel} ${heroAmount}`}
      >
        {heroAmount}
      </Text>

      {/* SC-22 freshness caption (full density only) */}
      {density === "full" && (
        <Text style={styles.quotedCaption}>
          Quoted at {formatQuoteTimestamp(preview.quotedAt)} · confirm within 15
          minutes for this amount
        </Text>
      )}

      {/* 0%-tier banner */}
      {isZeroRefund ? (
        <GlassCard variant="elevated" padding={spacing.md} radius="lg">
          <View style={styles.zeroTierBanner}>
            <Text style={styles.zeroTierTitle}>ⓘ No refund applies</Text>
            <Text style={styles.zeroTierBody}>{explainer}</Text>
          </View>
        </GlassCard>
      ) : (
        <Text style={styles.explainer}>{explainer}</Text>
      )}

      {/* Payment breakdown */}
      <GlassCard variant="base" padding={spacing.md} radius="lg">
        <Text style={styles.breakdownHeader}>PAYMENT BREAKDOWN</Text>
        {collectedRows.length === 0 ? (
          <Text style={styles.breakdownEmpty}>No collected payments.</Text>
        ) : (
          collectedRows.map((row) => {
            const isDeposit = row.installmentId === null;
            const label = isDeposit
              ? "Deposit"
              : `Installment ${row.ordinal}`;
            const paidLabel = formatMoney(row.paidCents, row.currency);
            const refundLabel =
              row.refundCents > 0
                ? `+${formatMoney(row.refundCents, row.currency)}`
                : `${formatMoney(0, row.currency)}`;
            return (
              <View
                key={`row-${row.ordinal}-${row.installmentId ?? "deposit"}`}
                style={styles.breakdownRow}
              >
                <View style={styles.breakdownRowLeft}>
                  <Text style={styles.breakdownLabel}>{label}</Text>
                  <Text style={styles.breakdownSub}>
                    {paidLabel} paid
                    {row.refundCents > 0 ? " · refund" : " · no refund"}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.breakdownAmount,
                    row.refundCents > 0
                      ? styles.breakdownAmountSuccess
                      : styles.breakdownAmountMuted,
                  ]}
                >
                  {refundLabel}
                </Text>
              </View>
            );
          })
        )}
        {hasInstallments && preview.installmentsToCancel > 0 && (
          <View style={styles.breakdownRow}>
            <View style={styles.breakdownRowLeft}>
              <Text style={[styles.breakdownLabel, styles.breakdownLabelMuted]}>
                Future installments
              </Text>
              <Text style={styles.breakdownSub}>
                {preview.installmentsToCancel} scheduled · won't be charged
              </Text>
            </View>
            <Text style={[styles.breakdownAmount, styles.breakdownAmountMuted]}>
              Cancelled
            </Text>
          </View>
        )}
        <View style={styles.breakdownDivider} />
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownTotalLabel}>Total refund</Text>
          <Text style={styles.breakdownTotal}>
            {formatMoney(preview.refundTotalCents, preview.currency)}
          </Text>
        </View>
      </GlassCard>

      {/* Disclaimer (full density only) */}
      {density === "full" && !isZeroRefund && (
        <Text style={styles.disclaimer}>
          Refunds typically appear on your original payment method within 5–10
          business days.
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  tripHeader: {
    paddingBottom: spacing.xs,
  },
  tripName: {
    fontSize: 16,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tripDates: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
  },
  heroLabel: {
    fontSize: 14,
    color: textTokens.secondary,
  },
  heroAmount: {
    fontSize: 40,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.5,
  },
  heroAmountMuted: {
    color: textTokens.tertiary,
  },
  quotedCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: -spacing.sm,
  },
  explainer: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  zeroTierBanner: {
    paddingVertical: spacing.xs,
  },
  zeroTierTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: semantic.warning,
    marginBottom: spacing.xs,
  },
  zeroTierBody: {
    fontSize: 13,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  breakdownHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  breakdownEmpty: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing.xs,
  },
  breakdownRowLeft: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  breakdownLabel: {
    fontSize: 14,
    color: textTokens.primary,
  },
  breakdownLabelMuted: {
    color: textTokens.tertiary,
  },
  breakdownSub: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  breakdownAmount: {
    fontSize: 14,
    fontWeight: "600",
  },
  breakdownAmountSuccess: {
    color: semantic.success,
  },
  breakdownAmountMuted: {
    color: textTokens.tertiary,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: glass.border.profileBase,
    marginVertical: spacing.xs,
  },
  breakdownTotalLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  breakdownTotal: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
  },
  disclaimer: {
    fontSize: 12,
    color: textTokens.tertiary,
    lineHeight: 16,
  },
});
