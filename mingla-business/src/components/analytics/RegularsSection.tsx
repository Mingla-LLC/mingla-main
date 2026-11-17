import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { space, color, type } from "../../constants/designSystem";
import { phMaskProps } from "../../analytics/phMask";
import type { BrandRegularsRollup } from "../../services/brandAnalyticsService";
import { GlassCard } from "../ui/GlassCard";

export const formatRegularsCount = (count: number): string =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "regular" : "regulars"}`;

export const RegularsSection: React.FC<{
  data: BrandRegularsRollup;
  fillHeight?: boolean;
}> = ({ data, fillHeight = false }) =>
  data.regularsCount === 0 ? null : (
  <View style={styles.section} testID="analytics-regulars-section">
    <View style={styles.titleLine}>
      <Text style={styles.heading} accessibilityRole="header">
        Regulars
      </Text>
      <Text style={styles.window}>All time</Text>
    </View>
    <Text style={styles.summary}>
      {formatRegularsCount(data.regularsCount)}
    </Text>
    <Text style={styles.helper}>
      Customers who booked or RSVP&apos;d across more than one listing or reservation.
    </Text>
    <GlassCard
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
    >
      <Text style={styles.subheading} accessibilityRole="header">
        Top regulars
      </Text>
      <View style={styles.rows}>
        {data.topRegulars.map((regular, index) => (
          <View
            key={`${regular.maskedContact}-${index}`}
            style={styles.row}
            accessible
            accessibilityLabel={`${regular.maskedContact}, ${regular.bookingsAndRsvps} bookings and RSVPs, across ${regular.listings} listings`}
            {...phMaskProps()}
          >
            <Text style={styles.contact} {...phMaskProps()}>
              {regular.maskedContact}
            </Text>
            <Text style={styles.detail}>
              {`${regular.bookingsAndRsvps.toLocaleString("en-GB")} bookings & RSVPs`}
            </Text>
            <Text style={styles.detail}>
              {`Across ${regular.listings.toLocaleString("en-GB")} listings`}
            </Text>
          </View>
        ))}
      </View>
    </GlassCard>
  </View>
);

const styles = StyleSheet.create({
  section: { flex: 1, gap: space[2] },
  card: { flex: 1 },
  cardContent: { flex: 1 },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[4],
  },
  heading: {
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
  summary: {
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
  subheading: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  rows: { marginTop: space[4] },
  row: {
    paddingVertical: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  contact: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  detail: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
});
