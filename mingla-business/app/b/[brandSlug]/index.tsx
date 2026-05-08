/**
 * /b/{brandSlug} — public brand page route.
 *
 * Resolves a Brand by slug. Renders PublicBrandPage or PublicBrandNotFound.
 *
 * Per Cycle 7 spec §2.1.
 */

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
