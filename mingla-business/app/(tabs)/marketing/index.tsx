/**
 * Marketing → Overview (ORCH-0815-B foundation).
 *
 * Phase A landing — Revenue hero + funnel tiles + recent campaigns list
 * land in sub-ORCH-B (next sub-step). Until then this route renders an
 * honest placeholder explaining what's coming and pointing brand operators
 * at the per-brand Customers tab + per-event Buyers tab (both already shipped
 * in ORCH-0815-A2-ui).
 *
 * Constitution #9 (no fabricated data) — we do NOT render fake metric
 * tiles. The placeholder is true to what exists today.
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "../../../src/components/ui/Icon";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";

export default function MarketingOverviewRoute(): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <Icon name="send" size={32} color={accent.warm} />
        <Text style={styles.heroTitle}>Marketing Hub — Phase A foundation.</Text>
        <Text style={styles.heroBody}>
          Your buyer audiences are live. Open any brand → "Customers" or
          any event → "Buyers" to see them.{"\n\n"}
          Email composer + revenue analytics + templates land in the next
          phase. We'll let you know when you can press send.
        </Text>
      </View>

      <View style={styles.previewCard}>
        <Text style={styles.previewLabel}>WHAT'S COMING</Text>
        <Text style={styles.previewItem}>· Email campaigns to ticket buyers</Text>
        <Text style={styles.previewItem}>· Revenue + open + click tracking</Text>
        <Text style={styles.previewItem}>· Reusable templates (5 starter packs ready)</Text>
        <Text style={styles.previewItem}>· SMS + RCS once Twilio verification clears</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  heroCard: {
    backgroundColor: glass.tint.profileElevated,
    borderColor: glass.border.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  heroTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  heroBody: {
    ...typography.body,
    color: textTokens.secondary,
  },
  previewCard: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  previewItem: {
    ...typography.body,
    color: textTokens.secondary,
  },
});
