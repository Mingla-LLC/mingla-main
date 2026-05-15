/**
 * /experience/coming-soon — placeholder route for the Create Experience flow.
 *
 * ORCH-0826 M0: routed to from UniversalCreatorSheet's "Create experience"
 * option. Real flow ships in Ve5+ (Menu AI parser → Restaurant experiences,
 * Activities AI → Play, Schedule AI → Creative & Arts).
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.3
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

export default function ExperienceComingSoonRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/experiences" as never);
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title="Create experience"
          rightSlot={null}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.title}>Coming soon.</Text>
          <Text style={styles.bodyText}>
            Single-intent experiences let verified venue brands publish offerings
            like &ldquo;Bottomless brunch Saturdays&rdquo; or &ldquo;Date-night
            tasting menu.&rdquo; They&apos;re powered by AI that reads your menu
            and generates candidates for you to review.
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
