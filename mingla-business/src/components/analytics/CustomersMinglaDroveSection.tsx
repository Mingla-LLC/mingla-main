import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { space, color, type } from "../../constants/designSystem";
import type {
  BrandAnalyticsSource,
  BrandMinglaDroveRollup,
} from "../../services/brandAnalyticsService";
import { formatCurrency } from "../../utils/currency";
import { GlassCard } from "../ui/GlassCard";

const SOURCE_LABELS: Record<BrandAnalyticsSource, string> = {
  mingla_app: "Mingla app",
  mingla_ads: "Mingla ads",
  ad: "Ads",
  search: "Search / SEO",
  organic: "Mingla discovery",
  social: "Social",
  own_links: "Your own links",
  direct_unknown: "Direct or unknown",
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
        Bookings through Mingla
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
          <Text style={styles.value}>
            {customers(data.minglaDroveLifetime)}
          </Text>
          <CurrencyValues values={data.valueCentsLifetime} />
        </GlassCard>
      </View>

      <GlassCard>
        <View style={styles.titleLine}>
          <Text style={styles.subheading} accessibilityRole="header">
            Booking sources
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
  section: { gap: space[4] },
  heading: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  helper: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  summaryCard: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  eyebrow: {
    color: color.text3,
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
  },
  value: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    marginTop: space[2],
  },
  support: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[1],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[4],
  },
  subheading: {
    flex: 1,
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  window: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  rows: { marginTop: space[4] },
  row: {
    paddingVertical: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  rowTitle: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  rowCount: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  empty: { marginTop: space[4] },
  emptyTitle: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
});
