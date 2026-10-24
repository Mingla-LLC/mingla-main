import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { CityPickerSheet } from "./discover/CityPickerSheet";
import { DiscoverCard } from "./discover/DiscoverCard";
import { DiscoverEmptyState } from "./discover/DiscoverEmptyState";
import { DiscoverGridSkeleton } from "./discover/DiscoverGridSkeleton";
import { DiscoverHeader } from "./discover/DiscoverHeader";
import ExpandedCardModal from "./ExpandedCardModal";
import { toastManager } from "./ui/Toast";
import type { DiscoverPillRowHandle } from "./discover/DiscoverPillRow";
import { FilterDropdown } from "./discover/FilterDropdown";
import { discoverFilterSelectionCount, selectedDiscoverFilterLabels } from "./discover/discoverFilterState";
import { useCoachMark } from "../hooks/useCoachMark";
import { useCoachMarkContext } from "../contexts/CoachMarkContext";
import { useDiscoverCityWatch } from "../hooks/useDiscoverCityWatch";
import { useDiscoverFacets } from "../hooks/useDiscoverFacets";
import { useDiscoverFeed } from "../hooks/useDiscoverFeed";
import { discoverKeys, savedCardKeys } from "../hooks/queryKeys";
import { useSavedCards } from "../hooks/useSavedCards";
import { useUserLocation } from "../hooks/useUserLocation";
import { geocodingService } from "../services/geocodingService";
import { mixpanelService } from "../services/mixpanelService";
import { captureConsumerOfferingEngagement } from "../services/offeringEngagementService";
import { PreferencesService } from "../services/preferencesService";
import { savedCardsService } from "../services/savedCardsService";
import { openExpandedCardContentShare } from "../services/contentShareController";
import { useAppStore } from "../store/appStore";
import type { DiscoverCity } from "../types/discoverFilters";
import { DISCOVER_KIND_ORDER, emptyDiscoverFilters, type DiscoverAnchorV2, type DiscoverCardV2, type DiscoverFiltersV2, type DiscoverKind } from "../types/discoverFeed";
import type { ExpandedCardData } from "../types/expandedCardTypes";
import type { ExpansionTarget } from "../types/expansion";
import { discoverQueryAnchorKey, readLastResolvedDiscoverCity, writeResolvedDiscoverCity } from "../utils/discoverEventsCache";

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

function initialCity(): DiscoverCity | null {
  const cached = readLastResolvedDiscoverCity();
  return cached ? { ...cached } : null;
}

function entityType(card: Extract<DiscoverCardV2, { source: "mingla" }>) {
  if (card.kind === "trip") return "trip" as const;
  if (card.kind === "experience") return "experience" as const;
  if (card.kind === "stay") return "venue" as const;
  return "event" as const;
}

