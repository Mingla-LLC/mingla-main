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
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useAuth } from "../../../src/context/AuthContext";
import {
  discardBusinessRecentDraft,
  promoteBusinessRecentDraft,
  useSuccessfulBusinessRecentOpen,
} from "../../../src/hooks/useBusinessRecent";
import {
  useTrip,
  useSoftDeleteTrip,
  useCreateTripDraft,
} from "../../../src/hooks/useTrips";
import { TripCreatorWizard } from "../../../src/components/trip/TripCreatorWizard";
import { EditPublishedTripScreen } from "../../../src/components/trip/EditPublishedTripScreen";
import { Button } from "../../../src/components/ui/Button";
import { TRIP_DRAFT_PLACEHOLDER_TITLE } from "../../../src/services/tripsService";

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
  const { user } = useAuth();
  const createTripDraftMutation = useCreateTripDraft();
  const tripMigratingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isClientOnlyId || typeof eventId !== "string") return;
    if (currentBrand === null) return;
    if (tripMigratingIdRef.current === eventId) return;
    tripMigratingIdRef.current = eventId;
    void createTripDraftMutation
      .mutateAsync({ brandId: currentBrand.id })
      .then((trip) => {
        if (user !== null) {
          promoteBusinessRecentDraft({
            userId: user.id,
            brandId: currentBrand.id,
            entityType: "trip",
            localId: eventId,
            serverId: trip.id,
          });
        }
        router.replace(`/trip/${trip.id}/edit` as never);
      })
      .catch(() => {
        tripMigratingIdRef.current = null;
      });
  }, [
    currentBrand,
    createTripDraftMutation,
    eventId,
    isClientOnlyId,
    router,
    user,
  ]);

  const tripQuery = useTrip(
    typeof eventId === "string" && !isClientOnlyId ? eventId : null,
  );
  useSuccessfulBusinessRecentOpen({
    brandId: tripQuery.data?.brandId ?? currentBrand?.id ?? null,
    entityType: "trip",
    entityId: typeof eventId === "string" ? eventId : null,
    ready: isClientOnlyId
      ? currentBrand !== null
      : tripQuery.data != null && !tripQuery.isLoading && !tripQuery.isError,
    title: isClientOnlyId
      ? TRIP_DRAFT_PLACEHOLDER_TITLE
      : tripQuery.data?.title,
    coverUrl: tripQuery.data?.coverMediaUrl,
    coverPosterUrl: tripQuery.data?.coverMediaPosterUrl,
    coverType:
      tripQuery.data?.coverMediaType === "image" ||
      tripQuery.data?.coverMediaType === "video" ||
      tripQuery.data?.coverMediaType === "gif"
        ? tripQuery.data.coverMediaType
        : null,
    status: tripQuery.data?.status,
  });
  // ORCH-0874 [Trip surfaces visual parity with Events]: wire useSoftDeleteTrip
  // for the wizard's create-mode-dirty discard ConfirmDialog (chrome X handler).
  const softDeleteMutation = useSoftDeleteTrip();

  if (isClientOnlyId) {
    // ORCH-0893: migration in flight — placeholder until `router.replace`
    // hands the route the server-issued id.
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
        <ActivityIndicator />
        <Text style={styles.body}>Setting up your trip…</Text>
      </ScrollView>
    );
  }

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
        <Text style={styles.title}>Trip not found</Text>
        <Text style={styles.body}>This trip link is missing or invalid.</Text>
      </ScrollView>
    );
  }

  if (tripQuery.isLoading) {
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
        <ActivityIndicator />
        <Text style={styles.body}>Loading trip…</Text>
      </ScrollView>
    );
  }

  if (tripQuery.isError) {
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
        <Text style={styles.title}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.body}>
          {tripQuery.error instanceof Error
            ? tripQuery.error.message
            : "Check your connection and try again."}
        </Text>
      </ScrollView>
    );
  }

  const trip = tripQuery.data;
  if (trip === null || trip === undefined) {
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
        <Text style={styles.title}>Trip not found</Text>
        <Text style={styles.body}>
          This trip may have been deleted or you don&rsquo;t have access.
        </Text>
      </ScrollView>
    );
  }

  if (currentBrand === null) {
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
        <ActivityIndicator />
        <Text style={styles.body}>Loading brand…</Text>
      </ScrollView>
    );
  }

  // ORCH-0876 — status-based dispatch.
  if (trip.status === "scheduled" || trip.status === "live") {
    return <EditPublishedTripScreen trip={trip} />;
  }

  if (trip.status === "ended" || trip.status === "cancelled") {
    return (
      <ScrollView
          style={styles.host}
          contentContainerStyle={styles.hostContent}
        >
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
      </ScrollView>
    );
  }

  // Default: draft → wizard (create-mode UX).
  // ORCH-0874: derive isCreateMode — true for freshly-created draft trips
  // that haven't been edited yet (no title, no days, no inclusions). Drives
  // wizard chrome X discard semantics per SPEC §3.3.5/§3.3.6.
  // ORCH-1177 — `createTripDraft` seeds the title with TRIP_DRAFT_PLACEHOLDER_TITLE
  // ("Untitled trip"), NOT an empty string, so a fresh never-edited draft failed
  // the `title.length === 0` clause and was misclassified as edit-mode → Close X /
  // Android back silently autosaved + bounced to Home with no "Discard this trip?"
  // confirm. Treat the placeholder title as still-pristine so a fresh draft routes
  // through the proper create-mode discard path (pristine → discard orphan + exit;
  // dirty → confirm). The shared const keeps the seed + this guard from drifting.
  const isCreateMode =
    trip.status === "draft" &&
    (trip.title.length === 0 || trip.title === TRIP_DRAFT_PLACEHOLDER_TITLE) &&
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
        // ORCH-1076 Stream B — thread Stripe-readiness so the wizard can
        // proactively gate a paid trip's Publish (the narrow TripPreviewBrand
        // dropped it before).
        stripeStatus: currentBrand.stripeStatus ?? null,
        paymentProvider: currentBrand.paymentProvider,
        paystackSubaccountCode: currentBrand.paystackSubaccountCode ?? null,
      }}
      isCreateMode={isCreateMode}
      onDiscardTrip={async () => {
        await softDeleteMutation.mutateAsync({
          eventId: trip.id,
          brandId: trip.brandId,
        });
        if (user !== null) {
          discardBusinessRecentDraft({
            userId: user.id,
            brandId: trip.brandId,
            entityType: "trip",
            localId: trip.id,
          });
        }
      }}
      onPublished={(published) => {
        router.replace(`/trip/${published.id}` as never);
      }}
      onExit={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  // #2211 — all seven early-return branches share this centred root; the ended/cancelled one carries the only CTA.
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
    // #2211 — clip a mis-measurement here rather than letting it grow the column.
    overflow: "hidden",
  },
  hostContent: {
    // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
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
