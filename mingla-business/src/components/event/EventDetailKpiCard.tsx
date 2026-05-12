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
import { formatCurrency } from "../../utils/currency";

import { GlassCard } from "../ui/GlassCard";

export interface EventDetailKpiCardProps {
  /** Major units. 0 when there are no orders. */
  revenueGbp: number;
  /**
   * Net to organiser's Stripe account from online sales only (major units).
   * Null when no online payments exist — renders as "—". ORCH-0796.
   */
  payoutGbp: number | null;
  currency?: string;
}

export const EventDetailKpiCard: React.FC<EventDetailKpiCardProps> = ({
  revenueGbp,
  payoutGbp,
  currency = "GBP",
}) => {
  const hasData = revenueGbp > 0;

  return (
    <GlassCard
      variant="elevated"
      radius="lg"
      padding={spacing.lg}
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>REVENUE</Text>
          <Text style={styles.bigValue}>
            {formatCurrency(hasData ? revenueGbp : 0, currency)}
          </Text>
        </View>
        <View style={styles.colRight}>
          <Text style={styles.label}>PAYOUT</Text>
          <Text style={styles.midValue}>
            {hasData && payoutGbp !== null
              ? formatCurrency(payoutGbp, currency)
              : "—"}
          </Text>
        </View>
      </View>
      <SparklineBar />
    </GlassCard>
  );
};

// ---- SparklineBar — composed inline placeholder --------------------

const BAR_COUNT = 12;
const BAR_HEIGHTS = [
  0.45, 0.62, 0.4, 0.78, 0.55, 0.7, 0.85, 0.6, 0.5, 0.72, 0.45, 0.68,
];

const SparklineBar: React.FC = () => (
  <View style={styles.sparklineRow}>
    {Array.from({ length: BAR_COUNT }).map((_, idx) => {
      const heightFraction = BAR_HEIGHTS[idx] ?? 0.5;
      return (
        <View
          key={`bar-${idx}`}
          style={[
            styles.sparklineBar,
            { height: `${heightFraction * 100}%` },
          ]}
        />
      );
    })}
  </View>
);

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
  sparklineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 28,
  },
  sparklineBar: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 2,
  },
});

export default EventDetailKpiCard;
