/**
 * /b/{brandSlug} — public brand page route.
 *
 * Resolves a Brand by slug. Renders PublicBrandPage or PublicBrandNotFound.
 *
 * Per Cycle 7 spec §2.1.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover banner: PublicBrandPage applies `paddingTop: insets.top + 110` at line 341 to the brand-info content card so content sits safely below the status bar; the cover image and X close button intentionally hover on the banner. PublicBrandNotFound applies `paddingTop: insets.top + spacing.xl` at line 39. Inline loading/error states render briefly during query resolve. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 21-PUBLIC-BRAND-PAGE.png).

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import {
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { usePublicBrandBySlug } from "../../../src/hooks/usePublicEvents";
import { PublicBrandPage } from "../../../src/components/brand/PublicBrandPage";
import { PublicBrandNotFound } from "../../../src/components/brand/PublicBrandNotFound";

export default function PublicBrandRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ brandSlug: string | string[] }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;

  const publicBrandQuery = usePublicBrandBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
  );

  if (publicBrandQuery.isLoading || publicBrandQuery.isFetching) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading brand...</Text>
      </View>
    );
  }

  if (publicBrandQuery.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>Brand could not load</Text>
        <Text style={styles.stateText}>Refresh this page or try the link again.</Text>
      </View>
    );
  }

  if (publicBrandQuery.data === null || publicBrandQuery.data === undefined) {
    return <PublicBrandNotFound />;
  }

  return (
    <PublicBrandPage
      brand={publicBrandQuery.data.brand}
      events={publicBrandQuery.data.events}
      trips={publicBrandQuery.data.trips}
      venue={publicBrandQuery.data.venue}
    />
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    color: textTokens.primary,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  stateText: {
    color: textTokens.secondary,
    fontSize: 14,
    textAlign: "center",
  },
});
