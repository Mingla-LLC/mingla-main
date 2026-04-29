/**
 * Events tab — placeholder for Cycle 0a. Cycle 9 lands the events list
 * + creation flow + Manage menu per BUSINESS_PRD §5.0.
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "../../src/components/ui/GlassCard";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";

export default function EventsTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar leftKind="brand" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.title}>Events</Text>
          <Text style={styles.body}>Cycle 9 lands content here.</Text>
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.bodySm.fontWeight,
    color: textTokens.secondary,
  },
});
