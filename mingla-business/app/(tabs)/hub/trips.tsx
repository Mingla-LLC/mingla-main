/**
 * /hub/trips — Hub > Trips sub-route.
 *
 * ORCH-0826 [Hub Foundation + universal-plus creator] M0: empty-state placeholder.
 * ORCH-0859 [Tr2 Minimum Viable Trip]: wired to useTripsByBrand, lists current
 *   brand's trips. Tap routes via routeForEventRow per I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE.
 * ORCH-0874 [Trip surfaces visual parity with Events]: full visual+chrome mirror
 *   of events list — filter pills (All / Upcoming / Past / Drafts), TripListCard
 *   primitive with cover hue + status pill + manage icon, GlassCard variant="elevated"
 *   empty state, flexGrow:0 on filter ScrollView per
 *   feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md.
 *
 * Per SPEC §4.10 file 26 (ORCH-0859) + SPEC §3.3.3 (ORCH-0874).
 */

import React, { Suspense, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { DESKTOP_HUB_GRID_COLUMNS } from "../../../src/constants/desktopLayout";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { Toast } from "../../../src/components/ui/Toast";
import { TripListCard } from "../../../src/components/trip/TripListCard";
import { DraftSelectBar } from "../../../src/components/offering/DraftSelectBar";
import { buildOfferingManageActions } from "../../../src/components/offering/offeringManageActions";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useDraftMultiSelect } from "../../../src/hooks/useDraftMultiSelect";
import { useDiscardOfferingDrafts } from "../../../src/hooks/useDiscardOfferingDrafts";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useTripsByBrand } from "../../../src/hooks/useTrips";
import type { Trip } from "../../../src/services/tripsService";
import { HapticFeedback } from "../../../src/utils/hapticFeedback";
import { routeForEventRowDefensive } from "../../../src/utils/routeForEventRow";

// ORCH-1123 — combined no-silent-failure toast tally (verbatim DESIGN §6.2).
const bulkToastMessage = (deleted: number, failed: number): string => {
  if (failed === 0) {
    return `Deleted ${deleted} draft${deleted === 1 ? "" : "s"}.`;
  }
  if (deleted > 0) {
    return `Deleted ${deleted}, ${failed} couldn't be deleted.`;
  }
  return `Couldn't delete ${failed} draft${failed === 1 ? "" : "s"}. You may not have permission.`;
};

const bulkDeleteErrorMessage = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.includes("insufficient_event_permission")) {
    return "You do not have permission to delete these drafts for this brand.";
  }
  return "Could not delete these drafts. Try again.";
};

const LazyOfferingManageSheet = React.lazy(async () => {
  const mod = await import("../../../src/components/offering/OfferingManageSheet");
  return { default: mod.OfferingManageSheet };
});

const LazyShareModal = React.lazy(async () => {
  const mod = await import("../../../src/components/ui/ShareModal");
  return { default: mod.ShareModal };
});

type TripFilter = "all" | "upcoming" | "past" | "draft";

interface PillSpec {
  key: TripFilter;
  label: string;
  count: number;
}

function deriveTripFilterBucket(trip: Trip): "upcoming" | "past" | "draft" {
  if (trip.status === "draft") return "draft";
  if (trip.status === "ended" || trip.status === "cancelled") return "past";
  // scheduled/live: derive from dates
  const now = Date.now();
  const end = trip.businessTrip.endAt
    ? new Date(trip.businessTrip.endAt).getTime()
    : Number.NaN;
  if (Number.isFinite(end) && now > end) return "past";
  return "upcoming";
}

