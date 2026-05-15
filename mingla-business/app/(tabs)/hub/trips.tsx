/**
 * /hub/trips (ORCH-0826) — Hub > Trips sub-route.
 *
 * Empty-state placeholder for M0. Multi-day trips ship in Tr2+ (Minimum
 * Viable Trip) when the trip-planner persona's flow is built.
 *
 * Per Q7 SPEC: short and friendly copy.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.9
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";

export default function HubTripsRoute(): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.placeholderCard}>
        <Text style={styles.title}>Trips coming soon.</Text>
        <Text style={styles.body}>
          Multi-day curated trips — yoga retreats, food tours, weekend
          getaways — with day-by-day itineraries, installment payments,
          traveler intake forms, and a group discussion board built in.
          Ships in a few weeks.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 120,
  },
  placeholderCard: {
    padding: spacing.xl,
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
});
