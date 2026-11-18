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

import { formatCurrency } from "../../utils/currency";
import { useBrandStripeOrphanedRefunds } from "../../hooks/useBrandStripeOrphanedRefunds";

import { color, space, type } from "../../constants/designSystem";
interface BrandStripeOrphanedRefundsSectionProps {
  brandId: string;
}

export function BrandStripeOrphanedRefundsSection({
  brandId,
}: BrandStripeOrphanedRefundsSectionProps): React.ReactElement | null {
  const refundsQuery = useBrandStripeOrphanedRefunds(brandId);

  if (refundsQuery.isLoading) {
    return (
      <GlassCard variant="base" padding={space[4]} style={styles.card}>
        <View style={styles.loadingRow}>
          <Spinner size={24} color={color.text1} />
          <Text style={styles.loadingText}>Loading refund history…</Text>
        </View>
      </GlassCard>
    );
  }

  if (refundsQuery.isError) {
    return (
      <GlassCard variant="base" padding={space[4]} style={styles.card}>
        <Text style={styles.errorText}>
          Couldn't load refund history. The data is safely stored — try again later.
        </Text>
      </GlassCard>
    );
  }

  const refunds = refundsQuery.data ?? [];

  if (refunds.length === 0) {
    return (
      <GlassCard variant="base" padding={space[4]} style={styles.card}>
        <Text style={styles.title}>Refund history</Text>
        <Text style={styles.empty}>No refunds processed since detach.</Text>
      </GlassCard>
    );
  }

  return (
    <GlassCard variant="base" padding={space[4]} style={styles.card}>
      <Text style={styles.title}>Refund history (post-detach)</Text>
      <Text style={styles.subtitle}>
        {refunds.length} refund{refunds.length === 1 ? "" : "s"} processed since this account was disconnected.
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
  errorText: {
    fontSize: type.small.fontSize,
    color: color.errorText,
  },
  title: {
    fontSize: type.h1.fontSize,
    fontWeight: "700",
    color: color.text1,
    marginBottom: space[1],
  },
  subtitle: {
    fontSize: type.small.fontSize,
    color: color.text2,
    marginBottom: space[4],
  },
  empty: {
    fontSize: type.small.fontSize,
    color: color.text3,
  },
  list: {
    gap: space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[2],
  },
  rowLeft: {
    flexDirection: "column",
    gap: 2,
  },
  amount: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  date: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  status: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: color.text3,
  },
  statusOk: {
    color: color.success,
  },
  statusErr: {
    color: color.errorText,
  },
});

export default BrandStripeOrphanedRefundsSection;
