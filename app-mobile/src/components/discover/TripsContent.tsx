/**
 * TripsContent — the Discover > Trips tab body (ORCH-1016).
 *
 * Renders the TripFilterChips row + the single-column TripCard infinite list,
 * plus all 9 states (DESIGN Item 6): loading skeleton, error+retry, empty-none,
 * empty-filters+clear, populated, single, offline banner, etc.
 *
 * Memoized (I-TAB-SCREENS-MEMOIZED). No mobile cache — React Query only.
 */

import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import { useAppLayout } from "../../hooks/useAppLayout";
import { useDiscoverTrips } from "../../hooks/useDiscoverTrips";
import {
  EMPTY_DISCOVER_TRIP_FILTERS,
  type DiscoverTripFilters,
  type DiscoverTripRow,
} from "../../services/tripsDiscoveryService";
import { TripCard } from "./TripCard";
import { TripFilterChips } from "./TripFilterChips";

const g = glass.discover;

interface TripsContentProps {
  headerHeight: number;
  onOpenTrip: (seed: DiscoverTripRow) => void;
  onBrowseEvents: () => void;
  reduceMotion: boolean;
}

function filtersAreEmpty(f: DiscoverTripFilters): boolean {
  return (
    f.destinationQuery === null &&
    f.departureQuery === null &&
    f.dateFrom === null &&
    f.dateTo === null &&
    f.minPriceCents === null &&
    f.maxPriceCents === null &&
    f.groupSizeMin === null &&
    f.groupSizeMax === null &&
    f.sort === "relevance"
  );
}

const SkeletonCard: React.FC = () => (
  <View style={styles.skeletonCard}>
    <View style={styles.skeletonBarTitle} />
    <View style={styles.skeletonBarMeta} />
  </View>
);

const TripsContentImpl: React.FC<TripsContentProps> = ({
  headerHeight,
  onOpenTrip,
  onBrowseEvents,
}) => {
  const insets = useSafeAreaInsets();
  const { bottomNavTotalHeight } = useAppLayout();
  const [filters, setFilters] = useState<DiscoverTripFilters>(
    EMPTY_DISCOVER_TRIP_FILTERS,
  );

  const {
    trips,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useDiscoverTrips(filters);

  const renderItem = useCallback(
    ({ item }: { item: DiscoverTripRow }) => (
      <TripCard trip={item} onPress={onOpenTrip} />
    ),
    [onOpenTrip],
  );

  const keyExtractor = useCallback((item: DiscoverTripRow) => item.tripId, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const contentPaddingTop = headerHeight + 8;
  const contentPaddingBottom = bottomNavTotalHeight + insets.bottom + 16;

  // ── State A: loading skeleton (first page) ──
  if (isLoading) {
    return (
      <View
        style={[
          styles.stateWrap,
          { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom },
        ]}
      >
        <View style={styles.filterRowSlot}>
          <TripFilterChips filters={filters} onChange={setFilters} />
        </View>
        <View style={styles.listPad}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  // ── State B: error + retry ──
  if (isError) {
    return (
      <View
        style={[
          styles.centerState,
          { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom },
        ]}
      >
        <Icon name="alert-circle-outline" size={48} color="#FF6B6B" />
        <Text style={styles.stateTitle}>Well, that's awkward.</Text>
        <Text style={styles.stateBody}>
          We couldn't load trips just now. Give it another shot?
        </Text>
        <Pressable style={styles.secondaryBtn} onPress={() => refetch()}>
          <Text style={styles.secondaryBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // ── States C/D: empty ──
  if (trips.length === 0) {
    const noFilters = filtersAreEmpty(filters);
    if (noFilters) {
      // State C — no trips at all (sparse-data reality).
      return (
        <View
          style={[
            styles.centerState,
            { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom },
          ]}
        >
          <Icon name="compass-outline" size={48} color="rgba(255,255,255,0.5)" />
          <Text style={styles.stateTitle}>No trips yet — but they're coming.</Text>
          <Text style={styles.stateBody}>
            Planners are still mapping out group trips. Check back soon, or see
            what's happening near you.
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={onBrowseEvents}>
            <Text style={styles.secondaryBtnText}>Browse events</Text>
          </Pressable>
        </View>
      );
    }
    // State D — filters too narrow.
    return (
      <View style={{ flex: 1 }}>
        <View style={[styles.filterRowSlot, { marginTop: contentPaddingTop }]}>
          <TripFilterChips filters={filters} onChange={setFilters} />
        </View>
        <View style={[styles.centerState, { paddingBottom: contentPaddingBottom }]}>
          <Icon name="options-outline" size={48} color="rgba(255,255,255,0.5)" />
          <Text style={styles.stateTitle}>Nothing matches those filters.</Text>
          <Text style={styles.stateBody}>
            Try widening your dates, budget, or where you're headed.
          </Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => setFilters(EMPTY_DISCOVER_TRIP_FILTERS)}
          >
            <Text style={styles.primaryBtnText}>Clear filters</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── State E/F: populated (incl. single result) ──
  return (
    <FlatList
      data={trips}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={
        <View style={styles.filterRowSlot}>
          <TripFilterChips filters={filters} onChange={setFilters} />
        </View>
      }
      contentContainerStyle={{
        paddingTop: contentPaddingTop,
        paddingBottom: contentPaddingBottom,
        paddingHorizontal: g.grid.horizontalPadding,
      }}
      ItemSeparatorComponent={() => <View style={{ height: g.grid.rowGap }} />}
      showsVerticalScrollIndicator={false}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footerLoader}>
            <ActivityIndicator color={glass.chrome.active.glowColor} />
          </View>
        ) : null
      }
    />
  );
};

export const TripsContent = React.memo(TripsContentImpl);

const styles = StyleSheet.create({
  stateWrap: { flex: 1 },
  filterRowSlot: {
    marginBottom: 4,
    marginHorizontal: -g.grid.horizontalPadding, // chips row owns its own padding
  },
  listPad: {
    paddingHorizontal: g.grid.horizontalPadding,
    gap: g.grid.rowGap,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 8,
  },
  stateBody: {
    fontSize: 15,
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    lineHeight: 21,
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: "#FF6B35",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  secondaryBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  footerLoader: { paddingVertical: 20 },
  skeletonCard: {
    width: "100%",
    aspectRatio: 1.45,
    borderRadius: g.card.radius,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "flex-end",
    padding: 14,
    gap: 8,
  },
  skeletonBarTitle: {
    height: 16,
    width: "60%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  skeletonBarMeta: {
    height: 12,
    width: "40%",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});

export default TripsContent;