export default function HubTripsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const currentBrand = useCurrentBrand();
  const tripsQuery = useTripsByBrand(currentBrand?.id ?? null);

  const trips = useMemo<Trip[]>(() => tripsQuery.data ?? [], [tripsQuery.data]);

  const buckets = useMemo<Record<"upcoming" | "past" | "draft", Trip[]>>(() => {
    const upcoming: Trip[] = [];
    const past: Trip[] = [];
    const draft: Trip[] = [];
    for (const t of trips) {
      const b = deriveTripFilterBucket(t);
      if (b === "upcoming") upcoming.push(t);
      else if (b === "past") past.push(t);
      else draft.push(t);
    }
    // Sort: upcoming asc by start, past desc by start, draft desc by updatedAt
    upcoming.sort((a, b) =>
      (a.businessTrip.startAt ?? "").localeCompare(
        b.businessTrip.startAt ?? "",
      ),
    );
    past.sort((a, b) =>
      (b.businessTrip.startAt ?? "").localeCompare(
        a.businessTrip.startAt ?? "",
      ),
    );
    draft.sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
    return { upcoming, past, draft };
  }, [trips]);

  const counts = useMemo<Record<TripFilter, number>>(() => ({
    all: trips.length,
    upcoming: buckets.upcoming.length,
    past: buckets.past.length,
    draft: buckets.draft.length,
  }), [trips.length, buckets]);

  const defaultFilter = useMemo<TripFilter>((): TripFilter => {
    if (counts.upcoming > 0) return "upcoming";
    if (counts.draft > 0) return "draft";
    if (counts.past > 0) return "past";
    return "all";
  }, [counts]);

  const [filter, setFilter] = useState<TripFilter>(defaultFilter);
  // META-ORCH-1059 Pass 1 — Hub list-card 3-dot opens the shared manage sheet.
  const [manageTrip, setManageTrip] = useState<Trip | null>(null);
  const [shareTrip, setShareTrip] = useState<Trip | null>(null);

  // ORCH-1123 [Hub multi-select draft delete] — long-press multi-select +
  // bulk soft-delete for DRAFT trips only (converges on the rank-checked RPC).
  const selection = useDraftMultiSelect();
  const discardOfferings = useDiscardOfferingDrafts();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState<boolean>(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleBulkDeleteConfirm = useCallback(async (): Promise<void> => {
    if (currentBrand === null) return;
    const serverIds = trips
      .filter((t) => t.status === "draft" && selection.isSelected(t.id))
      .map((t) => t.id);
    setBulkError(null);
    try {
      const result = await discardOfferings.mutateAsync({
        kind: "trip",
        brandId: currentBrand.id,
        serverEventIds: serverIds,
      });
      const deleted = result.rows.filter((r) => r.outcome === "deleted").length;
      const failed = result.rows.filter((r) => r.outcome !== "deleted").length;
      setBulkConfirmOpen(false);
      selection.exit();
      setToast(bulkToastMessage(deleted, failed));
    } catch (error) {
      setBulkError(bulkDeleteErrorMessage(error));
    }
  }, [currentBrand, trips, selection, discardOfferings]);

  const filteredTrips = useMemo<Trip[]>(() => {
    if (filter === "all") {
      // upcoming → draft → past
      return [...buckets.upcoming, ...buckets.draft, ...buckets.past];
    }
    return buckets[filter];
  }, [filter, buckets]);

  const pillSpecs = useMemo<PillSpec[]>(
    () => [
      { key: "all", label: "All", count: counts.all },
      { key: "upcoming", label: "Upcoming", count: counts.upcoming },
      { key: "past", label: "Past", count: counts.past },
      { key: "draft", label: "Drafts", count: counts.draft },
    ],
    [counts],
  );

  const handleOpenTrip = useCallback(
    (trip: Trip): void => {
      // ORCH-0874 + I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE: use canonical helper.
      // event_type='trip' so the helper routes to /trip/{id}/edit for drafts
      // and /trip/{id} otherwise.
      router.push(
        routeForEventRowDefensive({
          id: trip.id,
          event_type: "trip",
          status: trip.status,
        }) as never,
      );
    },
    [router],
  );

  // ----- States (loading / error / brand-missing) -----

  if (currentBrand === null) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.body}>Select a brand to see its trips.</Text>
      </View>
    );
  }

  if (tripsQuery.isLoading) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
      </View>
    );
  }

  if (tripsQuery.isError) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.title}>Couldn&rsquo;t load trips</Text>
        <Text style={styles.body}>
          {tripsQuery.error instanceof Error
            ? tripsQuery.error.message
            : "Check your connection and try again."}
        </Text>
      </View>
    );
  }

  // ----- Render ----------------------------------------------------------

  return (
    <View style={styles.host}>
      {/* Filter pills row — sibling to the trips ScrollView so the pills
          stay anchored. flexGrow:0 mandatory per the well-known double-
          ScrollView footgun (feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsRow}
        style={styles.pillsScroll}
      >
        {pillSpecs.map((p) => {
          const active = filter === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                if (p.key !== "draft") selection.exit();
                setFilter(p.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.label}, ${p.count}`}
              hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}
              style={({ pressed }) => [
                styles.pill,
                active && styles.pillActive,
                pressed && styles.pillPressed,
              ]}
            >
              <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                {p.label}
              </Text>
              <Text style={[styles.pillCount, active && styles.pillCountActive]}>
                {p.count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {filteredTrips.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>
              {filter === "all" ? "No trips yet" : "No trips here"}
            </Text>
            <Text style={styles.emptyBody}>
              {filter === "all"
                ? "Tap the + button above to start your first trip — a yoga retreat, food tour, or weekend getaway."
                : filter === "draft"
                  ? "No drafts in progress. Tap + to build one."
                  : `Tap "All" to see everything.`}
            </Text>
          </GlassCard>
        ) : (
          <>
            {!selection.selectionMode &&
            filteredTrips.some((t) => t.status === "draft") ? (
              <Text style={styles.selectHint}>
                Press and hold a draft to select multiple
              </Text>
            ) : null}
            <View style={[styles.list, isWideDesktop && styles.desktopListGrid]}>
              {filteredTrips.map((trip) => {
                const isDraftRow = trip.status === "draft";
                return (
                  <View
                    key={trip.id}
                    style={isWideDesktop ? styles.desktopListCell : undefined}
                  >
                    <TripListCard
                      trip={trip}
                      onOpen={
                        selection.selectionMode && isDraftRow
                          ? () => selection.toggle(trip.id)
                          : () => handleOpenTrip(trip)
                      }
                      onManageOpen={() => setManageTrip(trip)}
                      selectionMode={selection.selectionMode}
                      selectable={isDraftRow}
                      selected={selection.isSelected(trip.id)}
                      onLongPress={
                        isDraftRow
                          ? () => {
                              HapticFeedback.selectionEnter();
                              selection.enterWith(trip.id);
                            }
                          : undefined
                      }
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* META-ORCH-1059 Pass 1 — shared per-kind manage sheet opened from a
          list-card 3-dot. Same Edit · View public · Orders · Share · Cancel set
          as the trip dashboard. Tapping Cancel routes to the trip dashboard's
          cancel flow (the typeToConfirm dialog lives there); the Hub list keeps
          only the non-destructive actions inline + opens the dashboard for the
          destructive confirm. */}
      {manageTrip !== null ? (
        <Suspense fallback={null}>
          <LazyOfferingManageSheet
            visible
            onClose={() => setManageTrip(null)}
            kind="trip"
            actions={buildOfferingManageActions(
              "trip",
              {
                onEdit: () =>
                  router.push(`/trip/${manageTrip.id}/edit` as never),
                onViewPublic:
                  manageTrip.brandSlug !== null && manageTrip.brandSlug.length > 0
                    ? () =>
                        router.push(
                          `/t/${manageTrip.brandSlug}/${manageTrip.slug}` as never,
                        )
                    : undefined,
                onOrders: () =>
                  router.push(`/trip/${manageTrip.id}/travelers` as never),
                onShare:
                  manageTrip.brandSlug !== null && manageTrip.brandSlug.length > 0
                    ? () => setShareTrip(manageTrip)
                    : undefined,
                onCancel:
                  manageTrip.status !== "draft" &&
                  manageTrip.status !== "ended" &&
                  manageTrip.status !== "cancelled"
                    ? () => router.push(`/trip/${manageTrip.id}` as never)
                    : undefined,
              },
              () => setManageTrip(null),
            )}
          />
        </Suspense>
      ) : null}

      {shareTrip !== null &&
      shareTrip.brandSlug !== null &&
      shareTrip.brandSlug.length > 0 ? (
        <Suspense fallback={null}>
          <LazyShareModal
            visible
            onClose={() => setShareTrip(null)}
            url={`https://business.usemingla.com/t/${shareTrip.brandSlug}/${shareTrip.slug}`}
            title={`${shareTrip.title} on Mingla`}
            description={
              shareTrip.description !== null && shareTrip.description.length > 0
                ? shareTrip.description.slice(0, 200)
                : shareTrip.title
            }
          />
        </Suspense>
      ) : null}

      {/* ORCH-1123 — bulk-delete ConfirmDialog (simple destructive variant). */}
      <ConfirmDialog
        visible={bulkConfirmOpen}
        onClose={() => {
          if (!discardOfferings.isPending) {
            setBulkConfirmOpen(false);
            setBulkError(null);
          }
        }}
        onConfirm={handleBulkDeleteConfirm}
        title={
          selection.count === 1
            ? "Delete this draft?"
            : `Delete ${selection.count} drafts?`
        }
        description={
          selection.count === 1
            ? "This draft will be permanently removed. This can't be undone."
            : `These ${selection.count} drafts will be permanently removed. This can't be undone.`
        }
        variant="simple"
        confirmLabel={
          selection.count === 1 ? "Delete draft" : `Delete ${selection.count}`
        }
        cancelLabel="Keep"
        confirmLoading={discardOfferings.isPending}
        confirmDisabled={discardOfferings.isPending}
        closeDisabled={discardOfferings.isPending}
        errorMessage={bulkError}
        testID="bulk-delete-confirm"
        confirmTestID="bulk-delete-confirm-button"
        cancelTestID="bulk-delete-cancel-button"
        destructive
      />

      {/* ORCH-1123 — sticky bulk-select action bar (drafts only). */}
      {selection.selectionMode ? (
        <DraftSelectBar
          count={selection.count}
          deleting={discardOfferings.isPending}
          onCancel={selection.exit}
          onDelete={() => setBulkConfirmOpen(true)}
          bottomInset={insets.bottom}
        />
      ) : null}

      {/* ORCH-1123 — Toast surface (trips had none); bulk tally lands here. */}
      <Toast
        visible={toast !== null}
        kind="info"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  // ORCH-1123 — long-press discoverability caption.
  selectHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  stateHost: {
    flex: 1,
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
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  list: {
    gap: spacing.sm,
  },
  desktopListGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
    marginHorizontal: -spacing.xs,
  },
  desktopListCell: {
    width: `${100 / DESKTOP_HUB_GRID_COLUMNS}%`,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  pillsScroll: {
    paddingVertical: spacing.sm,
    // ORCH-0857 [Hub events list flush-with-pills] precedent — flexGrow:0
    // mandatory to avoid double-ScrollView vertical space split.
    flexGrow: 0,
    flexShrink: 0,
  },
  pillsRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  pill: {
    height: 34,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radiusTokens.full,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.55)",
    backgroundColor: glass.tint.profileBase,
  },
  pillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
    color: textTokens.primary,
  },
  pillLabelActive: {
    color: textTokens.primary,
  },
  pillCount: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  pillCountActive: {
    color: accent.warm,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
});
