/**
 * /trip/create — instant-mount trip wizard entry (ORCH-0893
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave]).
 *
 * Mints a client-side `d_<ts36>` id synchronously via `generateDraftId`
 * and immediately `router.replace`s to `/trip/{d_id}/edit`. No
 * entry-blocking server mutation on this route.
 *
 * Gated on current brand kind='trip_planner' per I-PROPOSED-TR1-KIND-IMMUTABLE +
 * Tr2 §8 hard guard (per `feedback_brand_kind_immutable_post_create.md`).
 *
 * Narrowed-scope note (per ORCH-0893 implementation report): on the trip
 * side, the lazy server-insert is still triggered eagerly by
 * `/trip/[id]/edit.tsx` on `d_*` mount, NOT on first user-meaningful
 * edit. Wiring first-edit-triggered behaviour for trips requires
 * modifying the trip wizard's six per-step autosave hooks
 * (useUpdateTripBasics, useUpdateTripPricing, useUpsertTripDays,
 * useUpsertTripInclusions, useUpdateRefundPolicy, useUpdateBookingDeadline,
 * useUpsertIntakeSchema) — out of scope per SPEC §15
 * "DO NOT touch TripCreatorWizard.tsx step internals". Follow-up:
 * DISC-0893-TRIP-FIRST-EDIT (see implementation report).
 *
 * Supersedes the Tr2 (ORCH-0859) eager `useCreateTripDraft.mutateAsync`
 * call on this route. The mutation hook still exists and is now called
 * from `/trip/[id]/edit.tsx` on `d_*` mount.
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
import { generateDraftId } from "../../src/utils/draftEventId";

export default function TripCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();
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
    // ORCH-0893: synchronous client-side id, no server round-trip.
    // I-PROPOSED-CREATOR-ENTRY-IS-INSTANT.
    const clientId = generateDraftId();
    router.replace(`/trip/${clientId}/edit` as never);
  }, [currentBrand, router]);

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
      <Text style={styles.body}>Loading…</Text>
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
