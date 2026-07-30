import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  BrandCustomerPatternsRollup,
  CustomerPatternView,
} from "../../services/brandAnalyticsService";
import { GlassCard } from "../ui/GlassCard";

const PatternCard: React.FC<{
  title: string;
  view: CustomerPatternView;
}> = ({ title, view }) => {
  const sample = `${view.sampleCommitments.toLocaleString("en-GB")} bookings & RSVPs across ${view.distinctDates.toLocaleString("en-GB")} dates`;
  return (
    <GlassCard style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {view.state === "no_data" ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>No booking pattern yet</Text>
          <Text style={styles.body}>
            Mingla will show patterns here after customers book or RSVP.
          </Text>
        </View>
      ) : view.state === "more_data_needed" ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>More data needed</Text>
          <Text style={styles.body}>
            We need at least 10 Mingla bookings or RSVPs across 3 dates before
            calling a pattern.
          </Text>
          <Text style={styles.sample}>{sample}</Text>
        </View>
      ) : view.state === "no_clear_pattern" ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>No clear pattern yet</Text>
          <Text style={styles.body}>
            Your customer choices are still spread across days, times, or
            offering types.
          </Text>
          <Text style={styles.sample}>{sample}</Text>
        </View>
      ) : view.state === "winner" && view.winner !== null ? (
        <View style={styles.state} accessibilityLiveRegion="polite">
          <View style={styles.winnerLine}>
            <Text style={styles.winner}>{view.winner.label}</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Most chosen</Text>
            </View>
          </View>
          <Text style={styles.body}>
            {`Based on ${view.sampleCommitments.toLocaleString("en-GB")} Mingla bookings and RSVPs across ${view.distinctDates.toLocaleString("en-GB")} dates in the last 180 days.`}
          </Text>
        </View>
      ) : null}
      {view.state !== "no_data" && view.state !== "unauthorized" ? (
        <View style={styles.rows}>
          {view.buckets.map((bucket) => {
            const isWinner =
              view.state === "winner" && view.winner?.key === bucket.key;
            return (
              <View
                key={bucket.key}
                style={[styles.row, isWinner && styles.winnerRow]}
              >
                <Text style={[styles.rowLabel, isWinner && styles.winnerLabel]}>
                  {bucket.label}
                </Text>
                <Text style={styles.rowValue}>
                  {`${bucket.bookingsAndRsvps.toLocaleString("en-GB")} bookings & RSVPs`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </GlassCard>
  );
};

export const CustomerPatternsSection: React.FC<{
  data: BrandCustomerPatternsRollup;
  isWideDesktop: boolean;
}> = ({ data, isWideDesktop }) => (
  <View style={styles.section} testID="analytics-patterns-section">
    <Text style={styles.heading} accessibilityRole="header">
      Customer patterns
    </Text>
    <Text style={styles.context}>
      Based on Mingla bookings and RSVPs from the last 180 days
    </Text>
    <View style={[styles.cardRow, isWideDesktop && styles.cardRowWide]}>
      <PatternCard title="Days customers chose most" view={data.days} />
      <PatternCard title="Times customers chose most" view={data.dayparts} />
      <PatternCard title="Customers by offering type" view={data.types} />
    </View>
  </View>
);

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
  },
  context: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  cardRow: { gap: spacing.md },
  cardRowWide: { flexDirection: "row" },
  card: { flex: 1, minWidth: 0 },
  cardTitle: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
  },
  state: { marginTop: spacing.md, gap: spacing.sm },
  stateTitle: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  body: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  sample: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  winnerLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  winner: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  badge: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeText: {
    color: accent.warm,
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
  },
  rows: { marginTop: spacing.md },
  row: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  winnerRow: {
    borderLeftWidth: 3,
    borderLeftColor: accent.warm,
    paddingLeft: spacing.sm,
  },
  rowLabel: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  winnerLabel: { color: accent.warm },
  rowValue: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
});
