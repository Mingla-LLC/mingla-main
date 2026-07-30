import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  BrandAnalyticsSource,
  BrandMinglaDroveRollup,
} from "../../services/brandAnalyticsService";
import { formatCurrency } from "../../utils/currency";
import { GlassCard } from "../ui/GlassCard";

const SOURCE_LABELS: Record<BrandAnalyticsSource, string> = {
  ad: "Ads",
  search: "Search / SEO",
  organic: "Mingla discovery",
  social: "Social",
  direct: "Direct link",
};

const customers = (count: number): string =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "customer" : "customers"}`;

const CurrencyValues: React.FC<{ values: Record<string, number> }> = ({
  values,
}) => {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return <Text style={styles.support}>No paid booking value yet</Text>;
  }
  return (
    <>
      {entries.map(([currency, cents]) => (
        <Text key={currency} style={styles.support}>
          {`${formatCurrency(cents, currency, true)} booking value`}
        </Text>
      ))}
    </>
  );
};

export const CustomersMinglaDroveSection: React.FC<{
  data: BrandMinglaDroveRollup;
}> = ({ data }) => {
  const hasSources = data.bySource.some(
    (row) => row.customers > 0 || Object.keys(row.valueCents).length > 0,
  );
  return (
    <View style={styles.section} testID="analytics-customers-section">
      <Text style={styles.heading} accessibilityRole="header">
        Customers Mingla drove
      </Text>
      <Text style={styles.helper}>
        Bookings, RSVPs and paid booking value completed through Mingla.
      </Text>
      <View style={styles.summaryRow}>
        <GlassCard style={styles.summaryCard}>
          <Text style={styles.eyebrow}>LAST 30 DAYS</Text>
          <Text style={styles.value}>{customers(data.minglaDrove30d)}</Text>
          <CurrencyValues values={data.valueCents30d} />
        </GlassCard>
        <GlassCard style={styles.summaryCard}>
          <Text style={styles.eyebrow}>ALL TIME</Text>
          <Text style={styles.value}>{customers(data.minglaDroveLifetime)}</Text>
          <CurrencyValues values={data.valueCentsLifetime} />
        </GlassCard>
      </View>

      <GlassCard>
        <View style={styles.titleLine}>
          <Text style={styles.subheading} accessibilityRole="header">
            Where customers came from
          </Text>
          <Text style={styles.window}>All time</Text>
        </View>
        <Text style={styles.helper}>
          A customer can appear in more than one source if they booked through
          different paths.
        </Text>
        {hasSources ? (
          <View style={styles.rows}>
            {data.bySource.map((row) => (
              <View key={row.source} style={styles.row}>
                <Text style={styles.rowTitle}>{SOURCE_LABELS[row.source]}</Text>
                <Text style={styles.rowCount}>{customers(row.customers)}</Text>
                <CurrencyValues values={row.valueCents} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No source mix yet</Text>
            <Text style={styles.support}>
              Sources appear after customers book or RSVP through Mingla.
            </Text>
          </View>
        )}
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
  },
  helper: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryCard: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  eyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  value: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    marginTop: spacing.sm,
  },
  support: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.xs,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  subheading: {
    flex: 1,
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  window: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  rows: { marginTop: spacing.md },
  row: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  rowTitle: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  rowCount: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  empty: { marginTop: spacing.md },
  emptyTitle: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
});
