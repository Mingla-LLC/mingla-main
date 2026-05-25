/**
 * /trip/create — instant-mount trip wizard entry (ORCH-0893
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave]).
 *
 * Mints a client-side `d_<ts36>` id synchronously via `generateDraftId`
 * and immediately `router.replace`s to `/trip/{d_id}/edit`. No
 * entry-blocking server mutation on this route.
 *
 * Universal trip-create route per I-BRAND-UNIVERSAL-AUTHORING
 * (META-ORCH-0972).
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

import React, { useEffect, useRef } from "react";
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
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (currentBrand === null) return;

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
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
