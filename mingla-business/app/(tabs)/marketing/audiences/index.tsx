/**
 * Marketing → Audiences (ORCH-0815-B foundation placeholder).
 *
 * Phase A foundation: the route + sub-nav slot exist so the Marketing tab
 * has a consistent IA. Real audience-list rendering (system-generated
 * brand-rollup + event-scoped audiences + "Coming soon" Brand followers
 * row) lands in sub-ORCH-B per design §7.2 + SPEC §5.2.
 *
 * The buyer audience data is ALREADY shipped (ORCH-0815-A2):
 * `resolveBrandBuyers(brandId)` and `resolveEventBuyers(eventId)` are
 * production-ready. This screen will list audiences and link into the
 * audience-detail view that mirrors the Customers/Buyers tab layout.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "../../../../src/components/ui/Icon";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";

export default function MarketingAudiencesRoute(): React.ReactElement {
  return (
    <View style={styles.host}>
      <View style={styles.card}>
        <Icon name="users" size={32} color={accent.warm} />
        <Text style={styles.title}>Audiences land in the next phase.</Text>
        <Text style={styles.body}>
          Audience data is live — open any brand and tap "Customers", or
          open an event and tap "Buyers" to see the buyer list with reach
          counts and consent state.{"\n\n"}
          A unified list of all your audiences (per brand + per event) plus
          custom saved queries will appear here when the composer ships.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  card: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
  },
});
