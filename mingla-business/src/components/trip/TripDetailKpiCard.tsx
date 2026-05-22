/**
 * TripDetailKpiCard — ORCH-0913 trip dashboard Revenue + Spots strip.
 *
 * Mirrors EventDetailKpiCard's elevated GlassCard shell and two-column
 * layout while using trip-specific labels. Trips intentionally omit the
 * event sparkline placeholder because no trip-side hourly revenue pattern
 * exists yet.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";

export interface TripDetailKpiCardProps {
  revenueLabel: string;
  spotsLabel: string;
}

export const TripDetailKpiCard: React.FC<TripDetailKpiCardProps> = ({
  revenueLabel,
  spotsLabel,
}) => {
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
          <Text style={styles.bigValue}>{revenueLabel}</Text>
        </View>
        <View style={styles.colRight}>
          <Text style={styles.label}>SPOTS</Text>
          <Text style={styles.midValue}>{spotsLabel}</Text>
        </View>
      </View>
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
});

export default TripDetailKpiCard;
