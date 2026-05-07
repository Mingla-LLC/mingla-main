/**
 * BrandStripeOrphanedRefundsSection — read-only refund history for detached brands.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-7.
 *
 * When a brand admin detaches their Stripe Connect account, refunds for
 * pre-detach charges may continue to fire `charge.refund.updated` webhooks
 * for days/weeks. These get persisted to `payment_webhook_events` but the
 * brand has no live UI to see them.
 *
 * This section is read-only: lists the most recent 20 refund events for
 * this brand's former Stripe account. Each row: amount + currency + date
 * + status. No CTAs (the connected account is gone — operator handles
 * any reconciliation manually).
 *
 * Mounted in BrandPaymentsView ONLY when brand.detached_at !== null.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { GlassCard } from "../ui/GlassCard";
import { Spinner } from "../ui/Spinner";
import {
  spacing,
  typography,
  text as textTokens,
  accent,
  semantic,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { useBrandStripeOrphanedRefunds } from "../../hooks/useBrandStripeOrphanedRefunds";

interface BrandStripeOrphanedRefundsSectionProps {
  brandId: string;
}

export function BrandStripeOrphanedRefundsSection({
  brandId,
}: BrandStripeOrphanedRefundsSectionProps): React.ReactElement | null {
  const refundsQuery = useBrandStripeOrphanedRefunds(brandId);

  if (refundsQuery.isLoading) {
    return (
      <GlassCard variant="base" padding={spacing.md} style={styles.card}>
        <View style={styles.loadingRow}>
          <Spinner size={24} color={accent.warm} />
          <Text style={styles.loadingText}>Loading refund history…</Text>
        </View>
      </GlassCard>
    );
  }

  if (refundsQuery.isError) {
    return (
      <GlassCard variant="base" padding={spacing.md} style={styles.card}>
        <Text style={styles.errorText}>
          Couldn't load refund history. The data is safely stored — try again later.
        </Text>
      </GlassCard>
    );
  }

  const refunds = refundsQuery.data ?? [];

  if (refunds.length === 0) {
    return (
      <GlassCard variant="base" padding={spacing.md} style={styles.card}>
        <Text style={styles.title}>Refund history</Text>
        <Text style={styles.empty}>No refunds processed since detach.</Text>
      </GlassCard>
    );
  }

  return (
    <GlassCard variant="base" padding={spacing.md} style={styles.card}>
      <Text style={styles.title}>Refund history (post-detach)</Text>
      <Text style={styles.subtitle}>
        {refunds.length} refund{refunds.length === 1 ? "" : "s"} processed by Stripe since this account was disconnected.
      </Text>

      <View style={styles.list}>
        {refunds.map((r) => (
          <View key={r.eventId} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.amount}>
                {formatCurrency(r.amountMinor, r.currency, true)}
              </Text>
              <Text style={styles.date}>{formatDate(r.createdAt)}</Text>
            </View>
            <Text
              style={[
                styles.status,
                r.status === "succeeded" ? styles.statusOk : null,
                r.status === "failed" ? styles.statusErr : null,
              ]}
            >
              {r.status}
            </Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  card: {
    marginVertical: spacing.sm,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    color: semantic.error,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  empty: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  rowLeft: {
    flexDirection: "column",
    gap: 2,
  },
  amount: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  date: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  status: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.tertiary,
  },
  statusOk: {
    color: semantic.success,
  },
  statusErr: {
    color: semantic.error,
  },
});

export default BrandStripeOrphanedRefundsSection;
