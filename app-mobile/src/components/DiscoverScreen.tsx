import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { CityPickerSheet } from "./discover/CityPickerSheet";
import { DiscoverCard } from "./discover/DiscoverCard";
import { DiscoverEmptyState } from "./discover/DiscoverEmptyState";
import { DiscoverGridSkeleton } from "./discover/DiscoverGridSkeleton";
import { DiscoverHeader } from "./discover/DiscoverHeader";
import { discoverLoadState } from "./discover/discoverLoadState";
import { canonicalDiscoverCardPath } from "./discover/discoverCardRoute";
import { DISCOVER_GRID_GAP, DISCOVER_GRID_SIDE_PADDING, discoverGridCellWidth } from "./discover/discoverGridLayout";
import ExpandedCardModal from "./ExpandedCardModal";
import { toastManager } from "./ui/Toast";
import type { DiscoverPillRowHandle } from "./discover/DiscoverPillRow";
import { FilterDropdown } from "./discover/FilterDropdown";
import { discoverCountIsCapped, discoverFilterSelectionCount, selectedDiscoverFilterLabels } from "./discover/discoverFilterState";
import { useCoachMark } from "../hooks/useCoachMark";
import { useCoachMarkContext } from "../contexts/CoachMarkContext";
import { shouldSkipDiscoverPillCoachStep } from "../contexts/coachMarkSkipState";
import { useDiscoverCityWatch } from "../hooks/useDiscoverCityWatch";
import { discoverFacetsQueryOptions, useDiscoverFacets } from "../hooks/useDiscoverFacets";
import { discoverFeedQueryOptions, useDiscoverFeed } from "../hooks/useDiscoverFeed";
import { discoverKeys, discoverLastCityKeys } from "../hooks/discoverQueryKeys";
import { savedCardKeys, userPreferencesKeys } from "../hooks/queryKeys";
import { fetchUserPreferences } from "../hooks/useUserPreferences";
import { useSavedCards } from "../hooks/useSavedCards";
import { useUserLocation } from "../hooks/useUserLocation";
import { geocodingService } from "../services/geocodingService";
import { mixpanelService } from "../services/mixpanelService";
import { offlineService } from "../services/offlineService";
import { PreferencesService } from "../services/preferencesService";
import { captureConsumerOfferingEngagement } from "../services/offeringEngagementService";
import { savedCardsService } from "../services/savedCardsService";
import { discoverCityWatchService } from "../services/discoverCityWatchService";
import { openExpandedCardContentShare } from "../services/contentShareController";
import { useAppStore } from "../store/appStore";
import type { DiscoverCity } from "../types/discoverFilters";
import { DISCOVER_KIND_ORDER, emptyDiscoverFilters, type DiscoverAnchorV2, type DiscoverCardV2, type DiscoverFiltersV2, type DiscoverKind } from "../types/discoverFeed";
import type { ExpandedCardData } from "../types/expandedCardTypes";
import type { ExpansionTarget } from "../types/expansion";
import type { UserPreferences } from "../types/preferences";
import { asRememberedDiscoverCity, deviceCityStillValid, discoverAnchorReady, discoverCityFromPreferences, discoverQueryAnchorKey, reconcileDiscoverCity, sameDiscoverAnchorCity, type DiscoverCitySource, type RememberedDiscoverCity } from "../utils/discoverEventsCache";
import { dedupeDiscoverFeedCards } from "../utils/discoverFeedDedupe";

interface DiscoverScreenProps {
  isTabVisible?: boolean;
  onOpenChatWithUser?: (userId: string) => void;
  onViewFriendProfile?: (userId: string) => void;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
  preferencesRefreshKey?: number;
  deepLinkParams?: Record<string, string> | null;
  onDeepLinkHandled?: () => void;
  onOpenPreferences?: () => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenTrip?: (seed: import("../services/tripsDiscoveryService").DiscoverTripRow) => void;
}

const SEARCH_RADIUS_KM = 50;
const PREFERENCES_GATE_MAX_WAIT_MS = 1_500;
// Same freshness as useUserPreferences: a Discover revisit inside a minute
// reuses the cached preferences row instead of reading it again.
const USER_PREFERENCES_FRESH_MS = 60_000;

function anchorFor(city: DiscoverCity): DiscoverAnchorV2 {
  return { name: city.name, stateCode: city.stateCode, countryCode: city.countryCode, lat: city.lat, lng: city.lng, radiusKm: SEARCH_RADIUS_KM };
}

