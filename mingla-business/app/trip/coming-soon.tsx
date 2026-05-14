/**
 * /trip/coming-soon — placeholder route for the Create Trip flow.
 *
 * ORCH-0826 M0: routed to from UniversalCreatorSheet's "Create trip or
 * otherwise" option. Real flow ships in Tr2+ (Minimum Viable Trip).
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.4
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../src/components/ui/Button";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";

export default function TripComingSoonRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/trips" as never);
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title="Create trip"
          rightSlot={null}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.title}>Coming soon.</Text>
          <Text style={styles.bodyText}>
            Multi-day trips let curated travel planners publish packages like
            &ldquo;Tulum Yoga Retreat — March 2026&rdquo; with day-by-day
            itineraries, installment payments, traveler intake forms, and a
            group discussion board built in.
          </Text>
          <Text style={styles.bodyText}>
            We&apos;re shipping this in a few weeks. We&apos;ll let you know the
            moment it&apos;s live.
          </Text>
        </View>
        <Button label="Back to Hub" onPress={handleBack} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    padding: spacing.xl,
    backgroundColor: glass.tint.profileElevated,
    borderColor: glass.border.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  bodyText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
});
