import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { phMaskProps } from "../../analytics/phMask";
import type { BrandRegularsRollup } from "../../services/brandAnalyticsService";
import { GlassCard } from "../ui/GlassCard";

export const formatRegularsCount = (count: number): string =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "regular" : "regulars"}`;

export const RegularsSection: React.FC<{ data: BrandRegularsRollup }> = ({
  data,
}) => (
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
    <GlassCard>
      <Text style={styles.subheading} accessibilityRole="header">
        Top regulars
      </Text>
      {data.topRegulars.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No regulars yet</Text>
          <Text style={styles.helper}>
            Regulars appear after the same customer books or RSVPs across more
            than one listing or reservation.
          </Text>
        </View>
      ) : (
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
      )}
    </GlassCard>
  </View>
);

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heading: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
  },
  window: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  summary: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  helper: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  subheading: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  rows: { marginTop: spacing.md },
  row: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  contact: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  detail: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  empty: { marginTop: spacing.md, gap: spacing.xs },
  emptyTitle: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
});
