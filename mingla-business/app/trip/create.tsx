/**
 * /trip/create — entry route for the trip-planner wizard. Tr2 (ORCH-0859).
 *
 * Creates a draft event_type='trip' row via tripsService.createTripDraft +
 * router.replace's to /trip/{id}/edit so the back-stack doesn't include
 * the create route (operators can't accidentally re-trigger create by
 * tapping back).
 *
 * Gated on current brand kind='trip_planner' (per Tr2 §8 hard guard +
 * SPEC §4.10) — non-trip-planner brands routed away with friendly toast.
 *
 * Per SPEC §4.10 file 9 + §7 Step 5.
 */

import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { useCreateTripDraft } from "../../src/hooks/useTrips";

export default function TripCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const createTripDraft = useCreateTripDraft();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (currentBrand === null) return;

    // Gate: trip-planner brands only (per Tr2 §8 hard guard).
    if (currentBrand.kind !== "trip_planner") {
      startedRef.current = true;
      setErrorMessage(
        "Trip planning is for trip-planner brands. Switch to a trip-planner brand or create one in the brand switcher.",
      );
      return;
    }

    startedRef.current = true;
    void (async () => {
      try {
        const trip = await createTripDraft.mutateAsync({
          brandId: currentBrand.id,
        });
        // router.replace so /trip/create isn't in the back-stack
        router.replace(`/trip/${trip.id}/edit` as never);
      } catch (e) {
        setErrorMessage(
          e instanceof Error
            ? `Couldn't start the trip wizard: ${e.message}`
            : "Couldn't start the trip wizard. Try again.",
        );
      }
    })();
  }, [currentBrand, createTripDraft, router]);

  if (currentBrand === null) {
    return (
      <SafeScreen style={styles.host}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading brand…</Text>
      </SafeScreen>
    );
  }

  if (errorMessage !== null) {
    return (
      <SafeScreen style={styles.host}>
        <Text style={styles.title}>Can&rsquo;t start trip wizard</Text>
        <Text style={styles.body}>{errorMessage}</Text>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={styles.host}>
      <ActivityIndicator />
      <Text style={styles.body}>Setting up your trip…</Text>
    </SafeScreen>
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
