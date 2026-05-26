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

import React, { useCallback, useMemo, useState } from "react";
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
import { TripListCard } from "../../../src/components/trip/TripListCard";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useTripsByBrand } from "../../../src/hooks/useTrips";
import type { Trip } from "../../../src/services/tripsService";
import { routeForEventRowDefensive } from "../../../src/utils/routeForEventRow";

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
              onPress={() => setFilter(p.key)}
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
          <View style={[styles.list, isWideDesktop && styles.desktopListGrid]}>
            {filteredTrips.map((trip) => (
              <View
                key={trip.id}
                style={isWideDesktop ? styles.desktopListCell : undefined}
              >
                <TripListCard
                  trip={trip}
                  onOpen={() => handleOpenTrip(trip)}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
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
