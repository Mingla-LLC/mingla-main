/**
 * EventDetailKpiCard — revenue + payout + sparkline placeholder.
 *
 * 9a renders zeros (orderStore not wired until 9c).
 * Cycle 9c populates from useOrderStore-derived selectors.
 *
 * [TRANSITIONAL] Sparkline is a visual placeholder. Real revenue chart
 * data lands B-cycle (Mixpanel + analytics edge fn).
 *
 * Per Cycle 9 spec §3.A.2.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { formatCurrency, currencyCodeOrNull } from "../../utils/currency";

import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import type { EventOrdersReadStatus } from "../../utils/eventSalesSummary";

export interface EventDetailKpiCardProps {
  /** Major units. 0 when there are no orders. */
  revenueGbp: number;
  /**
   * Net to organiser's Stripe account from online sales only (major units).
   * Null when no online payments exist — renders as "—". ORCH-0796.
   */
  payoutGbp: number | null;
  /**
   * #3645 PR10 — money already sent to the organiser's bank for THIS offering
   * (major units, from the payout ledger). When both this and `onItsWayGbp`
   * are numbers the card shows PAID OUT + ON ITS WAY instead of the single
   * PAYOUT figure; otherwise it falls back to `payoutGbp`. Shown whether or not
   * the event has ended — money is on its way as soon as it is held.
   */
  paidOutGbp?: number | null;
  /** #3645 PR10 — held / sending money for this offering (major units). */
  onItsWayGbp?: number | null;
  /**
   * ORCH-1006 — total the BRAND covered (absorbed VAT + fees) across this
   * offering's orders, major units. Null/0/undefined → the line is omitted
   * (don't show "You covered £0.00"). Surface 5.
   */
  coveredGbp?: number | null;
  /**
   * #962 G16 — nullable. When the brand has no established currency (pre-bank),
   * callers pass null and every money value renders "—"; a real code formats
   * normally. GBP is never manufactured (the old `= "GBP"` default is gone).
   */
  currency?: string | null;
  readStatus?: EventOrdersReadStatus;
  onRetry?: () => void;
  onOpenPayouts?: () => void;
}

export const EventDetailKpiCard: React.FC<EventDetailKpiCardProps> = ({
  revenueGbp,
  payoutGbp,
  paidOutGbp,
  onItsWayGbp,
  coveredGbp,
  currency,
  readStatus = "ready",
  onRetry,
  onOpenPayouts,
}) => {
  // #962 G16 — resolve the real code or null; hide money ("—") when null
  // (pre-bank brand). NEVER manufacture GBP.
  const code = currencyCodeOrNull(currency);
  const hasData = readStatus === "ready" || readStatus === "stale-error";
  const revenueLabel = code === null ? "—" : !hasData ? "—" : formatCurrency(revenueGbp, code);
  // #3645 PR10 — ledger-backed split replaces the single PAYOUT figure only
  // when the ledger actually answered for this offering.
  const showPayoutSplit =
    typeof paidOutGbp === "number" && Number.isFinite(paidOutGbp) &&
    typeof onItsWayGbp === "number" && Number.isFinite(onItsWayGbp);
  const showCovered =
    hasData &&
    typeof coveredGbp === "number" &&
    Number.isFinite(coveredGbp) &&
    coveredGbp > 0;

  return (
    <GlassCard
      variant="elevated"
      radius="lg"
      padding={spacing.lg}
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>BUYERS PAID</Text>
          <Text style={styles.bigValue}>{revenueLabel}</Text>
        </View>
        <View style={styles.colRight}>
          {showPayoutSplit
            ? (
              <>
                <Text style={styles.label}>PAID TO BANK</Text>
                <Text style={styles.midValue}>
                  {code !== null && hasData
                    ? formatCurrency(paidOutGbp as number, code)
                    : "—"}
                </Text>
                <Text style={[styles.label, styles.labelSecond]}>
                  COMING TO YOU
                </Text>
                <Text style={styles.midValue}>
                  {code !== null && hasData
                    ? formatCurrency(onItsWayGbp as number, code)
                    : "—"}
                </Text>
              </>
            )
            : (
              <>
                <Text style={styles.label}>YOU GET</Text>
                <Text style={styles.midValue}>
                  {code !== null && hasData && payoutGbp !== null
                    ? formatCurrency(payoutGbp, code)
                    : "—"}
                </Text>
              </>
            )}
        </View>
      </View>
      {showCovered && code !== null ? (
        <Text style={styles.coveredLine}>
          You covered {formatCurrency(coveredGbp as number, code)} in VAT &
          fees
        </Text>
      ) : null}
      {readStatus === "error" && onRetry !== undefined ? (
        <Button
          label="Try again"
          onPress={onRetry}
          variant="secondary"
          size="md"
          accessibilityLabel="Retry loading orders"
        />
      ) : readStatus === "stale-error" ? (
        <Text style={styles.coveredLine}>Unable to refresh</Text>
      ) : null}
      {onOpenPayouts !== undefined ? (
        <Button
          label="See payouts"
          onPress={onOpenPayouts}
          variant="ghost"
          size="md"
          accessibilityLabel="See payouts"
        />
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  col: {
    flex: 1,
  },
  colRight: {
    alignItems: "flex-end",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: 4,
  },
  labelSecond: {
    marginTop: spacing.sm,
  },
  bigValue: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  midValue: {
    fontSize: 16,
    fontWeight: "600",
    color: textTokens.secondary,
    fontVariant: ["tabular-nums"],
  },
  coveredLine: {
    fontSize: 12,
    color: textTokens.secondary,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
});

export default EventDetailKpiCard;
