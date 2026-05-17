/**
 * /trip/[id]/edit — wizard host route. Tr2 (ORCH-0859).
 *
 * Loads the trip by id via useTrip + resolves the current brand for
 * preview branding, then mounts TripCreatorWizard. On successful publish
 * (TripCreatorWizard.onPublished) router.replace's to the operator trip
 * dashboard at /trip/{id}.
 *
 * Per SPEC §4.10 file 12 + §7 Step 5.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — main render delegates to TripCreatorWizard which applies `paddingTop: insets.top` at TripCreatorWizard.tsx:396 (proven safe on sim screenshot 08-trip-edit.png). The inline loading / error / not-found early-return states render bare `<View>` for brief moments during the trip query resolve — transient flash is acceptable; not worth wrapping each early-return state. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b 2026-05-17.

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useTrip } from "../../../src/hooks/useTrips";
import { TripCreatorWizard } from "../../../src/components/trip/TripCreatorWizard";

export default function TripEditRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const currentBrand = useCurrentBrand();

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <View style={styles.host}>
        <Text style={styles.title}>Trip not found</Text>
        <Text style={styles.body}>This trip link is missing or invalid.</Text>
      </View>
    );
  }

  if (tripQuery.isLoading) {
    return (
      <View style={styles.host}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading trip…</Text>
      </View>
    );
  }

  if (tripQuery.isError) {
    return (
      <View style={styles.host}>
        <Text style={styles.title}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.body}>
          {tripQuery.error instanceof Error
            ? tripQuery.error.message
            : "Check your connection and try again."}
        </Text>
      </View>
    );
  }

  const trip = tripQuery.data;
  if (trip === null || trip === undefined) {
    return (
      <View style={styles.host}>
        <Text style={styles.title}>Trip not found</Text>
        <Text style={styles.body}>
          This trip may have been deleted or you don&rsquo;t have access.
        </Text>
      </View>
    );
  }

  if (currentBrand === null) {
    return (
      <View style={styles.host}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading brand…</Text>
      </View>
    );
  }

  return (
    <TripCreatorWizard
      trip={trip}
      brand={{
        id: currentBrand.id,
        slug: trip.brandSlug ?? "",
        name: currentBrand.displayName,
        bio: currentBrand.bio ?? null,
        coverMediaUrl: currentBrand.coverMediaUrl ?? null,
      }}
      onPublished={(published) => {
        router.replace(`/trip/${published.id}` as never);
      }}
      onExit={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