function anchorKeyFor(city: DiscoverCity): string {
  return discoverQueryAnchorKey({ kind: "city", cityName: city.name ?? "", cityLat: city.lat, cityLng: city.lng });
}

function entityType(card: Extract<DiscoverCardV2, { source: "mingla" }>) {
  if (card.kind === "trip") return "trip" as const;
  if (card.kind === "experience") return "experience" as const;
  if (card.kind === "stay") return "venue" as const;
  return "event" as const;
}

function DiscoverScreen({ preferencesRefreshKey, accountPreferences, deepLinkParams, onDeepLinkHandled }: DiscoverScreenProps): React.ReactElement {
  const renderCountRef = useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] DiscoverScreen: ${renderCountRef.current}`);
  }
  const { t } = useTranslation(["discover", "common", "modals"]);
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const gridCellWidth = discoverGridCellWidth(viewportWidth);
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAppStore((state) => state.user);
  const selectedKindStore = useAppStore((state) => state.discoverSelectedKind);
  const filtersStore = useAppStore((state) => state.discoverFiltersByKind);
  const setSelectedKindStore = useAppStore((state) => state.setDiscoverSelectedKind);
  const setFiltersStore = useAppStore((state) => state.setDiscoverFiltersByKind);
  const pendingWatchCity = useAppStore((state) => state.discoverPendingWatchCity);
  const setPendingWatchCity = useAppStore((state) => state.setDiscoverPendingWatchCity);
  const coachPills = useCoachMark(4, 18);
  const coachFilters = useCoachMark(5, 18);
  const { skipStep: skipCoachStep, setStepCopyOverride } = useCoachMarkContext();
  const pillRowRef = useRef<DiscoverPillRowHandle>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  // #4265: the city this user last saw on Discover (persisted with the React
  // Query cache, so it survives a cold start). Painting starts from it at once.
  const [seed] = useState<{ userId: string; remembered: RememberedDiscoverCity } | null>(() => {
    if (!user?.id) return null;
    const remembered = asRememberedDiscoverCity(queryClient.getQueryData(discoverLastCityKeys.forUser(user.id)));
    return remembered ? { userId: user.id, remembered } : null;
  });
  const [city, setCity] = useState<DiscoverCity | null>(() => (seed ? { ...seed.remembered.city } : null));
  const cityRef = useRef(city);
  const citySourceRef = useRef<DiscoverCitySource | null>(seed?.remembered.source ?? null);
  const swapTokenRef = useRef(0);
  const paintedAnchorKeyRef = useRef("none");
  const firstPreferencesRefreshKeyRef = useRef(preferencesRefreshKey);
  const [deviceResolveRequested, setDeviceResolveRequested] = useState(false);
  const [preferencesSettledFor, setPreferencesSettledFor] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<DiscoverKind>(selectedKindStore ?? "events");
  const [appliedFilters, setAppliedFilters] = useState<DiscoverFiltersV2>(filtersStore[selectedKind] ?? emptyDiscoverFilters(selectedKind));
  const [facetFilters, setFacetFilters] = useState<DiscoverFiltersV2>(appliedFilters);
  const [debouncedFacetFilters, setDebouncedFacetFilters] = useState<DiscoverFiltersV2>(appliedFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expansionTarget, setExpansionTarget] = useState<ExpansionTarget | null>(null);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const gridTopRef = useRef(0);
  const cardLayoutsRef = useRef(new Map<string, { y: number; height: number; card: DiscoverCardV2 }>());
  const viewportRef = useRef({ top: 0, height: 0 });
  const visibleSinceRef = useRef(new Map<string, number>());
  const viewedRef = useRef(new Set<string>());
  const impressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useUserLocation(user?.id, "solo");
  const saved = useSavedCards(user?.id);
  const preferencesSettled = discoverAnchorReady({ userId: user?.id ?? null, preferencesSettledFor, seededAtMount: seed !== null && seed.userId === user?.id });
  const appliedFiltersRef = useRef(appliedFilters);
  const facetFiltersRef = useRef(debouncedFacetFilters);
  appliedFiltersRef.current = appliedFilters;
  facetFiltersRef.current = debouncedFacetFilters;

  // Remember a city for this user (next mount paints from it) and record where it came from.
  const rememberCity = useCallback((next: DiscoverCity, source: DiscoverCitySource) => {
    citySourceRef.current = source;
    if (!user?.id) return;
    queryClient.setQueryData<RememberedDiscoverCity>(discoverLastCityKeys.forUser(user.id), {
      city: { name: next.name, stateCode: next.stateCode, countryCode: next.countryCode, lat: next.lat, lng: next.lng },
      source,
    });
  }, [queryClient, user?.id]);

  // Move to another city. While cards for the current anchor are on screen, the
  // new city's feed and counts are fetched first and the city changes only once
  // they are in the cache — one swap, no skeleton, no slide (#4258 order kept).
  const swapToCity = useCallback((next: DiscoverCity, source: DiscoverCitySource) => {
    const token = ++swapTokenRef.current;
    if (paintedAnchorKeyRef.current === "none") {
      setCity(next);
      rememberCity(next, source);
      return;
    }
    const nextKey = anchorKeyFor(next);
    const nextAnchor = anchorFor(next);
    void Promise.all([
      queryClient.prefetchInfiniteQuery(discoverFeedQueryOptions(nextKey, nextAnchor, appliedFiltersRef.current)),
      queryClient.prefetchQuery(discoverFacetsQueryOptions(nextKey, nextAnchor, facetFiltersRef.current)),
    ]).finally(() => {
      // A prefetch failure is not swallowed: the live queries for the new key
      // show their own error state once the city changes.
      if (swapTokenRef.current !== token) return;
      setCity(next);
      rememberCity(next, source);
    });
  }, [queryClient, rememberCity]);

  useEffect(() => {
    cityRef.current = city;
  }, [city]);

  useEffect(() => {
    const watchCity = deepLinkParams?.watchCity?.trim();
    if (!watchCity) return;
    setPendingWatchCity(watchCity);
    onDeepLinkHandled?.();
  }, [deepLinkParams?.watchCity, onDeepLinkHandled, setPendingWatchCity]);

  useEffect(() => {
    if (!pendingWatchCity || !user?.id) return;
    let cancelled = false;
    void discoverCityWatchService.status(pendingWatchCity).then((watch) => {
      if (cancelled || !watch) return;
      const watched = {
        name: watch.cityName ?? watch.cityLabel,
        stateCode: watch.stateCode,
        countryCode: watch.countryCode,
        lat: watch.lat,
        lng: watch.lng,
      };
      swapTokenRef.current += 1;
      setCity(watched);
      rememberCity(watched, "transient");
    }).catch((error) => {
      console.warn("[Discover] watch-city deep link could not be restored", error);
    }).finally(() => {
      if (!cancelled) setPendingWatchCity(null);
    });
    return () => { cancelled = true; };
  }, [pendingWatchCity, rememberCity, setPendingWatchCity, user?.id]);

  // Saved-city preference: settle the gate and reconcile the city on screen.
  // #4265: read from the React Query cache first (no network inside a minute),
  // then the local mirror, then the row itself only when the cache is stale. A
  // bump of preferencesRefreshKey (the user saved preferences) always re-reads.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    let cancelled = false;
    const forceFresh = preferencesRefreshKey !== firstPreferencesRefreshKeyRef.current;
    const capId = setTimeout(() => {
      if (!cancelled) setPreferencesSettledFor(userId);
    }, PREFERENCES_GATE_MAX_WAIT_MS);

    const apply = (preferences: UserPreferences | null | undefined): void => {
      if (cancelled) return;
      const current = cityRef.current ? { city: cityRef.current, source: citySourceRef.current ?? "transient" } : null;
      const decision = reconcileDiscoverCity(current, preferences);
      if (decision.kind === "swap") {
        swapToCity({ ...decision.city }, "preferences");
      } else if (decision.kind === "resolve-device") {
        setDeviceResolveRequested(true);
      } else if (current && citySourceRef.current !== "preferences" && discoverCityFromPreferences(preferences ?? null)) {
        rememberCity(current.city, "preferences");
      }
    };

    void (async () => {
      const cached = forceFresh ? undefined : queryClient.getQueryData<UserPreferences | null>(userPreferencesKeys.detail(userId));
      if (cached !== undefined) {
        apply(cached);
        if (!cancelled) setPreferencesSettledFor(userId);
      } else {
        try {
          const mirrored = await offlineService.getOfflineUserPreferences();
          if (cancelled) return;
          if (discoverCityFromPreferences(mirrored)) {
            apply(mirrored);
            setPreferencesSettledFor(userId);
          }
        } catch (error) {
          // A missing or corrupt mirror only means the row owns the seed.
          console.warn("[Discover] preferences mirror unreadable", error);
        }
      }

      try {
        const preferences = await queryClient.fetchQuery({
          queryKey: userPreferencesKeys.detail(userId),
          queryFn: ({ signal }) => fetchUserPreferences(userId, signal),
          staleTime: forceFresh ? 0 : USER_PREFERENCES_FRESH_MS,
        });
        apply(preferences);
      } catch (error) {
        console.warn("[Discover] preferences read failed; keeping the current city", error);
      } finally {
        if (!cancelled) setPreferencesSettledFor(userId);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(capId);
    };
  }, [preferencesRefreshKey, queryClient, rememberCity, swapToCity, user?.id]);

  // Device city: resolve one when there is no city, when preferences asked for it
  // (no saved city), or when a remembered GPS city is now far from the device.
  const preferencesReadFor = preferencesSettledFor === user?.id;
  useEffect(() => {
    if (typeof location.data?.lat !== "number" || typeof location.data?.lng !== "number") return;
    const lat = location.data.lat;
    const lng = location.data.lng;
    const current = cityRef.current;
    if (current && !deviceResolveRequested) {
      if (citySourceRef.current !== "device" || !preferencesReadFor) return;
      if (deviceCityStillValid(current, lat, lng)) return;
    }
    let cancelled = false;
    void geocodingService.reverseGeocode(lat, lng).then((place) => {
      if (cancelled) return;
      setDeviceResolveRequested(false);
      if (!place.city) return;
      const next = { name: place.city, stateCode: place.state ?? null, countryCode: place.countryCode ?? null, lat, lng };
      if (current && sameDiscoverAnchorCity(current, next)) {
        if (citySourceRef.current !== "device") rememberCity(current, "device");
        return;
      }
      swapToCity(next, "device");
    }).catch((error) => {
      console.warn("[Discover] could not name the device city", error);
    });
    return () => { cancelled = true; };
  }, [city, deviceResolveRequested, location.data, preferencesReadFor, rememberCity, swapToCity]);

  const anchor = useMemo<DiscoverAnchorV2 | null>(() => (city ? anchorFor(city) : null), [city]);
  const activeAnchor = preferencesSettled ? anchor : null;
  const anchorKey = useMemo(() => activeAnchor ? discoverQueryAnchorKey({ kind: "city", cityName: activeAnchor.name ?? "", cityLat: activeAnchor.lat, cityLng: activeAnchor.lng }) : "none", [activeAnchor]);
  paintedAnchorKeyRef.current = anchorKey;
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFacetFilters(facetFilters), 250);
    return () => clearTimeout(timer);
  }, [facetFilters]);
  const facets = useDiscoverFacets(anchorKey, activeAnchor, debouncedFacetFilters);
  // ORCH-0839-A F-4: Discover stays server-authoritative. The V2 query hook
  // owns freshness; there is deliberately no local skipCache short-circuit.
  const feed = useDiscoverFeed(anchorKey, activeAnchor, appliedFilters);
  const visibleKinds = useMemo(() => DISCOVER_KIND_ORDER.filter((kind) => (facets.data?.kinds[kind].total ?? 0) > 0), [facets.data?.kinds]);
  const cityWatch = useDiscoverCityWatch({ cityKey: facets.data?.city.key ?? null, userId: user?.id ?? null, anchor: activeAnchor, label: facets.data?.city.label ?? city?.name ?? null });

  useEffect(() => {
    const resolved = visibleKinds.includes(selectedKind) ? selectedKind : visibleKinds[0];
    if (!resolved || resolved === selectedKind) return;
    setSelectedKind(resolved);
    setSelectedKindStore(resolved);
    const next = filtersStore[resolved] ?? emptyDiscoverFilters(resolved);
    setAppliedFilters(next);
    setFacetFilters(next);
  }, [filtersStore, selectedKind, setSelectedKindStore, visibleKinds]);

  useEffect(() => {
    if (coachPills.isActive) pillRowRef.current?.scrollToStart();
  }, [coachPills.isActive]);

  useEffect(() => {
    if (shouldSkipDiscoverPillCoachStep({
      active: coachPills.isActive,
      loading: facets.isLoading,
      error: Boolean(facets.error),
      hasData: Boolean(facets.data),
      visibleKindCount: visibleKinds.length,
    })) {
      skipCoachStep(4);
    }
  }, [coachPills.isActive, facets.data, facets.error, facets.isLoading, skipCoachStep, visibleKinds.length]);

  useEffect(() => {
    if (visibleKinds.length < 2 || visibleKinds.length === DISCOVER_KIND_ORDER.length) {
      setStepCopyOverride(4, null);
      return;
    }
    const names = visibleKinds.map((kind) => t(`pill.${kind}`, kind));
    const list = names.length === 2
      ? t("modals:coach.list_two", { a: names[0], b: names[1] })
      : t("modals:coach.list_three", { a: names[0], b: names[1], c: names[2] });
    setStepCopyOverride(4, {
      descriptionKey: "modals:coach.step4.body_subset",
      descriptionValues: { list },
    });
    return () => setStepCopyOverride(4, null);
  }, [setStepCopyOverride, t, visibleKinds]);

  const items = useMemo(
    () => dedupeDiscoverFeedCards(feed.data?.pages.flatMap((page) => page.items) ?? []),
    [feed.data?.pages],
  );
  const savedIds = useMemo(() => new Set((saved.data ?? []).map((item) => item.id)), [saved.data]);
  const selectionCount = discoverFilterSelectionCount(appliedFilters);
  const selectedLabels = selectedDiscoverFilterLabels(appliedFilters, facets.data?.groups ?? []);
  const filterLabel = selectedLabels.length > 0 ? t("filters.button_selected", { summary: selectedLabels.slice(0, 2).join(" · ") }) : t("filters.button", "Filters");
  const total = facets.data?.selected.total ?? 0;
  const loadState = discoverLoadState({
    anchorSet: anchor !== null,
    facetsLoaded: Boolean(facets.data),
    facetsFailed: Boolean(facets.error),
    feedLoaded: Boolean(feed.data),
    feedFailed: Boolean(feed.error),
    visibleKindCount: visibleKinds.length,
    itemCount: items.length,
  });
  const countLabel = loadState.countPending
    ? ""
    : visibleKinds.length === 0
    ? t("count.nothing", "Nothing yet")
    : discoverCountIsCapped(facets.data?.selected.tm ?? null)
      ? t("count.capped", { count: total, defaultValue: `${total}+` })
      : t(`count.${selectedKind}`, { count: total, defaultValue: `${total}` });
  const kindLabels: Record<DiscoverKind, string> = { events: t("pill.events", "Events"), experiences: t("pill.experiences", "Experiences"), trips: t("pill.trips", "Trips"), stays: t("pill.stays", "Stays") };

  const switchKind = useCallback((kind: DiscoverKind) => {
    if (kind === selectedKind) return;
    const cleared = emptyDiscoverFilters(kind);
    setFiltersStore({ ...filtersStore, [selectedKind]: emptyDiscoverFilters(selectedKind), [kind]: cleared });
    setSelectedKind(kind);
    setSelectedKindStore(kind);
    setAppliedFilters(cleared);
    setFacetFilters(cleared);
    setFilterOpen(false);
    mixpanelService.trackTabViewed({ screen: "discover", tab: kind });
  }, [filtersStore, selectedKind, setFiltersStore, setSelectedKindStore]);

  const toggleSave = useCallback(async (card: DiscoverCardV2) => {
    if (!user?.id) return;
    if (savedIds.has(card.id)) await savedCardsService.removeCard(user.id, card.id, "solo");
    else {
      const image = card.source === "mingla" ? card.coverUrl : card.imageUrl;
      await savedCardsService.saveCard(user.id, { id: card.id, title: card.title, category: card.kind, image, images: image ? [image] : [], source: "solo" }, "solo");
    }
    await queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });
  }, [queryClient, savedIds, user?.id]);

  const openCard = useCallback((card: DiscoverCardV2) => {
    if (card.source === "ticketmaster") {
      const raw = card.raw;
      const images = Array.isArray(raw.images)
        ? raw.images.flatMap((item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).url === "string" ? [(item as Record<string, unknown>).url as string] : [])
        : [];
      const price = card.price?.minMajor == null ? "" : `${card.price.currency} ${card.price.minMajor}`;
      const coordinates = typeof raw.lat === "number" && typeof raw.lng === "number" ? { lat: raw.lat, lng: raw.lng } : undefined;
      const expanded: ExpandedCardData = {
        id: card.id,
        title: card.title,
        category: "Night Out",
        categoryIcon: "moon-outline",
        description: card.venueName,
        fullDescription: `${card.title} at ${card.venueName}`,
        image: card.imageUrl,
        images: images.length > 0 ? images : [card.imageUrl].filter(Boolean),
        reviewCount: 0,
        priceRange: price || undefined,
        distance: null,
        address: typeof raw.address === "string" ? raw.address : card.venueName,
        highlights: [card.venueName, card.genre, price].filter((value): value is string => Boolean(value)),
        tags: card.genre ? [card.genre] : [],
        matchScore: 0,
        matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
        socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
        location: coordinates,
        nightOutData: {
          eventName: card.title,
          venueName: card.venueName,
          artistName: typeof raw.artistName === "string" ? raw.artistName : card.title,
          date: card.startsLocalDate,
          time: card.startsLocalTime ?? "",
          price,
          genre: card.genre ?? undefined,
          tags: card.genre ? [card.genre] : [],
          coordinates,
          ticketUrl: card.ticketUrl,
          ticketStatus: card.ticketStatus,
        },
      };
      setExpansionTarget({ kind: "nightOut", data: expanded });
      return;
    }
    const path = canonicalDiscoverCardPath(card);
    if (!path) {
      toastManager.show(t("error.open", "Couldn't open that page. Pull down to refresh and try again."), "error");
      return;
    }
    void captureConsumerOfferingEngagement({ brandId: card.brand.id, entityType: entityType(card), entityId: card.id }, "app_open");
    router.push(path as never);
  }, [router, t]);

  const refresh = useCallback(async () => {
    if (isPullRefreshing) return;
    setIsPullRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: discoverKeys.all });
    } finally {
      setIsPullRefreshing(false);
    }
  }, [isPullRefreshing, queryClient]);
  const evaluateViewability = useCallback(() => {
    const now = Date.now();
    const { top, height: viewportHeight } = viewportRef.current;
    const bottom = top + viewportHeight;
    for (const [key, layout] of cardLayoutsRef.current) {
      if (viewedRef.current.has(key) || layout.height <= 0 || viewportHeight <= 0) continue;
      const cardTop = gridTopRef.current + layout.y;
      const cardBottom = cardTop + layout.height;
      const visibleHeight = Math.max(0, Math.min(cardBottom, bottom) - Math.max(cardTop, top));
      if (visibleHeight / layout.height < 0.5) {
        visibleSinceRef.current.delete(key);
        continue;
      }
      const since = visibleSinceRef.current.get(key) ?? now;
      visibleSinceRef.current.set(key, since);
      if (now - since < 1_000) continue;
      viewedRef.current.add(key);
      visibleSinceRef.current.delete(key);
      mixpanelService.track("discover_card_viewed", { kind: layout.card.kind });
      if (layout.card.source === "mingla") {
        void captureConsumerOfferingEngagement({
          brandId: layout.card.brand.id,
          entityType: entityType(layout.card),
          entityId: layout.card.id,
        }, "app_impression");
      }
    }
    if (impressionTimerRef.current) clearTimeout(impressionTimerRef.current);
    if ([...visibleSinceRef.current.keys()].some((key) => !viewedRef.current.has(key))) {
      impressionTimerRef.current = setTimeout(evaluateViewability, 1_050);
    }
  }, []);

  useEffect(() => () => {
    if (impressionTimerRef.current) clearTimeout(impressionTimerRef.current);
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    viewportRef.current = { top: contentOffset.y, height: layoutMeasurement.height };
    evaluateViewability();
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 320 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, [evaluateViewability, feed]);

  const { cityEmpty, filteredEmpty } = loadState;
  // The picker saved discover_city_* to the preferences row. #4265: mirror that
  // into the cached row and the offline mirror, so the next mount (which now
  // trusts the cache) reconciles to the picked city, never the previous one.
  const onCityPicked = useCallback((next: DiscoverCity) => {
    swapTokenRef.current += 1;
    setCity(next);
    rememberCity(next, "preferences");
    if (!user?.id) return;
    const patch = {
      discover_city_name: next.name,
      discover_city_state_code: next.stateCode,
      discover_city_country_code: next.countryCode,
      discover_city_lat: next.lat,
      discover_city_lng: next.lng,
    };
    const updated = queryClient.setQueryData<UserPreferences | null>(userPreferencesKeys.detail(user.id), (previous) => (previous ? { ...previous, ...patch } : previous));
    void (async () => {
      const base = updated ?? await offlineService.getOfflineUserPreferences();
      if (base) await offlineService.cacheUserPreferences({ ...base, ...patch });
    })().catch((error) => {
      console.warn("[Discover] could not mirror the picked city", error);
    });
  }, [queryClient, rememberCity, user?.id]);
  // #4265: "Nearest city" is a real choice, like a picker pick. It shows at
  // once, then is saved to the preferences row exactly as the picker saves it
  // (and mirrored by onCityPicked), so a later preferences read never swaps
  // the screen back to the GPS city. A pick or swap made meanwhile wins.
  const nearestCity = facets.data?.nearestCity ?? null;
  const onNearestCity = useCallback(() => {
    if (!nearestCity) return;
    const next: DiscoverCity = { name: nearestCity.label, stateCode: null, countryCode: null, lat: nearestCity.lat, lng: nearestCity.lng };
    swapTokenRef.current += 1;
    citySourceRef.current = "transient";
    setCity(next);
    if (!user?.id) return;
    const token = swapTokenRef.current;
    void PreferencesService.updateUserPreferences(user.id, {
      discover_city_name: next.name,
      discover_city_state_code: next.stateCode,
      discover_city_country_code: next.countryCode,
      discover_city_lat: next.lat,
      discover_city_lng: next.lng,
    }).then(() => {
      if (swapTokenRef.current !== token) return;
      onCityPicked(next);
    }).catch((error: unknown) => {
      // The city stays on screen for this visit; it is just not remembered.
      console.warn("[Discover] could not save the nearest city", error);
    });
  }, [nearestCity, onCityPicked, user?.id]);
  const toggleCityWatch = useCallback(async () => {
    try {
      if (cityWatch.subscribed) {
        await cityWatch.unsubscribe();
        mixpanelService.track("Discover City Watch", { action: "undo", city_key: facets.data?.city.key });
      } else {
        await cityWatch.subscribe();
        mixpanelService.track("Discover City Watch", { action: "subscribe", city_key: facets.data?.city.key });
      }
    } catch {
      toastManager.show(t("empty.notify_error", "Couldn't save that. Try again."), "error");
    }
  }, [cityWatch, facets.data?.city.key, t]);
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <DiscoverHeader ref={pillRowRef} title={t("title", "Discover")} cityUnsetLabel={t("city.set", "Set city")} cityLabel={city?.name ?? null} cityA11y={city ? t("city.a11y", { city: city.name }) : t("city.a11y_unset", "Set your city for Discover")} visibleKinds={visibleKinds} selectedKind={selectedKind} kindLabels={kindLabels} resultLabel={countLabel} filterLabel={filterLabel} filterCount={selectionCount} filterOpen={filterOpen} filterDisabled={Boolean(cityEmpty)} onCityPress={() => setCityPickerOpen(true)} onKindSelect={switchKind} onFilterPress={() => { setFilterOpen((open) => !open); }} pillTargetRef={coachPills.targetRef} filterTargetRef={coachFilters.targetRef} />
      <ScrollView onLayout={(event) => { viewportRef.current = { ...viewportRef.current, height: event.nativeEvent.layout.height }; evaluateViewability(); }} onScroll={onScroll} scrollEventThrottle={32} refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={refresh} tintColor="#eb7825" title={isPullRefreshing ? t("loading.refreshing", "Refreshing events…") : undefined} titleColor="rgba(255,255,255,.72)" colors={["#eb7825"]} progressBackgroundColor="#1b1e24" />} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}>
        {loadState.showSkeleton ? <DiscoverGridSkeleton /> : null}
        {facets.error || feed.error ? <DiscoverEmptyState mode="filters" title={t("error.title", "Something went wrong")} body={t("error.subtitle", "Pull down to retry, or check your connection.")} primaryLabel={t("error.retry", "Retry")} onPrimary={refresh} /> : null}
        {cityEmpty ? <DiscoverEmptyState mode="city" title={t("empty.city_title", { city: city?.name ?? "your city" })} body={t("empty.city_body", "Hosts are joining. We'll tell you when the first plans go live.")} primaryLabel={cityWatch.subscribed ? t("empty.notify_done", "We'll tell you") : t("empty.notify", "Tell me when")} undoLabel={t("empty.notify_undo", "Undo")} primaryA11y={t("empty.notify_a11y", { city: city?.name ?? "your city" })} doneA11y={t("empty.notify_done_a11y", { city: city?.name ?? "your city" })} subscribed={cityWatch.subscribed} loading={cityWatch.pending} nearest={facets.data?.nearestCity} onPrimary={() => { void toggleCityWatch(); }} onUndo={() => { void toggleCityWatch(); }} onNearest={onNearestCity} /> : null}
        {filteredEmpty ? <DiscoverEmptyState mode="filters" title={t("empty.filtered_title_generic", "Nothing matches those filters")} body={t("empty.filtered_body", "Here's what is on instead.")} primaryLabel={t("empty.clear_filters", "Clear filters")} onPrimary={() => { const cleared = emptyDiscoverFilters(selectedKind); setAppliedFilters(cleared); setFacetFilters(cleared); }} /> : null}
        {items.length > 0 ? <>
          <View style={styles.grid} onLayout={(event) => { gridTopRef.current = event.nativeEvent.layout.y; evaluateViewability(); }}>
            {items.map((card) => {
              const key = `${card.source}:${card.id}`;
              return <View key={key} style={[styles.gridCell, { width: gridCellWidth }]} onLayout={(event) => { cardLayoutsRef.current.set(key, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height, card }); evaluateViewability(); }}>
                <DiscoverCard card={card} saved={savedIds.has(card.id)} onPress={() => { mixpanelService.track("discover_card_opened", { kind: card.kind }); openCard(card); }} onSave={() => { void toggleSave(card); }} />
              </View>;
            })}
          </View>
        </> : null}
        {feed.isFetchingNextPage ? (
          <View style={styles.more} accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={t("loading.more", "Loading more events")}>
            <ActivityIndicator size="small" color="#eb7825" />
            <Text style={styles.moreText}>{t("loading.more", "Loading more events…")}</Text>
          </View>
        ) : null}
      </ScrollView>
      <FilterDropdown visible={filterOpen} groups={facets.data?.groups ?? []} filters={facetFilters} resultCount={facets.data?.selected.total ?? 0} priceBands={facets.data?.priceBands ?? null} onDraftChange={setFacetFilters} onApply={(next) => { mixpanelService.track("discover_filter_applied", { kind: selectedKind, groups: Object.keys(next.f).sort(), option_count: discoverFilterSelectionCount(next), result_count: facets.data?.selected.total ?? 0 }); setAppliedFilters(next); setFacetFilters(next); setFiltersStore({ ...filtersStore, [selectedKind]: next }); setFilterOpen(false); }} onClose={() => { setFacetFilters(appliedFilters); setFilterOpen(false); }} t={(key, values) => t(key, values)} />
      <CityPickerSheet visible={cityPickerOpen} userId={user?.id ?? null} currentCity={city} onClose={() => setCityPickerOpen(false)} onCityPicked={onCityPicked} />
      <ExpandedCardModal visible={expansionTarget !== null} target={expansionTarget} onClose={() => setExpansionTarget(null)} onSave={async () => { if (expansionTarget?.kind === "nightOut") await toggleSave({ source: "ticketmaster", kind: "event", id: expansionTarget.data.id, title: expansionTarget.data.title, venueName: expansionTarget.data.nightOutData?.venueName ?? "", imageUrl: expansionTarget.data.image, startsLocalDate: expansionTarget.data.nightOutData?.date ?? "", startsLocalTime: expansionTarget.data.nightOutData?.time ?? null, genre: expansionTarget.data.nightOutData?.genre ?? null, price: null, ticketStatus: expansionTarget.data.nightOutData?.ticketStatus ?? "", ticketUrl: expansionTarget.data.nightOutData?.ticketUrl ?? "", raw: {} }); }} onShare={(card) => openExpandedCardContentShare(card, 'discover_expanded')} shareProducerSurface="discover_expanded" isSaved={expansionTarget?.kind === "nightOut" ? savedIds.has(expansionTarget.data.id) : false} currentMode="solo" accountPreferences={accountPreferences} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101216" }, content: { flexGrow: 1 },
  grid: { paddingHorizontal: DISCOVER_GRID_SIDE_PADDING, paddingTop: 8, flexDirection: "row", flexWrap: "wrap", gap: DISCOVER_GRID_GAP },
  gridCell: { minWidth: 0 },
  more: { minHeight: 52, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  moreText: { color: "rgba(255,255,255,.72)", textAlign: "center" },
});

export default React.memo(DiscoverScreen);
