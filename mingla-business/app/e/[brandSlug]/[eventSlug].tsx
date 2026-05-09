/**
 * /e/{brandSlug}/{eventSlug} — public event page route.
 *
 * Resolves a LiveEvent by URL (brand-scoped slug). Renders PublicEventPage
 * with state-variant branched rendering.
 *
 * Per Cycle 6 spec §3.2.1.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import {
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { usePublicEventBySlug } from "../../../src/hooks/usePublicEvents";
import { PublicEventPage } from "../../../src/components/event/PublicEventPage";
import { PublicEventNotFound } from "../../../src/components/event/PublicEventNotFound";

export default function PublicEventRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    eventSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const eventSlug = Array.isArray(params.eventSlug)
    ? params.eventSlug[0]
    : params.eventSlug;

  const publicEventQuery = usePublicEventBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof eventSlug === "string" ? eventSlug : null,
  );

  if (publicEventQuery.isLoading || publicEventQuery.isFetching) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading event...</Text>
      </View>
    );
  }

  if (publicEventQuery.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>Event could not load</Text>
        <Text style={styles.stateText}>Refresh this page or try the link again.</Text>
      </View>
    );
  }

  if (publicEventQuery.data === null || publicEventQuery.data === undefined) {
    return <PublicEventNotFound />;
  }

  return (
    <PublicEventPage
      event={publicEventQuery.data.event}
      brand={publicEventQuery.data.brand}
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
