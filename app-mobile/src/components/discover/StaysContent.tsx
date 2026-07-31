/** Discover > Stays feed body. Issue #1423. */

import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { glass } from "../../constants/designSystem";
import { useAppLayout } from "../../hooks/useAppLayout";
import { useDiscoverStays } from "../../hooks/useDiscoverStays";
import { postHogService } from "../../services/postHogService";
import {
  EMPTY_DISCOVER_STAY_FILTERS,
  type DiscoverStayFilters,
  type DiscoverStayRow,
} from "../../services/staysDiscoveryService";
import { useAppStore } from "../../store/appStore";
import { Icon } from "../ui/Icon";
import { StayCard } from "./StayCard";
import { StayFilterChips, type StayFilterField } from "./StayFilterChips";

interface Props {
  headerHeight: number;
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

function filtersAreDefault(filters: DiscoverStayFilters): boolean {
  return filters.destinationQuery === null
    && filters.checkIn === null
    && filters.checkOut === null
    && filters.adults === 2
    && filters.children === 0
    && filters.rooms === 1
    && filters.propertyKinds.length === 0
    && filters.amenities.length === 0
    && filters.confirmationMode === null;
}

const SkeletonCard: React.FC = () => (
  <View style={styles.skeletonCard} accessibilityLabel="Loading stay">
    <View style={styles.skeletonTitle} />
    <View style={styles.skeletonMeta} />
  </View>
);

const StateMessage: React.FC<{
  icon: "alert-circle-outline" | "moon-outline" | "options-outline" | "cloud-offline-outline";
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}> = ({ icon, title, body, action, onAction }) => (
  <View style={styles.centerState}>
    <Icon name={icon} size={46} color="rgba(255,255,255,0.55)" />
    <Text style={styles.stateTitle}>{title}</Text>
    <Text style={styles.stateBody}>{body}</Text>
    {action && onAction ? (
      <Pressable accessibilityRole="button" style={styles.action} onPress={onAction}>
        <Text style={styles.actionText}>{action}</Text>
      </Pressable>
    ) : null}
  </View>
);

const StaysContentImpl: React.FC<Props> = ({
  headerHeight,
  reduceTransparency,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bottomNavTotalHeight } = useAppLayout();
  const storedFilters = useAppStore.getState().discoverStayFilters as DiscoverStayFilters | null;
  const [filters, setLocalFilters] = useState<DiscoverStayFilters>(
    storedFilters ?? EMPTY_DISCOVER_STAY_FILTERS,
  );
  const initialScrollOffset = useRef(
    useAppStore.getState().tabScroll.discover_stays,
  ).current;
  const initialContentOffset = useRef({ x: 0, y: initialScrollOffset }).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 500,
  }).current;
  const setStoredFilters = useAppStore((state) => state.setDiscoverStayFilters);
  const setTabScroll = useAppStore((state) => state.setTabScroll);
  const seenIds = useRef(new Set<string>());

  const {
    stays,
    isFlagEnabled,
    isLoading,
    isError,
    isRefetchError,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useDiscoverStays(filters);

  const updateFilters = useCallback((next: DiscoverStayFilters, field: StayFilterField) => {
    const normalized: DiscoverStayFilters = {
      ...next,
      destinationQuery:
        next.destinationQuery?.trim().length ? next.destinationQuery.trim() : null,
    };
    setLocalFilters(normalized);
    setStoredFilters(normalized);
    postHogService.capture("stay_discover_filter_applied", {
      field,
      has_destination: normalized.destinationQuery !== null,
      has_dates: normalized.checkIn !== null && normalized.checkOut !== null,
      guests: normalized.adults + normalized.children,
      rooms: normalized.rooms,
      property_kind_count: normalized.propertyKinds.length,
      amenity_count: normalized.amenities.length,
      confirmation_mode: normalized.confirmationMode,
    });
  }, [setStoredFilters]);

  const clearFilters = useCallback(() => {
    updateFilters(EMPTY_DISCOVER_STAY_FILTERS, "clear");
  }, [updateFilters]);

  const openStay = useCallback((stay: DiscoverStayRow) => {
    postHogService.capture("stay_discover_card_opened", {
      venue_id: stay.venueId,
      property_kind: stay.propertyKind,
      currency_code: stay.currencyCode,
      availability_state: stay.availabilityState,
    });
    router.push({
      pathname: "/b/[brandSlug]/v/[venueSlug]",
      params: { brandSlug: stay.brandSlug, venueSlug: stay.venueSlug },
    });
  }, [router]);

  const onViewableItemsChanged = useRef((info: { viewableItems: ViewToken<DiscoverStayRow>[] }) => {
    for (const token of info.viewableItems) {
      const stay = token.item;
      if (!token.isViewable || seenIds.current.has(stay.venueId)) continue;
      seenIds.current.add(stay.venueId);
      postHogService.capture("stay_discover_card_viewed", {
        venue_id: stay.venueId,
        property_kind: stay.propertyKind,
        currency_code: stay.currencyCode,
      });
    }
  }).current;

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setTabScroll("discover_stays", event.nativeEvent.contentOffset.y);
  }, [setTabScroll]);

  const contentPaddingTop = headerHeight + 8;
  const contentPaddingBottom = bottomNavTotalHeight + insets.bottom + 16;
  const filtersSlot = (
    <View style={styles.filterSlot}>
      <StayFilterChips filters={filters} onChange={updateFilters} />
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.stateWrap, { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom }]}>
        {filtersSlot}
        <View style={styles.listPad}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (isFlagEnabled === false) {
    return (
      <View style={[styles.stateWrap, { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom }]}>
        <StateMessage
          icon="moon-outline"
          title="Stays are opening soon."
          body="Rooms and resort places are being prepared for discovery and reservations."
        />
      </View>
    );
  }

  if (isError && stays.length === 0) {
    return (
      <View style={[styles.stateWrap, { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom }]}>
        {filtersSlot}
        <StateMessage
          icon="cloud-offline-outline"
          title="We could not load stays."
          body="Check your connection and try again."
          action="Try again"
          onAction={refetch}
        />
      </View>
    );
  }

  if (stays.length === 0) {
    const noFilters = filtersAreDefault(filters);
    return (
      <View style={[styles.stateWrap, { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom }]}>
        {filtersSlot}
        <StateMessage
          icon={noFilters ? "moon-outline" : "options-outline"}
          title={noFilters ? "No stays are live yet." : "No stays match those filters."}
          body={noFilters
            ? "Verified properties with live rooms will appear here."
            : "Try changing your destination, dates, guests, rooms, or property filters."}
          action={noFilters ? undefined : "Clear filters"}
          onAction={noFilters ? undefined : clearFilters}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={stays}
      keyExtractor={(stay) => stay.venueId}
      renderItem={({ item }) => (
        <StayCard
          stay={item}
          reduceTransparency={reduceTransparency}
          onPress={openStay}
        />
      )}
      ListHeaderComponent={(
        <>
          {isRefetchError ? (
            <View style={styles.offlineBanner} accessibilityRole="alert">
              <Icon name="cloud-offline-outline" size={15} color="#FFD28A" />
              <Text style={styles.offlineText}>Showing saved results. Reconnect to refresh.</Text>
            </View>
          ) : null}
          {filtersSlot}
        </>
      )}
      contentOffset={initialContentOffset}
      contentContainerStyle={{
        paddingTop: contentPaddingTop,
        paddingBottom: contentPaddingBottom,
        paddingHorizontal: glass.discover.grid.horizontalPadding,
      }}
      ItemSeparatorComponent={() => <View style={{ height: glass.discover.grid.rowGap }} />}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={100}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      refreshing={isFetching && !isFetchingNextPage}
      onRefresh={refetch}
      ListFooterComponent={isFetchingNextPage ? (
        <View style={styles.footer}><ActivityIndicator color={glass.chrome.active.glowColor} /></View>
      ) : null}
    />
  );
};

export const StaysContent = React.memo(StaysContentImpl);

const styles = StyleSheet.create({
  stateWrap: { flex: 1 },
  filterSlot: {
    marginBottom: 8,
    marginHorizontal: -glass.discover.grid.horizontalPadding,
  },
  listPad: { paddingHorizontal: glass.discover.grid.horizontalPadding, gap: glass.discover.grid.rowGap },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  stateTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800", textAlign: "center", marginTop: 8 },
  stateBody: { color: "rgba(255,255,255,0.64)", fontSize: 15, lineHeight: 21, textAlign: "center" },
  action: {
    marginTop: 10,
    minHeight: 44,
    paddingHorizontal: 22,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF6B35",
  },
  actionText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  skeletonCard: {
    width: "100%",
    aspectRatio: 1.32,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "flex-end",
    padding: 16,
    gap: 8,
  },
  skeletonTitle: { width: "62%", height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.11)" },
  skeletonMeta: { width: "42%", height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "rgba(255,179,71,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,179,71,0.24)",
  },
  offlineText: { flex: 1, color: "#FFD28A", fontSize: 12, fontWeight: "600" },
  footer: { paddingVertical: 20 },
});
