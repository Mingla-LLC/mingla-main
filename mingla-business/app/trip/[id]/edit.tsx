/**
 * /trip/[id]/edit — status-based dispatch host (ORCH-0876).
 *
 * Loads the trip by id, then routes to one of three operator-side editors
 * based on `trip.status`:
 *
 *   - "draft"                 → TripCreatorWizard (create-mode UX,
 *                               autosave per step transition, Publish dock)
 *   - "scheduled" | "live"    → EditPublishedTripScreen (sectioned
 *                               accordion + Save dock + refund-gate via
 *                               biz_update_live_trip RPC)
 *   - "ended" | "cancelled"   → read-only empty state with "Back to trip"
 *
 * Mirrors the event-side routing pattern at `app/event/[id]/edit.tsx`:
 * the published-edit experience is a different component from the
 * create wizard, not a flag on the same component, so the operator's
 * mental model + the technical architecture (server-side atomic patch
 * via RPC vs. client autosave on step transition) stay aligned.
 *
 * Per SPEC §4.10 + §7 (ORCH-0876 v2 full parity).
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — main render delegates to TripCreatorWizard or EditPublishedTripScreen which apply `paddingTop: insets.top` themselves (proven safe on sim screenshots). Inline loading / error / not-found early-return states render bare `<View>` for brief moments during the trip query resolve — transient flash is acceptable; not worth wrapping each early-return state. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b 2026-05-17.

import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import {
  useTrip,
  useSoftDeleteTrip,
  useCreateTripDraft,
} from "../../../src/hooks/useTrips";
import { TripCreatorWizard } from "../../../src/components/trip/TripCreatorWizard";
import { EditPublishedTripScreen } from "../../../src/components/trip/EditPublishedTripScreen";
import { Button } from "../../../src/components/ui/Button";

export default function TripEditRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  // ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave]:
  // when the dynamic segment is a client-only `d_<ts36>` id minted by
  // `/trip/create.tsx`, the server has no matching row yet. Trigger
  // `createTripDraft` eagerly on mount and `router.replace` to the
  // server-issued id. This is the NARROWED-SCOPE trip behaviour
  // (eager-on-mount, NOT first-edit-triggered) — see SPEC §15 +
  // DISC-0893-TRIP-FIRST-EDIT for the follow-up that moves this to
  // first-edit-triggered like the event side.
  const isClientOnlyId =
    typeof eventId === "string" && eventId.startsWith("d_");

  const currentBrand = useCurrentBrand();
  const createTripDraftMutation = useCreateTripDraft();
  const tripMigratingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isClientOnlyId || typeof eventId !== "string") return;
    if (currentBrand === null) return;
    if (currentBrand.kind !== "trip_planner") return;
    if (tripMigratingIdRef.current === eventId) return;
    tripMigratingIdRef.current = eventId;
    void createTripDraftMutation
      .mutateAsync({ brandId: currentBrand.id })
      .then((trip) => {
        router.replace(`/trip/${trip.id}/edit` as never);
      })
      .catch(() => {
        tripMigratingIdRef.current = null;
      });
  }, [currentBrand, createTripDraftMutation, eventId, isClientOnlyId, router]);

  const tripQuery = useTrip(
    typeof eventId === "string" && !isClientOnlyId ? eventId : null,
  );
  // ORCH-0874 [Trip surfaces visual parity with Events]: wire useSoftDeleteTrip
  // for the wizard's create-mode-dirty discard ConfirmDialog (chrome X handler).
  const softDeleteMutation = useSoftDeleteTrip();

  if (isClientOnlyId) {
    // ORCH-0893: migration in flight — placeholder until `router.replace`
    // hands the route the server-issued id.
    return (
      <View style={styles.host}>
        <ActivityIndicator />
        <Text style={styles.body}>Setting up your trip…</Text>
      </View>
    );
  }

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

  // ORCH-0876 — status-based dispatch.
  if (trip.status === "scheduled" || trip.status === "live") {
    return <EditPublishedTripScreen trip={trip} />;
  }

  if (trip.status === "ended" || trip.status === "cancelled") {
    return (
      <View style={styles.host}>
        <Text style={styles.title}>
          {trip.status === "ended"
            ? "This trip has ended"
            : "This trip is cancelled"}
        </Text>
        <Text style={styles.body}>
          {trip.status === "ended"
            ? "Edits aren't allowed after a trip ends — buyer records and reports stay frozen for accuracy."
            : "Edits aren't allowed once a trip is cancelled. You can still see traveler details and refunds from the trip page."}
        </Text>
        <Button
          label="Back to trip"
          variant="primary"
          size="md"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace(`/trip/${trip.id}` as never);
            }
          }}
          accessibilityLabel="Back to trip"
          testID="trip-edit-readonly-back"
        />
      </View>
    );
  }

  // Default: draft → wizard (create-mode UX).
  // ORCH-0874: derive isCreateMode — true for freshly-created draft trips
  // that haven't been edited yet (no title, no days, no inclusions). Drives
  // wizard chrome X discard semantics per SPEC §3.3.5/§3.3.6.
  const isCreateMode =
    trip.status === "draft" &&
    trip.title.length === 0 &&
    trip.days.length === 0 &&
    trip.inclusions.length === 0;

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
      isCreateMode={isCreateMode}
      onDiscardTrip={async () => {
        await softDeleteMutation.mutateAsync({
          eventId: trip.id,
          brandId: trip.brandId,
        });
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