function DiscoverScreen({ preferencesRefreshKey, accountPreferences }: DiscoverScreenProps): React.ReactElement {
  const renderCountRef = useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] DiscoverScreen: ${renderCountRef.current}`);
  }
  const { t } = useTranslation(["discover", "common", "modals"]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAppStore((state) => state.user);
  const selectedKindStore = useAppStore((state) => state.discoverSelectedKind);
  const filtersStore = useAppStore((state) => state.discoverFiltersByKind);
  const setSelectedKindStore = useAppStore((state) => state.setDiscoverSelectedKind);
  const setFiltersStore = useAppStore((state) => state.setDiscoverFiltersByKind);
  const coachPills = useCoachMark(4, 18);
  const coachFilters = useCoachMark(5, 18);
  const { skipStep: skipCoachStep, setStepCopyOverride } = useCoachMarkContext();
  const pillRowRef = useRef<DiscoverPillRowHandle>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [city, setCity] = useState<DiscoverCity | null>(initialCity);
  const [selectedKind, setSelectedKind] = useState<DiscoverKind>(selectedKindStore ?? "events");
  const [appliedFilters, setAppliedFilters] = useState<DiscoverFiltersV2>(filtersStore[selectedKind] ?? emptyDiscoverFilters(selectedKind));
  const [facetFilters, setFacetFilters] = useState<DiscoverFiltersV2>(appliedFilters);
  const [debouncedFacetFilters, setDebouncedFacetFilters] = useState<DiscoverFiltersV2>(appliedFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchorTop, setFilterAnchorTop] = useState(150);
  const [expansionTarget, setExpansionTarget] = useState<ExpansionTarget | null>(null);
  const location = useUserLocation(user?.id, "solo");
  const saved = useSavedCards(user?.id);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void PreferencesService.getUserPreferences(user.id).then((preferences) => {
      if (cancelled || !preferences) return;
      const { discover_city_name: name, discover_city_state_code: stateCode, discover_city_country_code: countryCode, discover_city_lat: lat, discover_city_lng: lng } = preferences;
      if (typeof name === "string" && typeof lat === "number" && typeof lng === "number") setCity({ name, stateCode: stateCode ?? null, countryCode: countryCode ?? null, lat, lng });
    });
    return () => { cancelled = true; };
  }, [user?.id, preferencesRefreshKey]);

  useEffect(() => {
    if (city || typeof location.data?.lat !== "number" || typeof location.data?.lng !== "number") return;
    const lat = location.data.lat;
    const lng = location.data.lng;
    let cancelled = false;
    void geocodingService.reverseGeocode(lat, lng).then((place) => {
      if (cancelled || !place.city) return;
      const next = { name: place.city, stateCode: place.state ?? null, countryCode: place.countryCode ?? null, lat, lng };
      setCity(next);
      writeResolvedDiscoverCity(lat, lng, next);
    });
    return () => { cancelled = true; };
  }, [city, location.data]);

  const anchor = useMemo<DiscoverAnchorV2 | null>(() => city ? { name: city.name, stateCode: city.stateCode, countryCode: city.countryCode, lat: city.lat, lng: city.lng, radiusKm: SEARCH_RADIUS_KM } : null, [city]);
  const anchorKey = useMemo(() => anchor ? discoverQueryAnchorKey({ kind: "city", cityName: anchor.name ?? "", cityLat: anchor.lat, cityLng: anchor.lng }) : "none", [anchor]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFacetFilters(facetFilters), 250);
    return () => clearTimeout(timer);
  }, [facetFilters]);
  const facets = useDiscoverFacets(anchorKey, anchor, debouncedFacetFilters);
  const feed = useDiscoverFeed(anchorKey, anchor, appliedFilters);
  const visibleKinds = useMemo(() => DISCOVER_KIND_ORDER.filter((kind) => (facets.data?.kinds[kind].total ?? 0) > 0), [facets.data?.kinds]);
  const cityWatch = useDiscoverCityWatch({ cityKey: facets.data?.city.key ?? null, userId: user?.id ?? null, anchor, label: facets.data?.city.label ?? city?.name ?? null });

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
    if (coachPills.isActive && !facets.isLoading && visibleKinds.length < 2) {
      skipCoachStep(4);
    }
  }, [coachPills.isActive, facets.isLoading, skipCoachStep, visibleKinds.length]);

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

  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data?.pages]);
  const savedIds = useMemo(() => new Set((saved.data ?? []).map((item) => item.id)), [saved.data]);
  const selectionCount = discoverFilterSelectionCount(appliedFilters);
  const selectedLabels = selectedDiscoverFilterLabels(appliedFilters, facets.data?.groups ?? []);
  const filterLabel = selectedLabels.length > 0 ? t("filters.button_selected", { summary: selectedLabels.slice(0, 2).join(" · ") }) : t("filters.button", "Filters");
  const total = facets.data?.selected.total ?? 0;
  const countLabel = visibleKinds.length === 0
    ? t("count.nothing", "Nothing yet")
    : facets.data?.selected.tm?.capped
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
    void captureConsumerOfferingEngagement({ brandId: card.brand.id, entityType: entityType(card), entityId: card.id }, "app_open");
    router.push({ pathname: card.route.pathname as never, params: card.route.params } as never);
  }, [router]);

  const refresh = useCallback(() => { void queryClient.invalidateQueries({ queryKey: discoverKeys.all }); }, [queryClient]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 320 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, [feed]);

  const cityEmpty = !facets.isLoading && facets.data && visibleKinds.length === 0;
  const filteredEmpty = !feed.isLoading && !cityEmpty && items.length === 0;
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
      <DiscoverHeader ref={pillRowRef} title={t("title", "Discover")} cityUnsetLabel={t("city.set", "Set city")} cityLabel={city?.name ?? null} cityA11y={city ? t("city.a11y", { city: city.name }) : t("city.a11y_unset", "Set your city for Discover")} visibleKinds={visibleKinds} selectedKind={selectedKind} kindLabels={kindLabels} resultLabel={countLabel} filterLabel={filterLabel} filterCount={selectionCount} filterOpen={filterOpen} filterDisabled={Boolean(cityEmpty)} onCityPress={() => setCityPickerOpen(true)} onKindSelect={switchKind} onFilterPress={(anchorTop) => { setFilterAnchorTop(anchorTop); setFilterOpen((open) => !open); }} pillTargetRef={coachPills.targetRef} filterTargetRef={coachFilters.targetRef} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} refreshControl={<RefreshControl refreshing={facets.isRefetching || feed.isRefetching} onRefresh={refresh} tintColor="#eb7825" />} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}>
        {facets.isLoading || feed.isLoading ? <DiscoverGridSkeleton /> : null}
        {facets.error || feed.error ? <DiscoverEmptyState mode="filters" title={t("error.title", "Something went wrong")} body={t("error.subtitle", "Pull down to retry, or check your connection.")} primaryLabel={t("error.retry", "Retry")} onPrimary={refresh} /> : null}
        {cityEmpty ? <DiscoverEmptyState mode="city" title={t("empty.city_title", { city: city?.name ?? "your city" })} body={t("empty.city_body", "Hosts are joining. We'll tell you when the first plans go live.")} primaryLabel={cityWatch.subscribed ? t("empty.notify_done", "We'll tell you") : t("empty.notify", "Tell me when")} undoLabel={t("empty.notify_undo", "Undo")} primaryA11y={t("empty.notify_a11y", { city: city?.name ?? "your city" })} doneA11y={t("empty.notify_done_a11y", { city: city?.name ?? "your city" })} subscribed={cityWatch.subscribed} loading={cityWatch.pending} nearest={facets.data?.nearestCity} onPrimary={() => { void toggleCityWatch(); }} onUndo={() => { void toggleCityWatch(); }} onNearest={() => facets.data?.nearestCity && setCity({ name: facets.data.nearestCity.label, stateCode: null, countryCode: null, lat: facets.data.nearestCity.lat, lng: facets.data.nearestCity.lng })} /> : null}
        {filteredEmpty ? <DiscoverEmptyState mode="filters" title={t("empty.filtered_title_generic", "Nothing matches those filters")} body={t("empty.filtered_body", "Here's what is on instead.")} primaryLabel={t("empty.clear_filters", "Clear filters")} onPrimary={() => { const cleared = emptyDiscoverFilters(selectedKind); setAppliedFilters(cleared); setFacetFilters(cleared); }} /> : null}
        {items.length > 0 ? <><View style={styles.heading}><Text style={styles.headingTitle}>{t("section.mingla", "From Mingla hosts")}</Text><Text style={styles.headingMeta}>{t("section.mingla_sub", "Book in the app")}</Text></View><View style={styles.grid}>{items.map((card, index) => <React.Fragment key={`${card.source}:${card.id}`}>{card.source === "ticketmaster" && index > 0 && items[index - 1]?.source !== "ticketmaster" ? <View style={styles.divider}><Text style={styles.headingTitle}>{t("section.tm", "More events nearby")}</Text><View style={styles.line} /></View> : null}<DiscoverCard card={card} saved={savedIds.has(card.id)} onPress={() => openCard(card)} onSave={() => { void toggleSave(card); }} /></React.Fragment>)}</View></> : null}
        {feed.isFetchingNextPage ? <Text style={styles.more}>{t("loading.more", "Loading more…")}</Text> : null}
      </ScrollView>
      <FilterDropdown visible={filterOpen} anchorTop={filterAnchorTop} groups={facets.data?.groups ?? []} filters={facetFilters} resultCount={facets.data?.selected.total ?? 0} priceBands={facets.data?.priceBands ?? null} onDraftChange={setFacetFilters} onApply={(next) => { setAppliedFilters(next); setFacetFilters(next); setFiltersStore({ ...filtersStore, [selectedKind]: next }); setFilterOpen(false); }} onClose={() => { setFacetFilters(appliedFilters); setFilterOpen(false); }} t={(key, values) => t(key, values)} />
      <CityPickerSheet visible={cityPickerOpen} userId={user?.id ?? null} currentCity={city} onClose={() => setCityPickerOpen(false)} onCityPicked={(next) => { setCity(next); writeResolvedDiscoverCity(next.lat, next.lng, next); }} />
      <ExpandedCardModal visible={expansionTarget !== null} target={expansionTarget} onClose={() => setExpansionTarget(null)} onSave={async () => { if (expansionTarget?.kind === "nightOut") await toggleSave({ source: "ticketmaster", kind: "event", id: expansionTarget.data.id, title: expansionTarget.data.title, venueName: expansionTarget.data.nightOutData?.venueName ?? "", imageUrl: expansionTarget.data.image, startsLocalDate: expansionTarget.data.nightOutData?.date ?? "", startsLocalTime: expansionTarget.data.nightOutData?.time ?? null, genre: expansionTarget.data.nightOutData?.genre ?? null, price: null, ticketStatus: expansionTarget.data.nightOutData?.ticketStatus ?? "", ticketUrl: expansionTarget.data.nightOutData?.ticketUrl ?? "", raw: {} }); }} onShare={(card) => openExpandedCardContentShare(card, "discover_expanded")} shareProducerSurface="discover_expanded" isSaved={expansionTarget?.kind === "nightOut" ? savedIds.has(expansionTarget.data.id) : false} currentMode="solo" accountPreferences={accountPreferences} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101216" }, content: { flexGrow: 1 },
  heading: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headingTitle: { color: "#fff", fontSize: 13, fontWeight: "600" }, headingMeta: { color: "rgba(255,255,255,.5)", fontSize: 11 },
  grid: { paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  divider: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 2 }, line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,.12)" },
  more: { color: "rgba(255,255,255,.55)", textAlign: "center", paddingVertical: 18 },
});

export default React.memo(DiscoverScreen);
