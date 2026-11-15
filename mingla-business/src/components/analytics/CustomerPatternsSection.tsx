import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  radius,
  space,
  color,
  type,
} from "../../constants/designSystem";
import type {
  BrandCustomerPatternsRollup,
  CustomerPatternView,
} from "../../services/brandAnalyticsService";
import { GlassCard } from "../ui/GlassCard";

const PatternCard: React.FC<{
  title: string;
  view: CustomerPatternView;
  fillHeight: boolean;
}> = ({ title, view, fillHeight }) => {
  const sample = `${view.sampleCommitments.toLocaleString("en-GB")} bookings & RSVPs across ${view.distinctDates.toLocaleString("en-GB")} dates`;
  return (
    <GlassCard
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {view.state === "no_data" ? (
        <View style={styles.state} accessibilityLiveRegion="polite">
          <Text style={styles.stateTitle}>No booking pattern yet</Text>
          <Text style={styles.body}>
            Mingla will show patterns here after customers book or RSVP.
          </Text>
        </View>
      ) : view.state === "more_data_needed" ? (
        <View style={styles.state} accessibilityLiveRegion="polite">
          <Text style={styles.stateTitle}>More data needed</Text>
          <Text style={styles.body}>
            We need at least 10 Mingla bookings or RSVPs across 3 dates before
            calling a pattern.
          </Text>
          <Text style={styles.sample}>{sample}</Text>
        </View>
      ) : view.state === "no_clear_pattern" ? (
        <View style={styles.state} accessibilityLiveRegion="polite">
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

export const visibleCustomerPatternCount = (
  data: BrandCustomerPatternsRollup,
): number => [data.days, data.dayparts, data.types].filter(
  (view) => view.state === "winner" && view.winner !== null,
).length;

export const CustomerPatternsSection: React.FC<{
  data: BrandCustomerPatternsRollup;
  isWideDesktop: boolean;
}> = ({ data, isWideDesktop }) => {
  const candidates: [string, CustomerPatternView][] = [
    ["Days customers chose most", data.days],
    ["Times customers chose most", data.dayparts],
    ["Customers by offering type", data.types],
  ];
  const visible = candidates.filter((entry) => {
    const view = entry[1];
    return view.state === "winner" && view.winner !== null;
  });
  if (visible.length === 0) return null;
  return (
    <View style={styles.section} testID="analytics-patterns-section">
      <Text style={styles.heading} accessibilityRole="header">
        Customer patterns
      </Text>
      <Text style={styles.context}>
        Based on Mingla bookings and RSVPs from the last 180 days
      </Text>
      <View style={[styles.cardRow, isWideDesktop && styles.cardRowWide]}>
        {visible.map(([title, view]) => (
          <PatternCard
            key={title}
            title={title}
            view={view}
            fillHeight={isWideDesktop}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { gap: space[4] },
  heading: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  context: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  cardRow: { gap: space[4] },
  cardRowWide: { flexDirection: "row" },
  card: { flex: 1, minWidth: 0 },
  cardContent: { flex: 1 },
  cardTitle: {
    color: color.text1,
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "700",
  },
  state: { marginTop: space[4], gap: space[2] },
  stateTitle: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  body: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  sample: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  winnerLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space[2],
  },
  winner: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  badge: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentLine,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  badgeText: {
    color: color.accent,
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
  },
  rows: { marginTop: space[4] },
  row: {
    paddingVertical: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  winnerRow: {
    borderLeftWidth: 3,
    borderLeftColor: color.accent,
    paddingLeft: space[2],
  },
  rowLabel: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  winnerLabel: { color: color.accent },
  rowValue: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
});
