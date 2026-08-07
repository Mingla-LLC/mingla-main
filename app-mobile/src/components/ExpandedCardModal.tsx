import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Animated,
  PanResponder,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from 'react-i18next';
import { Icon } from "./ui/Icon";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";
import { ExpandedCardModalProps, ExpandedCardData } from "../types/expandedCardTypes";
import type { CuratedExperienceCard, CuratedStop } from '../types/curatedExperience';
import { formatCurrency } from "./utils/formatters";
import { canonicalDiscoveryPriceDetail } from '../utils/priceTiers';
import { getReadableCategoryName } from "../utils/categoryUtils";  // ORCH-0685
import { weatherService, WeatherData } from "../services/weatherService";
import { busynessService, BusynessData } from "../services/busynessService";
import { bookingService, BookingOption } from "../services/bookingService";
import { stopReplacementService } from "../services/stopReplacementService"; // ORCH-0640 ch09: experienceGenerationService DELETED; methods moved to stopReplacementService
import { useRecommendationsOptional } from "../contexts/RecommendationsContext";
import ExpandedCardHeader from "./expandedCard/ExpandedCardHeader";
import CardInfoSection from "./expandedCard/CardInfoSection";
// #1605 wave 4 — WeatherSection + BusynessSection are DELETED. Two orange-tinted
// boxes with 26pt icon badges became two fact rows under one RIGHT NOW heading.
import ConditionsSection from "./expandedCard/ConditionsSection";
import PracticalDetailsSection from "./expandedCard/PracticalDetailsSection";
import { ExpandedCardHero } from "./expandedCard/ExpandedCardHero";
import StopList, { type StopListStop } from "./expandedCard/StopList";
import { Section, SectionError } from "./expandedCard/SpineParts";
import { SPINE, GALLERY } from "./expandedCard/spineTokens";
import { curatedPlanSpans, singlePlaceSpans, stopMetaText } from "./expandedCard/expandedCardFacts";
// The ONE Been-here state machine in the app. Declared in SwipeableCards.tsx (the
// #1687 gate delimits it there); imported here so the sheet mounts the SAME
// component rather than a second one in a different shape. The import edge is a
// documented, render-time-only cycle — see that component's header.
import { BeenHereControl } from "./SwipeableCards";
import ReservationPassSection from "./expandedCard/ReservationPassSection";
import TimelineSection from "./expandedCard/TimelineSection";
import EventDetailLayout from "./expandedCard/EventDetailLayout";
// ORCH-1072: brand experiences claimed-to-this-venue, rendered as compact rows
// beneath the stars/miles/price block and above the weather section.
import VenueExperiencesSection from "./expandedCard/VenueExperiencesSection";
// META-ORCH-1148 2.2b: consumer reserve-a-table for reservable venues. The
// affordance + 3-step sheet appear ONLY for a place whose verified-claimed
// brand has reservations enabled (useVenueReservable gate — no dead tap).
import VenueReserveSheet from "./expandedCard/VenueReserveSheet";
import { useVenueReservable } from "../hooks/useVenueReservable";
import { ImageLightbox } from "./ImageLightbox";
import ActionButtons from "./expandedCard/ActionButtons";
import ShareModal from "./ShareModal";
import InAppBrowserModal from "./InAppBrowserModal";
// ORCH-0824: business-event branch (renders when props.businessEvent is set and props.card is null).
import ConsumerExperienceDetailScreen from "../screens/Experience/ConsumerExperienceDetailScreen";
// ORCH-1138 Leg 2/3 — the deck EVENT card opens ConsumerEventDetailScreen and
// the deck/venue EXPERIENCE card opens ConsumerExperienceDetailScreen (above).
// Both go straight to TicketCartSheet (byte-identical checkout). EBES is fully
// decommissioned. I-PROPOSED-1138-EVENT-DECK-OFF-EBES + I-PROPOSED-1138-EBES-DELETED.
import ConsumerEventDetailScreen from "../screens/Event/ConsumerEventDetailScreen";
import type { BusinessEventCard } from "../types/mergedDiscover";

// ORCH-1138 Leg 3 — an experience card carries the multi-stop itinerary and/or
// the occurrence list; event/trip cards never do (the deck-experience mappers —
// SwipeableCards experienceRecToBusinessEventCard + venueExperienceMapping — are
// the only producers). Used to route a `businessEvent` card to the right
// foundation detail screen.
function isExperienceCard(card: BusinessEventCard): boolean {
  return (
    (Array.isArray(card.experienceStops) && card.experienceStops.length > 0) ||
    Array.isArray(card.upcomingOccurrences)
  );
}
import { useReplaceStop } from '../hooks/useReplaceStop';
import { estimateTravelMinutes, haversineKm, replaceStopInCard, StopAlternative } from '../utils/mutateCuratedCard';
import * as Haptics from 'expo-haptics';
import { glass } from "../constants/designSystem";
// ORCH-0908: lock-in banner + Add-to-Calendar CTA
import { DeviceCalendarService } from "../services/deviceCalendarService";
import { CalendarService } from "../services/calendarService";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { toastManager } from "./ui/Toast";
import { useWindowDimensions } from "react-native";
import { useUserLocation } from "../hooks/useUserLocation";


// ============================================================================
// ORCH-0908 — LockedInBanner: shown at top of ExpandedCardModal when a card
// was shared via lock-and-schedule. Renders the scheduled date/time + an
// Add-to-Calendar CTA that flips to "Added ✓" once the viewer's
// calendar_entries row has device_calendar_event_id set.
// ============================================================================
function LockedInBanner({ card }: { card: ExpandedCardData }) {
  const { user } = useAppStore();
  const userId = user?.id ?? null;
  const [deviceCalEventId, setDeviceCalEventId] = useState<string | null>(null);
  const [calendarEntryId, setCalendarEntryId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Look up the viewer's calendar_entries row for this saved card. We need
  // both the calendar_entries.id (to UPDATE later) and the device event id
  // (so the CTA can flip to "Added").
  useEffect(() => {
    if (!card.lockInEvent || !card.savedCardId || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('calendar_entries')
        .select('id, device_calendar_event_id')
        .eq('board_card_id', card.savedCardId)
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled || !data) return;
      setCalendarEntryId(data.id as string);
      if (data.device_calendar_event_id) {
        setDeviceCalEventId(data.device_calendar_event_id as string);
      }
    })();
    return () => { cancelled = true; };
  }, [card.lockInEvent, card.savedCardId, userId]);

  if (card.lockInEvent !== 'card_locked_and_scheduled' || !card.scheduledAt) return null;

  const scheduled = new Date(card.scheduledAt);
  const dateLabel = scheduled.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const alreadyAdded = !!deviceCalEventId;

  const handleAddToCalendar = async () => {
    if (alreadyAdded || adding || !userId || !card.savedCardId) return;
    setAdding(true);
    try {
      const event = DeviceCalendarService.createEventFromCard(
        {
          id: card.id,
          title: card.title,
          category: card.category,
          address: card.address,
          location: card.location,
        },
        scheduled,
        card.durationMinutes || 60,
      );
      const newDeviceEventId = await DeviceCalendarService.addEventToDeviceCalendar(event);
      if (newDeviceEventId) {
        setDeviceCalEventId(newDeviceEventId);
        // Persist on calendar_entries so other surfaces (and the realtime
        // auto-add in useSocialRealtime) know the viewer already has it.
        if (calendarEntryId) {
          await CalendarService.updateEntry(calendarEntryId, userId, {
            device_calendar_event_id: newDeviceEventId,
          });
        }
      }
    } catch (err) {
      // Swallow — surface via no-state-change so the user can retry.
      console.warn('[ORCH-0908] Add-to-calendar failed', err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <View style={lockedBannerStyles.container}>
      <View style={lockedBannerStyles.row}>
        <Icon name="lock-closed" size={16} color="#fff" />
        <Text style={lockedBannerStyles.label} numberOfLines={1}>
          {`Locked in · ${dateLabel}`}
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleAddToCalendar}
        disabled={alreadyAdded || adding}
        style={[
          lockedBannerStyles.cta,
          alreadyAdded && lockedBannerStyles.ctaDone,
        ]}
        activeOpacity={0.8}
      >
        <Icon
          name={alreadyAdded ? 'checkmark-circle' : 'calendar-outline'}
          size={14}
          color={alreadyAdded ? 'hsl(140, 50%, 35%)' : 'hsl(28, 80%, 45%)'}
        />
        <Text style={[
          lockedBannerStyles.ctaText,
          alreadyAdded && lockedBannerStyles.ctaDoneText,
        ]}>
          {alreadyAdded ? 'Added' : adding ? 'Adding…' : 'Add to Calendar'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const lockedBannerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'hsl(28, 80%, 45%)',
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  label: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#fff', borderRadius: 16,
  },
  ctaDone: { backgroundColor: 'rgba(255,255,255,0.85)' },
  ctaText: { color: 'hsl(28, 80%, 45%)', fontSize: 12, fontWeight: '600' },
  ctaDoneText: { color: 'hsl(140, 50%, 35%)' },
});

/**
 * #1605 wave 4 — `curatedStyles`, `CuratedPlanView`, `MultiStopPlanView` and
 * `StopOpenBadge` ARE DELETED. ~640 lines, and every one of them existed because
 * the same screen was built twice.
 *
 * What went, and why:
 *
 *   `curatedStyles.header`  the dark #1C1C1E slab. Full-bleed with SQUARE corners
 *                           starting 24pt below the sheet's 28pt ROUNDED ones — a
 *                           black rectangle framed in white, and the only reason
 *                           the sheet's `theme` had to be keyed on `isNightOut`.
 *                           Its four pieces are re-homed, not lost: the title to
 *                           the hero, the tagline to the body description, the
 *                           price/time/rating summary row to the plate's meta
 *                           line, and the "Customized" badge to the Plan
 *                           section's heading chip.
 *   `MultiStopPlanView`     a second, parallel composition. Its stop cards are
 *                           now `StopList` at a fixed 72pt; its per-stop
 *                           `StopImageGallery` and its alternatives strip were
 *                           the NESTED SCROLLABLES (N+1 horizontal ScrollViews
 *                           inside a gorhom sheet, each fighting the sheet's pan);
 *                           its `Animated.stagger(120, …350ms)` per-stop entry
 *                           took 1.4 SECONDS to render ten rows and is the exact
 *                           shape that produced #1576; and its action row sat
 *                           MID-SCROLL with Weather, Busyness and Timeline below
 *                           it, which is the split the action band closes.
 *   `StopOpenBadge`         computed against the DEVICE clock — it never received
 *                           a UTC offset. `StopList` renders the badge iff the
 *                           offset is known.
 *
 * The `TimelineSection` render for a curated card goes with them: it was a
 * SECOND full drawing of the same stops on the same screen, and its orange spine
 * at `left: 30` was painted over by every opaque step card, so it has never been
 * visible.
 */

export default function ExpandedCardModal({
  visible,
  target,
  onClose,
  onSave,
  onPurchase,
  onShare,
  userPreferences,
  accountPreferences,
  isSaved,
  currentMode = "solo",
  onCardRemoved,
  onStrollDataFetched,
  onPicnicDataFetched,
  // ORCH-0659/0660: hideTravelTime prop deleted — was dead code (zero callers).
  onNavigateNext,
  onNavigatePrevious,
  navigationIndex,
  navigationTotal,
  onPaywallRequired,
  canAccessCurated = true,
  reservationPass,
}: ExpandedCardModalProps) {
  // ORCH-0828: project the union back to the legacy `card` / `businessEvent`
  // local bindings used throughout the rest of this large component. The
  // PROP-level mutual exclusion is enforced by the discriminated-union type
  // (`ExpansionTarget`); below this point we still branch by which local is
  // non-null. Hooks above the early-return must not depend on these bindings.
  const card = target?.kind === "nightOut" ? target.data : null;
  const businessEvent = target?.kind === "businessEvent" ? target.data : null;

  // ORCH-1194 — the deck EXPERIENCE card opens via the /exp/ ROUTE (a navigation,
  // like trips), NOT the in-place ExpandedCardModal mount. The in-deck mount makes
  // gorhom mis-measure the sheet (black band below the body + a clipped, untappable
  // reserve bar on both platforms); the /exp/ route mount — the SAME one trips and
  // the cold deep-link use — measures correctly. So: navigate to the route + close
  // this card; the experience branch in the render below returns null. (Venue-opened
  // experiences keep their in-place sub-sheet — a separate path.)
  const router = useRouter();
  const experienceDeckTarget =
    businessEvent !== null &&
    businessEvent !== undefined &&
    isExperienceCard(businessEvent)
      ? businessEvent
      : null;
  useEffect(() => {
    if (
      visible &&
      experienceDeckTarget !== null &&
      experienceDeckTarget.brandSlug.length > 0 &&
      experienceDeckTarget.eventSlug.length > 0
    ) {
      router.push(
        `/exp/${experienceDeckTarget.brandSlug}/${experienceDeckTarget.eventSlug}` as never,
      );
      onClose();
    }
  }, [visible, experienceDeckTarget, router, onClose]);

  const { t } = useTranslation(['cards', 'common']);
  const { user } = useAppStore();
  const viewerLocationQuery = useUserLocation(user?.id, currentMode);
  const viewerLoc = viewerLocationQuery.data;
  // Issue #1540 P1-1 — this modal is mounted BOTH on the deck (where
  // RecommendationsProvider exists) and from ViewFriendProfileScreen, which also
  // renders under the `/exp/`, `/t/` and `/e/` detail routes where it does NOT.
  // Those routes have no provider and no ErrorBoundary, so the throwing
  // `useRecommendations()` red-screened them. The optional accessor returns null
  // off-deck; both values below degrade to exactly what the provider itself would
  // have supplied there — see each fallback.
  const deck = useRecommendationsOptional();
  // The provider hardcodes `collabTravelMode: null` (ORCH-0902 CR-7 — travel mode
  // is per-participant now and computed server-side), so `null` here is not a
  // degraded value, it is the SAME value. The fallback chain below is unchanged.
  const collabTravelMode = deck?.collabTravelMode ?? null;
  // Patches the deck's `recommendations` array and the deck cards cache for the
  // card with this id. Off-deck there is no deck array and no deck cache, so
  // there is nothing to patch and skipping it is correct, not lossy: the modal's
  // own display was already updated by `setStrollData` at the call site, and DB
  // persistence runs through the separate `onStrollDataFetched` prop.
  const updateCardStrollData = deck?.updateCardStrollData;
  // In collaboration mode, use the group's aggregated travel mode (majority vote).
  // In solo mode, fall back to the user's own preference.
  const effectiveTravelMode = collabTravelMode ?? userPreferences?.travel_mode ?? 'driving';
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [busynessData, setBusynessData] = useState<BusynessData | null>(null);
  const [bookingOptions, setBookingOptions] = useState<BookingOption[]>([]);
  const [viewerTravelTime, setViewerTravelTime] = useState<string | null>(null);
  const [viewerDistance, setViewerDistance] = useState<number | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [loadingBusyness, setLoadingBusyness] = useState(false);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [strollData, setStrollData] = useState(card?.strollData);
  const [loadingStrollData, setLoadingStrollData] = useState(false);
  const [picnicData, setPicnicData] = useState(card?.picnicData);
  const [loadingPicnicData, setLoadingPicnicData] = useState(false);
  const [isNightOutShareOpen, setIsNightOutShareOpen] = useState(false);
  const [seatMapFailed, setSeatMapFailed] = useState(false);
  const [ticketBrowserUrl, setTicketBrowserUrl] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserTitle, setBrowserTitle] = useState('');
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  const [curatedLightbox, setCuratedLightbox] = useState<{ visible: boolean; images: string[]; initialIndex: number }>({
    visible: false,
    images: [],
    initialIndex: 0,
  });
  // ORCH-1072 — the experience opened from the VenueExperiencesSection. The
  // ExpandedBusinessEventSheet renders as a SIBLING of the root sheet (below);
  // while it is open the root sheet is gated off, mirroring the browser/share
  // child-surface pattern.
  const [selectedVenueExperience, setSelectedVenueExperience] =
    useState<BusinessEventCard | null>(null);

  // ── #1605 wave 4 — the spine's own state ─────────────────────────────────
  const { height: windowHeight } = useWindowDimensions();
  /**
   * The sheet's resolved height at the 90% snap, so the hero can take what the
   * fold leaves (`expandedHeroHeight`). `wrapInRNModal` makes the percentage
   * resolve against the FULL physical screen, which is why this reads the window
   * and not a measured parent — a measured parent is exactly the flex-axis
   * dependence I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE forbids.
   */
  const sheetHeight = Math.round(windowHeight * 0.9);
  const scrollRef = useRef<ScrollView>(null);
  const [planSectionY, setPlanSectionY] = useState(0);
  /**
   * The user's LOCAL edits to a curated plan (a replaced stop). `null` until the
   * first replacement, so "customized" is a real state rather than the reference
   * inequality it used to be — and it RESETS when the card changes, which the
   * old `useState(card)` inside MultiStopPlanView never did (a prop change
   * without a remount left the previous plan on screen).
   */
  const [curatedLocalCard, setCuratedLocalCard] = useState<CuratedExperienceCard | null>(null);
  const {
    alternatives,
    isLoading: isLoadingAlts,
    error: altsError,
    fetchAlternatives,
    clearAlternatives,
  } = useReplaceStop();
  const [replacingStopIndex, setReplacingStopIndex] = useState<number | null>(null);

  // META-ORCH-1148 2.2b — reservable-venue gate for the consumer reserve flow.
  // card.id is a place_pool.id; the hook is disabled (no fetch) for non-uuid ids
  // (stroll/picnic/curated/Ticketmaster). reservable=false → no affordance.
  const { data: venueReservable } = useVenueReservable(card?.id);
  const [isReserveSheetOpen, setIsReserveSheetOpen] = useState(false);

  const anyChildModalOpen =
    browserUrl !== null ||
    ticketBrowserUrl !== null ||
    isNightOutShareOpen ||
    isSchedulePickerOpen ||
    curatedLightbox.visible ||
    selectedVenueExperience !== null ||
    isReserveSheetOpen;

  const handleRootSheetClose = useCallback(() => {
    // ORCH-1022: while a child RN Modal/WebView is open, the root sheet is
    // intentionally suppressed to free the native presentation slot. Swallow
    // BaseBottomSheet's synthetic close so the card state is not torn down.
    if (browserUrl !== null || ticketBrowserUrl !== null || isNightOutShareOpen || isSchedulePickerOpen || curatedLightbox.visible || selectedVenueExperience !== null || isReserveSheetOpen) {
      return;
    }
    onClose();
  }, [browserUrl, curatedLightbox.visible, isNightOutShareOpen, isSchedulePickerOpen, onClose, ticketBrowserUrl, selectedVenueExperience, isReserveSheetOpen]);

  // Review navigation: horizontal swipe to cycle through reviewed cards
  const hasNavigation = onNavigateNext !== undefined || onNavigatePrevious !== undefined;
  const onNavigateNextRef = useRef(onNavigateNext);
  const onNavigatePreviousRef = useRef(onNavigatePrevious);
  onNavigateNextRef.current = onNavigateNext;
  onNavigatePreviousRef.current = onNavigatePrevious;

  const reviewSwipeResponder = useMemo(() => {
    if (!hasNavigation) return null;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 40,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -60 && onNavigateNextRef.current) {
          onNavigateNextRef.current();
        } else if (gs.dx > 60 && onNavigatePreviousRef.current) {
          onNavigatePreviousRef.current();
        }
      },
    });
  }, [hasNavigation]);

  // Fetch additional data when modal opens
  useEffect(() => {
    if (visible && card) {
      fetchAdditionalData();
      if ((card as any).cardType !== 'curated') {
        setStrollData(card.strollData);
        setPicnicData(card.picnicData);
      }
    } else {
      // Reset state when modal closes
      setWeatherData(null);
      setBusynessData(null);
      setBookingOptions([]);
      setViewerTravelTime(null);
      setViewerDistance(null);
      setStrollData(undefined);
      setPicnicData(undefined);
      setSeatMapFailed(false);
      setTicketBrowserUrl(null);
      setBrowserUrl(null);
      setBrowserTitle('');
      setIsNightOutShareOpen(false);
      setIsSchedulePickerOpen(false);
      setCuratedLightbox({ visible: false, images: [], initialIndex: 0 });
    }
    // A replaced stop belongs to the card it was replaced on. The old
    // `useState(card)` inside MultiStopPlanView had no sync effect at all, so on
    // the deck — a single stable mount whose `target` prop changes — a previous
    // plan could survive onto the next card.
    setCuratedLocalCard(null);
    setReplacingStopIndex(null);
    clearAlternatives();
  }, [visible, card, viewerLoc?.lat, viewerLoc?.lng, effectiveTravelMode]);

  const computeViewerTravelForChatMount = () => {
    if (!card) return;
    const isChatMounted = !!(card as any).lockInEvent || (!card.travelTime && !card.distance);
    if (!isChatMounted || viewerLoc?.lat == null || viewerLoc?.lng == null) {
      setViewerDistance(null);
      setViewerTravelTime(null);
      return;
    }

    const isCurated = (card as any).cardType === 'curated';
    const firstStop = isCurated ? (card as any).stops?.[0] : null;
    const targetLat = isCurated ? firstStop?.lat ?? card.location?.lat : card.location?.lat;
    const targetLng = isCurated ? firstStop?.lng ?? card.location?.lng : card.location?.lng;

    if (typeof targetLat !== 'number' || typeof targetLng !== 'number') {
      setViewerDistance(null);
      setViewerTravelTime(null);
      return;
    }

    const distKm = haversineKm(viewerLoc.lat, viewerLoc.lng, targetLat, targetLng);
    const minutes = estimateTravelMinutes(distKm, effectiveTravelMode);
    setViewerDistance(Math.round(distKm * 10) / 10);
    setViewerTravelTime(`${minutes} min`);
  };

  const fetchAdditionalData = async () => {
    if (!card) return;
    if ((card as any).cardType === 'curated') {
      // For curated cards, fetch weather then busyness for the first stop's location
      const curatedCard = card as any;
      const firstStop = curatedCard.stops?.[0];
      if (firstStop?.lat && firstStop?.lng) {
        // Fetch weather first (provides utcOffsetSeconds for busyness timezone)
        let weather: WeatherData | null = null;
        setLoadingWeather(true);
        try {
          weather = await weatherService.getWeatherForecast(
            firstStop.lat,
            firstStop.lng,
            new Date()
          );
          setWeatherData(weather);
        } catch (error) {
          console.error('Error fetching curated weather:', error);
          setWeatherData(null);
        } finally {
          setLoadingWeather(false);
        }

        // Fetch busyness for first stop (with category + timezone from weather)
        setLoadingBusyness(true);
        try {
          const busyness = await busynessService.getVenueBusyness(
            firstStop.placeName,
            firstStop.lat,
            firstStop.lng,
            firstStop.address,
            firstStop.placeId,
            card.category,
            weather?.utcOffsetSeconds
          );
          setBusynessData(busyness);
        } catch (error) {
          console.error('Error fetching curated busyness:', error);
        } finally {
          setLoadingBusyness(false);
        }
      }
      computeViewerTravelForChatMount();
      return; // Still return — skip booking fetch (curated cards have per-stop links)
    }

    // Fetch weather first (provides utcOffsetSeconds for busyness timezone)
    let weather: WeatherData | null = null;
    if (card.location) {
      setLoadingWeather(true);
      try {
        weather = await weatherService.getWeatherForecast(
          card.location.lat,
          card.location.lng,
          new Date()
        );
        setWeatherData(weather);
      } catch (error) {
        console.error("Error fetching weather in modal:", error);
        setWeatherData(null);
      } finally {
        setLoadingWeather(false);
      }
    }

    // Fetch busyness data (with category + timezone from weather)
    if (card.location) {
      setLoadingBusyness(true);
      try {
        const busyness = await busynessService.getVenueBusyness(
          card.title,
          card.location.lat,
          card.location.lng,
          card.address,
          // ORCH-0910: chat-mounted cards carry placeId at top level; deck-mounted cards may carry it under .source.
          (card.placeId ?? (card as any).source?.placeId),
          card.category,
          weather?.utcOffsetSeconds
        );
        setBusynessData(busyness);
      } catch (error) {
        console.error("Error fetching busyness:", error);
      } finally {
        setLoadingBusyness(false);
      }
    }

    computeViewerTravelForChatMount();

    // Fetch booking options
    if (card.location) {
      setLoadingBooking(true);
      try {
        const booking = await bookingService.getBookingOptions(
          card.title,
          card.category,
          card.location.lat,
          card.location.lng,
          card.website,
          card.phone
        );
        setBookingOptions(booking.options);
      } catch (error) {
        console.error("Error fetching booking options:", error);
      } finally {
        setLoadingBooking(false);
      }
    }
  };

  const fetchStrollData = async () => {
    if (!card) return;

    const isStrollCard =
      card.category?.toLowerCase().includes("stroll") ||
      card.category?.toLowerCase() === "take a stroll" ||
      card.category?.toLowerCase() === "take-a-stroll" ||
      card.category?.toLowerCase() === "take_a_stroll";

    if (!isStrollCard) return;

    // Create anchor from card data
    const anchor =
      strollData?.anchor ||
      (card.location && card.title
        ? {
            id: card.id,
            name: card.title,
            location: { lat: card.location.lat, lng: card.location.lng },
            address: card.address,
          }
        : null);

    if (!anchor) {
      console.warn("⚠️ Cannot fetch stroll data: missing anchor information");
      return;
    }

    setLoadingStrollData(true);
    try {
      const fetchedStrollData =
        await stopReplacementService.fetchCompanionStrollData(anchor);
      if (fetchedStrollData) {
        setStrollData(fetchedStrollData);
        // Update the card's strollData in the context and cache
        if (card) {
          // Optional-chained: undefined off-deck (issue #1540 P1-1). See the
          // useRecommendationsOptional() block near the top of this component.
          updateCardStrollData?.(card.id, fetchedStrollData);
          // Persist to database if callback is provided (for saved cards)
          if (onStrollDataFetched) {
            await onStrollDataFetched(card, fetchedStrollData);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching companion stroll data:", err);
    } finally {
      setLoadingStrollData(false);
    }
  };

  const fetchPicnicData = async () => {
    if (!card) return;

    const isPicnicCard =
      card.category === 'Picnic Date';

    if (!isPicnicCard) return;

    // Create picnic object from card data
    const picnic =
      picnicData?.picnic ||
      (card.location && card.title
        ? {
            id: card.id,
            name: card.title,
            title: card.title,
            location: { lat: card.location.lat, lng: card.location.lng },
            address: card.address,
          }
        : null);

    if (!picnic) {
      console.warn("⚠️ Cannot fetch picnic data: missing picnic information");
      return;
    }

    setLoadingPicnicData(true);
    try {
      const fetchedPicnicData =
        await stopReplacementService.fetchPicnicGroceryData(picnic);
      if (fetchedPicnicData) {
        setPicnicData(fetchedPicnicData);
        // Persist to database if callback is provided (for saved cards)
        if (onPicnicDataFetched) {
          await onPicnicDataFetched(card, fetchedPicnicData);
        }
      }
    } catch (err) {
      console.error("Error fetching picnic grocery data:", err);
    } finally {
      setLoadingPicnicData(false);
    }
  };

  // [ORCH-0696 S-1] BottomSheet chrome wiring. `insets` MUST be declared BEFORE
  // the `if (!card) return null` early return below — React rules-of-hooks
  // requires every hook call in same order every render.
  // META-ORCH-0991 Wave A — open/close + backdrop (opacity 0.55) + RN-Modal
  // z-stacking wrap are now owned by BaseBottomSheet (wrapInRNModal). The prior
  // bottomSheetRef + snapToIndex(1)/close effect + renderBackdrop +
  // handleSheetChange are removed; the primitive routes index -1 → onClose.
  const insets = useSafeAreaInsets();

  // ORCH-0824: business-event branch. Mutually exclusive with `card` by
  // contract — DiscoverScreen clears one before setting the other. If a
  // caller accidentally passes both, the business-event branch wins (QA
  // F-3 fix): the place/TM render path requires many fields that
  // BusinessEventCard doesn't have, so place-priority would crash; the
  // business-event sheet is self-contained and safe to render.
  // Hooks above this point fire on every render regardless to satisfy
  // rules-of-hooks.
  if (businessEvent !== null && businessEvent !== undefined) {
    // ORCH-1138 Leg 3 — the deck EXPERIENCE card opens the NEW foundation
    // experience detail (ConsumerExperienceDetailScreen). An experience card
    // carries experienceStops/upcomingOccurrences (event/trip cards never do —
    // the discriminator the deck-experience mapper guarantees, SwipeableCards
    // experienceRecToBusinessEventCard). NEVER ExpandedBusinessEventSheet (EBES
    // decommissioned). I-PROPOSED-1138-EBES-DELETED.
    if (isExperienceCard(businessEvent)) {
      // ORCH-1194 — handled by the navigation effect above: the deck experience card
      // opens the /exp/ route (correct mount) instead of this in-place sheet (which
      // banded + clipped the reserve bar). Render nothing while the route takes over.
      return null;
    }
    // ORCH-1138 Leg 2 — the deck EVENT card opens the foundation event detail
    // (ConsumerEventDetailScreen) DIRECTLY. Get-tickets opens TicketCartSheet
    // directly → byte-identical ticket-checkout-create.
    // I-PROPOSED-1138-EVENT-DECK-OFF-EBES.
    return (
      <ConsumerEventDetailScreen
        seed={businessEvent}
        onBack={onClose}
        tabBarAware={false}
      />
    );
  }

  if (!card) {
    return null;
  }

  const isCuratedCard = (card as any).cardType === 'curated';
  const curatedCard = isCuratedCard ? (card as unknown as CuratedExperienceCard) : null;

  const isStrollCard =
    !isCuratedCard &&
    (card.category === "Take a Stroll" ||
      card.category?.toLowerCase().includes("stroll"));

  const isPicnicCard =
    !isCuratedCard &&
    card.category === 'Picnic Date';

  const isNightOut = !isCuratedCard && !!card.nightOutData;
  const nightOut = isCuratedCard ? null : card.nightOutData;

  // ───────────────────────────────────────────────────────────────────────────
  // #1605 wave 4 — ONE SPINE. `isCurated` appears in exactly TWO expressions
  // below (which facts the plate's spans come from, and whether the sliver stack
  // and the Plan section render) and in NO geometry, colour or section-order
  // expression. Everything else is present-or-absent by DATA.
  // ───────────────────────────────────────────────────────────────────────────
  const planCard = curatedLocalCard ?? curatedCard;
  const planStops: CuratedStop[] = Array.isArray(planCard?.stops) ? planCard!.stops : [];

  /**
   * THE COVER. `images[0] ?? stops[0].imageUrl ?? null` — ONE decode, never N.
   *
   * This is the resolution `MessageBubble` already uses for the in-chat card
   * (`intentHeroImage`), so a plan resolves the same way on every surface. A plan
   * had NO hero image at all before this wave: `ImageGallery` was gated behind
   * `!isCuratedCard`, so the only thing at the top of a plan was a black slab.
   *
   * The remaining stop photographs stay on their own stop rows, which is why the
   * Gallery section does not render for a plan — not because of a branch, but
   * because a plan has no second photo OF ITS OWN.
   */
  const heroCover: string | null =
    (Array.isArray(card.images) && card.images.length > 0 ? card.images[0] : null) ??
    (planStops.length > 0 ? planStops[0].imageUrl ?? null : null) ??
    null;

  const planPriceLabel =
    planCard == null
      ? null
      : planCard.totalPriceMin === 0 && planCard.totalPriceMax === 0
        ? t('cards:swipeable.free')
        : `${formatCurrency(planCard.totalPriceMin, accountPreferences?.currency || 'USD')}–${formatCurrency(planCard.totalPriceMax, accountPreferences?.currency || 'USD')}`;

  const planDurationLabel = (() => {
    if (planStops.length === 0) return null;
    // Only REAL per-stop durations count. `cardConverters.ts` synthesises 60
    // minutes a stop for a curated card, and a total built out of synthesised
    // parts is a fabricated total (Constitution 9).
    const stopMinutes = planStops.reduce(
      (sum, st) =>
        sum +
        (typeof st.estimatedDurationMinutes === 'number' && st.estimatedDurationMinutes > 0
          ? st.estimatedDurationMinutes
          : 0),
      0,
    );
    const travelMinutes = planStops
      .slice(1)
      .reduce((sum, st) => sum + (st.travelTimeFromPreviousStopMin ?? 0), 0);
    const total = Math.round(stopMinutes + travelMinutes);
    if (total <= 0) return null;
    const hrs = Math.floor(total / 60);
    const mins = total % 60;
    return hrs > 0 ? (mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`) : `${mins}m`;
  })();

  /**
   * The body's prose. A single place's is the venue owner's pitch
   * (`card.description`, META-ORCH-1290's only route to a buyer on the deck); a
   * plan's is its TAGLINE, which the deleted dark header used to carry at 14pt on
   * rgba(255,255,255,0.7) and which the single-place branch dropped on the floor
   * along with the rest of CardInfoSection.
   *
   * One slot, two sources — the same shape as the meta spans, and the reason this
   * is a DATA difference rather than a second composition.
   */
  const bodyDescription = isCuratedCard ? planCard?.tagline : card.description;

  const heroSpans = isCuratedCard && planCard
    ? curatedPlanSpans(planCard, {
        planPriceLabel,
        planDurationLabel,
        stopCountLabel:
          planStops.length > 0
            ? t('cards:expanded.stop_count', {
                defaultValue: '{{count}} stops',
                count: planStops.length,
              })
            : null,
      })
    : singlePlaceSpans(card, {
        measurementSystem: accountPreferences?.measurementSystem,
      });

  /** The venue's UTC offset, top-level or legacy-cased. Absent = no badge. */
  const cardUtcOffsetMinutes = card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null;

  const planListStops: StopListStop[] = planStops.map((stop, i) => ({
    key: `${stop.placeId ?? 'stop'}_${i}`,
    index: i + 1,
    indexLabel: String(i + 1),
    name: stop.placeName,
    imageUrl:
      (Array.isArray(stop.imageUrls) && stop.imageUrls.length > 0 ? stop.imageUrls[0] : null) ??
      stop.imageUrl ??
      null,
    meta: stopMetaText(stop, (minutes) =>
      t('cards:expanded.minutes_here', { defaultValue: '{{count}} min here', count: minutes }),
    ),
    address: stop.address ?? null,
    description: stop.aiDescription ?? null,
    openingHours: stop.openingHours,
    // A stop carries no offset today, so the badge hides rather than lying about
    // a Lagos venue against a London clock. Producer-side; see #1605's D2.
    utcOffsetMinutes: (stop as { utcOffsetMinutes?: number | null }).utcOffsetMinutes ?? null,
    travelMinutes: stop.travelTimeFromPreviousStopMin ?? null,
    travelMode: stop.travelModeFromPreviousStop ?? null,
    canReplace: !stop.optional,
  }));

  /**
   * The companion stops of a single place — a stroll's, a picnic's, and the
   * picnic's grocery store — through the SAME component as the Plan.
   *
   * A stroll IS a multi-stop plan with a different producer, so it gets the same
   * furniture: one component, two producers. This is what deletes the ~80 inline
   * lines of grocery-store block (it becomes ONE row with a `SHOP` chip) and the
   * 2.54:1 #9CA3AF text that `CompanionStopsSection` shipped.
   */
  const companionStops: StopListStop[] = (() => {
    const rows: StopListStop[] = [];
    const grocery = picnicData?.groceryStore;
    if (grocery) {
      rows.push({
        key: `grocery_${grocery.name}`,
        index: 0,
        indexLabel: t('cards:expanded.shop_chip', { defaultValue: 'SHOP' }),
        name: grocery.name,
        imageUrl: grocery.imageUrl ?? null,
        meta:
          grocery.rating != null && grocery.rating > 0 ? `★ ${grocery.rating.toFixed(1)}` : null,
        address: grocery.address ?? null,
        description: null,
        openingHours: undefined,
        utcOffsetMinutes: null,
        travelMinutes: null,
        travelMode: null,
        canReplace: false,
      });
    }
    const companions = strollData?.companionStops ?? [];
    companions.forEach((companion: any, i: number) => {
      rows.push({
        key: `companion_${companion?.id ?? i}`,
        index: rows.length + 1,
        indexLabel: String(rows.length + 1),
        name: companion?.name ?? '',
        imageUrl: companion?.imageUrl ?? null,
        meta:
          companion?.rating != null && companion.rating > 0
            ? `★ ${Number(companion.rating).toFixed(1)}`
            : null,
        address: companion?.address ?? null,
        description: companion?.description ?? null,
        openingHours: undefined,
        utcOffsetMinutes: null,
        travelMinutes: null,
        travelMode: null,
        canReplace: false,
      });
    });
    return rows.filter((row) => row.name.trim().length > 0);
  })();

  // Helper to open directions in maps app
  const openDirections = () => {
    const address = card.address;
    const coords = nightOut?.coordinates;
    if (coords) {
      const url = Platform.select({
        ios: `maps:0,0?q=${coords.lat},${coords.lng}`,
        android: `geo:${coords.lat},${coords.lng}?q=${coords.lat},${coords.lng}(${encodeURIComponent(nightOut?.venueName || "")})`,
      });
      if (url) Linking.openURL(url);
    } else if (address) {
      const url = Platform.select({
        ios: `maps:0,0?q=${encodeURIComponent(address)}`,
        android: `geo:0,0?q=${encodeURIComponent(address)}`,
      });
      if (url) Linking.openURL(url);
    }
  };

  /**
   * Directions for a stop or a companion. ONE implementation for every address
   * on this sheet, with a WEB arm.
   *
   * `Platform.select` with only ios/android keys returns `undefined` on web and
   * the `if (url)` then silently no-ops — a dead tap nobody could see (#1605 bug
   * ledger item 3). And `Linking.openURL` was called at six sites here with ZERO
   * `canOpenURL` pre-flights and ONE console-only `.catch` between them, so a
   * device with no maps app produced nothing at all (Constitution 1 and 3).
   */
  const openDirectionsForAddress = (address: string | null): void => {
    if (address === null || address.trim().length === 0) return;
    const q = encodeURIComponent(address);
    const url =
      Platform.OS === 'ios'
        ? `maps:0,0?q=${q}`
        : Platform.OS === 'android'
          ? `geo:0,0?q=${q}`
          : `https://www.google.com/maps/search/?api=1&query=${q}`;
    void (async () => {
      try {
        const can = await Linking.canOpenURL(url);
        if (!can) {
          toastManager.show(t('cards:expanded.directions_unavailable', {
              defaultValue: "Couldn't open directions",
            }), 'error');
          return;
        }
        await Linking.openURL(url);
      } catch {
        toastManager.show(t('cards:expanded.directions_unavailable', {
            defaultValue: "Couldn't open directions",
          }), 'error');
      }
    })();
  };

  /** Replace a stop — the alternatives are fetched around the STOP, not the user. */
  const handleReplaceStop = (stopIndex: number): void => {
    const source = curatedLocalCard ?? curatedCard;
    const stop = source?.stops?.[stopIndex];
    if (!stop) return;
    setReplacingStopIndex(stopIndex);
    clearAlternatives();
    fetchAlternatives({
      categoryId: stop.comboCategory || stop.placeType || 'casual_food',
      location: { lat: stop.lat, lng: stop.lng },
      travelMode: userPreferences?.travel_mode || 'walking',
      excludePlaceIds: (source?.stops ?? []).map((st) => st.placeId).filter(Boolean),
      rankSignal: stop.rankSignal,
      limit: 10,
    });
  };

  const handleSelectAlternative = (alt: StopAlternative): void => {
    const source = curatedLocalCard ?? curatedCard;
    if (replacingStopIndex === null || !source) return;
    const userLat = userPreferences?.location?.lat ?? source.stops?.[0]?.lat ?? 0;
    const userLng = userPreferences?.location?.lng ?? source.stops?.[0]?.lng ?? 0;
    setCuratedLocalCard(
      replaceStopInCard(
        source,
        replacingStopIndex,
        alt,
        userPreferences?.travel_mode || 'walking',
        userLat,
        userLng,
      ),
    );
    setReplacingStopIndex(null);
    clearAlternatives();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // [ORCH-0696 S-6] Conditionally render sticky header + review nav for
  // review-flow surfaces only (Discover deck + Solo deck pass nav props).
  // Drag handle owns chrome role on all other 6 mount surfaces.
  // META-ORCH-0991 Wave A — this is the BaseBottomSheet `header` slot.
  const reviewNavHeader =
    hasNavigation && navigationTotal != null && navigationIndex != null ? (
      <>
        <ExpandedCardHeader onClose={onClose} />
        <View style={styles.reviewNavBar}>
          <TouchableOpacity
            onPress={onNavigatePrevious}
            disabled={!onNavigatePrevious}
            style={styles.reviewNavArrow}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Icon name="chevron-back" size={20} color={onNavigatePrevious ? '#eb7825' : '#d1d5db'} />
          </TouchableOpacity>
          <Text style={styles.reviewNavCounter}>
            {navigationIndex + 1} of {navigationTotal}
          </Text>
          <TouchableOpacity
            onPress={onNavigateNext}
            disabled={!onNavigateNext}
            style={styles.reviewNavArrow}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Icon name="chevron-forward" size={20} color={onNavigateNext ? '#eb7825' : '#d1d5db'} />
          </TouchableOpacity>
        </View>
      </>
    ) : undefined;

  return (
    <>
      {/* META-ORCH-0991 Wave A — migrated onto BaseBottomSheet. wrapInRNModal=true
          preserves the ORCH-0908 z-stack above the custom tab bar / chat input.
          theme keyed on isNightOut reproduces the EXACT prior chrome (dark
          rgba(12,14,18,1) bg + rgba(255,255,255,0.30) handle; light #ffffff bg +
          rgba(0,0,0,0.30) handle) via per-consumer backgroundStyle/handleStyle so
          there is zero pixel drift. initialIndex=1 opens at the 90% snap. The
          review-nav header is the `header` slot; the scroll body is `children`
          (primitive owns BottomSheetScrollView). ORCH-1022: child RN Modal
          surfaces (browser/share/lightbox) are siblings in this fragment, and the
          root sheet is gated off while they are open so iOS never co-presents two
          RN-Modal-backed surfaces. */}
      <BaseBottomSheet
        visible={visible && !anyChildModalOpen}
        onClose={handleRootSheetClose}
        wrapInRNModal
        /*
          A POOL CARD IS A LIGHT SHEET, AND THAT IS SAID ONCE.

          `theme` is still keyed on `isNightOut` because a Ticketmaster event is
          genuinely a dark surface with its own layout — but `isNightOut` is
          ALWAYS FALSE for a curated card (`!isCuratedCard && !!card.nightOutData`),
          which is how a plan ended up rendering a black #1C1C1E slab on a white
          sheet. The slab is deleted; the pool spine is light on both branches.
        */
        theme={isNightOut ? 'dark' : 'light'}
        snapPoints={glass.bottomSheet.snapPoints as unknown as (string | number)[]}
        initialIndex={1}
        backdropOpacity={0.55}
        /*
          THE HERO DRAWS ITS OWN HANDLE (pool cards only).

          gorhom's 24pt handle block sits ABOVE the sheet body, so it would push
          the hero down and put a band of white above the photograph — the sheet
          would open onto chrome instead of onto the card the user tapped. The
          hero's handle is an opaque core with a dark ring (4.10:1 worst case over
          a 41-luminance sweep) and carries the accessible Close role, because
          suppressing gorhom's takes its affordance with it.
        */
        showHandle={isNightOut}
        handleStyle={
          isNightOut
            ? {
                backgroundColor: "rgba(255,255,255,0.30)",
                width: glass.bottomSheet.handle.width,
                height: glass.bottomSheet.handle.height,
              }
            : undefined
        }
        backgroundStyle={{
          backgroundColor: isNightOut ? "rgba(12, 14, 18, 1)" : SPINE.paper,
          borderTopLeftRadius: glass.bottomSheet.topRadius,
          borderTopRightRadius: glass.bottomSheet.topRadius,
          /*
            NO TOP HAIRLINE on a pool card. The hero is a photograph, and a
            rgba(0,0,0,0.08) line over it is invisible on a dark photo and a
            scratch on a pale one. The hero's own clip IS the edge.
          */
          ...(isNightOut
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: "rgba(255,255,255,0.08)",
              }
            : {}),
        }}
        header={reviewNavHeader}
        scrollMode="scroll"
        accessibilityLabel={card.title}
        scrollProps={{
          ref: scrollRef,
          style: styles.scrollView,
          contentContainerStyle: [
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ],
        }}
      >
            {/*
              THE NIGHT-OUT BRANCH IS NOT PART OF THIS WAVE AND IS UNTOUCHED.

              A Ticketmaster event card (`nightOutData`) is not a pool card: it
              has its own `EventDetailLayout`, its own dark chrome and its own
              ticket flow. #1605 wave 4 is scoped to Mingla's OWN place pool — a
              single place, a claimed venue (which is a pool row and renders
              identically) and a curated multi-stop plan. Everything below the
              ternary is the pool spine.
            */}
            {isNightOut && nightOut ? (
              <>
                {card && <LockedInBanner card={card} />}
                {reservationPass && <ReservationPassSection pass={reservationPass} />}
                <EventDetailLayout
                  card={card}
                  nightOut={nightOut}
                  isSaved={!!isSaved}
                  onSave={onSave}
                  onShare={onShare}
                  onClose={onClose}
                  onOpenBrowser={(url, title) => {
                    setBrowserUrl(url);
                    setBrowserTitle(title);
                  }}
                  accountPreferences={accountPreferences}
                  seatMapFailed={seatMapFailed}
                  setSeatMapFailed={setSeatMapFailed}
                  openDirections={openDirections}
                />
              </>
            ) : (
              <>
            {/*
              ═══════════════════════════════════════════════════════════════
              THE HERO. Always. On both branches.

              It carries the SAME PLATE as the collapsed deck card — same size,
              same radius, same position — so opening a card CONTINUES it rather
              than cutting to a new screen. That continuity is arithmetic, not an
              impression: the scrim formula reads only the plate's card-local
              geometry, so every contrast figure comes out identical to the deck
              card's. See ExpandedCardHero's header, and T-11 in
              packages/card-identity/__tests__, which measures it.
              ═══════════════════════════════════════════════════════════════
            */}
            <ExpandedCardHero
              cover={heroCover}
              title={card.title}
              spans={heroSpans}
              curated={isCuratedCard}
              sheetHeight={sheetHeight}
              beenHere={
                /*
                  THE ONLY BEEN-HERE CONTROL IN THE SYSTEM, and it lives on the
                  plate. `ActionButtons`' implementation — gated on two props no
                  caller has ever passed — is DELETED rather than wired up;
                  wiring it would have given this sheet a second Been-here in a
                  different shape at a different size with a different state
                  machine, three sections below the first one.

                  Because it renders here, it is reachable from the six entry
                  points that have no collapsed card behind them: Likes,
                  Calendar, chat, both collab sheets and a friend's profile.
                */
                <BeenHereControl
                  userId={user?.id}
                  card={{
                    id: card.id,
                    title: card.title,
                    category: card.category,
                    image: card.image,
                    priceRange: card.priceRange ?? null,
                    address: card.address,
                    placeId: card.placeId ?? (card as any).source?.placeId,
                    cardType: (card as any).cardType,
                    placePoolId: (card as any).placePoolId,
                  }}
                />
              }
              onSharePress={() => onShare?.(card)}
              shareLabel={t('cards:swipeable.share_card', {
                defaultValue: 'Share {{title}}',
                title: card.title,
              })}
              onClosePress={onClose}
              closeLabel={t('common:close', { defaultValue: 'Close' })}
            />

            {/* Slot 1 — a system message, not a content section: it keeps its fill. */}
            {card && <LockedInBanner card={card} />}

            {/* Slot 2 — the QR's light quiet zone is what the white body gives it for free. */}
            {reservationPass && <ReservationPassSection pass={reservationPass} />}

            {/*
              Slot 3 — THE ACTION BAND, immediately below the hero, ON BOTH
              BRANCHES. Before this wave it was LAST on a single place and
              MID-SCROLL on a plan. There is one position now and it does not
              depend on what kind of card you opened.
            */}
            <ActionButtons
              card={(planCard ?? card) as ExpandedCardData}
              onSave={onSave}
              onClose={onClose}
              isSaved={isSaved}
              userPreferences={userPreferences}
              currentMode={currentMode}
              onCardRemoved={onCardRemoved}
              onScheduleSuccess={() => onClose()}
              onSchedulePickerModalVisibilityChange={setIsSchedulePickerOpen}
              onPaywallRequired={onPaywallRequired}
              canAccessCurated={canAccessCurated}
              reserve={
                venueReservable?.reservable === true &&
                venueReservable.brand_id !== null && (
                  <TouchableOpacity
                    style={reserveStyles.reserveButton}
                    activeOpacity={0.85}
                    onPress={() => setIsReserveSheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Reserve a table at ${card.title}`}
                  >
                    <Icon name="restaurant-outline" size={18} color={SPINE.onAccent} />
                    <Text style={reserveStyles.reserveButtonText} numberOfLines={1}>
                      Reserve a table
                    </Text>
                  </TouchableOpacity>
                )
              }
            />

            {/*
              Slot 4 — the description, the typical spend and the tip. A plan's
              TAGLINE is a description, so it lands here too: before this wave the
              tagline lived in the dark header at 14pt on rgba(255,255,255,0.7),
              and the single-place branch dropped its description entirely along
              with the rest of this component.
            */}
            <CardInfoSection
              description={bodyDescription}
              tip={isCuratedCard ? null : card.tip}
              discoveryPrice={card}
            />

            {/*
              Slot 5 — the gallery, `images.length > 1`, SINGLE PLACE ONLY. Not a
              branch: a plan has no second photo of its own, its stops do.

              It is a horizontal FlatList, and it is the ONE horizontal scrollable
              on this sheet. What it replaces is the 402x300 in-flow #000000 pager
              that used to BE the hero, with its 40pt chevrons, its dot row and its
              dead `.counter` style — and the 402x200 #f3f4f6 "no images" box that
              produced a 100pt layout jump against it.

              Tapping opens `ImageLightbox`, which today has exactly one importer
              and is reachable ONLY from a curated stop — so a single place's
              photos have never been openable at all.
            */}
            {!isCuratedCard && Array.isArray(card.images) && card.images.length > 1 ? (
              <Section title={t('cards:expanded.photos', { defaultValue: 'Photos' })}>
                <FlatList
                  data={card.images.filter((uri) => uri !== heroCover)}
                  keyExtractor={(uri, i) => `${uri}_${i}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.galleryStrip}
                  renderItem={({ item, index }) => (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() =>
                        setCuratedLightbox({
                          visible: true,
                          images: card.images ?? [],
                          initialIndex: (card.images ?? []).indexOf(item),
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t('cards:expanded.photo_a11y', {
                        defaultValue: 'Photo {{n}}',
                        n: index + 1,
                      })}
                    >
                      <Image source={{ uri: item }} style={styles.galleryItem} resizeMode="cover" />
                    </TouchableOpacity>
                  )}
                />
              </Section>
            ) : null}

            {/* Slot 6 — THE PLAN (a plan has stops) … */}
            <View onLayout={(e) => setPlanSectionY(e.nativeEvent.layout.y)}>
              <StopList
                heading={t('cards:expanded.the_plan', { defaultValue: 'The plan' })}
                stops={planListStops}
                customized={curatedLocalCard !== null}
                onDirections={(stop) => openDirectionsForAddress(stop.address)}
                onReplace={(stop) => handleReplaceStop(stop.index - 1)}
                onExpandedRowLayout={(y) =>
                  scrollRef.current?.scrollTo({ y: planSectionY + y, animated: true })
                }
                replacePanel={(stop) =>
                  replacingStopIndex === stop.index - 1 ? (
                    <View style={styles.altPanel}>
                      {isLoadingAlts ? (
                        <ActivityIndicator size="small" color={SPINE.accentFill} />
                      ) : altsError ? (
                        <SectionError
                          message={t('cards:expanded.couldnt_load_alternatives')}
                          retryLabel={t('cards:expanded.retry')}
                          onRetry={() => handleReplaceStop(stop.index - 1)}
                        />
                      ) : alternatives.length === 0 ? (
                        <Text style={styles.altEmpty}>{t('cards:expanded.no_alternatives')}</Text>
                      ) : (
                        /*
                          A WRAPPING GRID, not a horizontal ScrollView. The strip
                          was one of the nested scrollables inside the sheet's
                          vertical scroll, and it fought the sheet's pan gesture
                          every time a thumb crossed it.
                        */
                        <View style={styles.altGrid}>
                          {alternatives.map((alt) => (
                            <TouchableOpacity
                              key={alt.placeId}
                              style={styles.altCard}
                              activeOpacity={0.85}
                              onPress={() => handleSelectAlternative(alt)}
                              accessibilityRole="button"
                              accessibilityLabel={alt.placeName}
                            >
                              {alt.imageUrl ? (
                                <Image
                                  source={{ uri: alt.imageUrl }}
                                  style={styles.altImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={styles.altImage} />
                              )}
                              <Text style={styles.altName} numberOfLines={1}>
                                {alt.placeName}
                              </Text>
                              {alt.rating > 0 ? (
                                <Text style={styles.altMeta} numberOfLines={1}>
                                  {`★ ${alt.rating.toFixed(1)}`}
                                </Text>
                              ) : null}
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null
                }
              />
            </View>

            {/*
              … and slot 6 again — COMPANION STOPS, the same component with a
              different producer. A stroll is a multi-stop plan; a picnic's
              grocery store is one stop of it with a SHOP chip.
            */}
            {!isCuratedCard && companionStops.length > 0 ? (
              <StopList
                heading={
                  isPicnicCard
                    ? t('cards:expanded.your_picnic', { defaultValue: 'Your picnic' })
                    : t('cards:expanded.your_stroll', { defaultValue: 'Your stroll' })
                }
                stops={companionStops}
                onDirections={(stop) => openDirectionsForAddress(stop.address)}
              />
            ) : null}

            {/*
              The "See full plan" fetchers stay: they are what PRODUCE the
              companion stops above, and a stroll card that has never been
              expanded has none until they run.
            */}
            {!isCuratedCard && (isStrollCard || isPicnicCard) &&
            companionStops.length === 0 ? (
              <View style={styles.seeFullPlanSection}>
                <TouchableOpacity
                  style={styles.routePairingButton}
                  onPress={isPicnicCard ? fetchPicnicData : fetchStrollData}
                  disabled={loadingStrollData || loadingPicnicData}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  {loadingStrollData || loadingPicnicData ? (
                    <ActivityIndicator size="small" color={SPINE.onAccent} />
                  ) : (
                    <Icon name="map-outline" size={20} color={SPINE.onAccent} />
                  )}
                  <Text style={styles.routePairingButtonText}>
                    {t('cards:expanded.see_full_plan', { defaultValue: 'See full plan' })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Slot 7 — experiences at this venue (claimed brands only, single place). */}
            {!isCuratedCard ? (
              <VenueExperiencesSection
                placePoolId={card.id}
                currency={accountPreferences?.currency}
                onOpenExperience={setSelectedVenueExperience}
              />
            ) : null}

            {/*
              Slot 8 — RIGHT NOW. ONE call site, ONE prop shape, both branches.

              Before this wave the curated call passed `selectedDateTime={undefined}`
              — so a SCHEDULED plan never got time-of-day-aware weather — and took
              its coordinates from `stops[0]` while the single branch used
              `card.location`. A plan's coordinate IS `stops[0]`, because that is
              where the plan starts; it is now stated once, at the fetch, rather
              than discovered twice.
            */}
            <ConditionsSection
              weather={weatherData}
              busyness={busynessData}
              loadingWeather={loadingWeather}
              loadingBusyness={loadingBusyness}
              measurementSystem={accountPreferences?.measurementSystem}
            />

            {/* Slot 9 — DETAILS. A plan gets Starts at / Ends near; a place gets the rest. */}
            <PracticalDetailsSection
              address={isCuratedCard ? undefined : card.address}
              openingHours={isCuratedCard ? undefined : card.openingHours}
              phone={isCuratedCard ? undefined : card.phone}
              website={isCuratedCard ? undefined : card.website}
              utcOffsetMinutes={isCuratedCard ? null : cardUtcOffsetMinutes}
              plan={
                isCuratedCard
                  ? {
                      startsAt: planStops[0]?.address ?? null,
                      endsNear: planStops[planStops.length - 1]?.address ?? null,
                    }
                  : undefined
              }
              onLinkUnavailable={(what) =>
                toastManager.show(t('cards:expanded.link_unavailable', {
                    defaultValue: "Couldn't open {{what}}",
                    what,
                  }), 'error')
              }
            />

            {/* Timeline Section (for Take a Stroll cards) */}
            {isStrollCard && strollData && strollData.timeline && (
              <TimelineSection
                category={getReadableCategoryName(card.category)}
                title={card.title}
                address={card.address}
                priceRange={canonicalDiscoveryPriceDetail(card)?.source}
                travelTime={viewerTravelTime ?? card.travelTime ?? undefined}
                strollTimeline={strollData.timeline}
                routeDuration={strollData.route?.duration}
                currency={accountPreferences?.currency}
              />
            )}

            {/* Timeline Section (for Picnic cards) */}
            {isPicnicCard && picnicData && picnicData.timeline && (
              <TimelineSection
                category={getReadableCategoryName(card.category)}
                title={card.title}
                address={card.address}
                priceRange={canonicalDiscoveryPriceDetail(card)?.source}
                travelTime={viewerTravelTime ?? card.travelTime ?? undefined}
                strollTimeline={picnicData.timeline}
                routeDuration={picnicData.route?.duration}
                currency={accountPreferences?.currency}
              />
            )}

              </>
            )}
      </BaseBottomSheet>

      {/* ORCH-1072 → ORCH-1138 Leg 3 — experience opened from the
          VenueExperiencesSection. Repointed off EBES to the foundation
          ConsumerExperienceDetailScreen (which mounts its own BaseBottomSheet as
          a SIBLING of the root sheet — the proven sub-sheet pattern). The root
          sheet is gated off (anyChildModalOpen) while this is open; closing it
          clears the selection WITHOUT tearing down the card.
          I-PROPOSED-1138-EBES-DELETED. */}
      {selectedVenueExperience !== null && (
        <ConsumerExperienceDetailScreen
          seed={selectedVenueExperience}
          onBack={() => setSelectedVenueExperience(null)}
          tabBarAware={false}
        />
      )}

      {/* META-ORCH-1148 2.2b — the 3-step reserve sheet, mounted as a SIBLING of
          the root sheet (same proven sub-sheet pattern as the experience detail
          above). The root sheet is gated off (anyChildModalOpen) while it is
          open. The reservation attaches to the signed-in user server-side.

          2.2b reserve-won't-open fix (2026-06-17): MOUNT-ON-OPEN, mirroring the
          ConsumerExperienceDetailScreen sibling (`selectedVenueExperience !== null
          && <…>`). The prior always-mounted-when-reservable + `visible`-toggle
          shape raced the root sheet's simultaneous close (both share the inline,
          non-RN-Modal presentation slot): flipping `isReserveSheetOpen` true
          gated the root off (card collapsed) but the already-mounted sub-sheet's
          open never presented → nothing opened → onClose never fired → the flag
          stuck true → root stayed suppressed → card couldn't re-expand. Mounting
          fresh on open gives a clean open animation in the freed slot, exactly
          like the experience-detail sibling; closing it (CTA/pan-down/backdrop →
          resetAndClose → onClose) unmounts AND resets isReserveSheetOpen=false,
          ungating the root so the card restores and re-expands. */}
      {/* ORCH-1148 RUNTIME FIX (2026-06-17): the sheet render gate previously
          ALSO required `isNightOut && nightOut`, but the "Reserve a table"
          BUTTON (above) renders ONLY in the regular-place branch (`!isNightOut`)
          of the layout ternary. Those two conditions are mutually exclusive, so
          on every card that showed the button, `isNightOut` was false → the
          sheet gate was false → tapping flipped `isReserveSheetOpen` true but
          NOTHING mounted ("does nothing"). Proven at runtime: tap logged
          `gateWouldMount:false` with `isNightOut:false, reservable:true,
          brand_id` present. The sheet's props (brandId, venueName=card.title,
          currency) never depend on `nightOut`, so the gate now mirrors the
          button EXACTLY (RESERVABLE_VENUE_GATE) — any card that shows the button
          can open the sheet. Regression test asserts both gates share the
          condition so they can't drift again. */}
      {venueReservable?.reservable === true &&
        venueReservable.brand_id !== null &&
        venueReservable.venue_id !== null && isReserveSheetOpen && (
          <VenueReserveSheet
            visible={isReserveSheetOpen}
            onClose={() => setIsReserveSheetOpen(false)}
            venueId={venueReservable.venue_id}
            brandId={venueReservable.brand_id}
            venueName={card.title}
            currency={venueReservable.currency}
            onReserved={() => {
              Alert.alert(
                "You're booked",
                `Your table at ${card.title} is confirmed. Find it in your Calendar under Reservations.`,
              );
            }}
          />
        )}

      {/* META-ORCH-0991 Wave A — child RN Modals moved to siblings of the sheet.
          They render in their own OS overlay window regardless of tree position,
          so they still present over the sheet content exactly as before. */}

      {/* In-app ticket browser (event Get Tickets CTA target) */}
      {isNightOut && nightOut && (
        <InAppBrowserModal
          visible={ticketBrowserUrl !== null}
          url={ticketBrowserUrl ?? ''}
          title={`Tickets – ${nightOut.eventName}`}
          onClose={() => setTicketBrowserUrl(null)}
        />
      )}

      {/* In-app browser for Policies & Reservations (Nature place cards) */}
      <InAppBrowserModal
        visible={browserUrl !== null}
        url={browserUrl ?? ''}
        title={browserTitle}
        onClose={() => setBrowserUrl(null)}
      />

      <ImageLightbox
        visible={curatedLightbox.visible}
        images={curatedLightbox.images}
        initialIndex={curatedLightbox.initialIndex}
        onClose={() => setCuratedLightbox(prev => ({ ...prev, visible: false }))}
      />

      {isNightOut && nightOut && (
        <ShareModal
          isOpen={isNightOutShareOpen}
          onClose={() => setIsNightOutShareOpen(false)}
          experienceData={{
            title: card.title,
            image: card.image,
            images: card.images,
            distance: card.distance,
            priceRange: nightOut.price,
            rating: card.rating,
            address: card.address,
            description: card.description,
            location: card.location,
          }}
          dateTimePreferences={{
            timeOfDay: nightOut.time,
            dayOfWeek: nightOut.date,
            planningTimeframe: nightOut.date,
          }}
          accountPreferences={accountPreferences}
        />
      )}
    </>
  );
}

// Night Out detail styles

const styles = StyleSheet.create({
  reviewNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  reviewNavArrow: {
    padding: 4,
  },
  reviewNavCounter: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    marginHorizontal: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
    flexGrow: 1,
  },
  placeholderSection: {
    padding: 20,
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 8,
  },
  placeholderSubtext: {
    fontSize: 14,
    color: "#9ca3af",
    marginBottom: 4,
  },
  loadingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  dataPreview: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
    width: "100%",
  },
  dataPreviewTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  dataPreviewText: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 2,
  },
  seeFullPlanSection: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  routePairingSection: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    backgroundColor: "#ffffff",
  },
  routePairingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  routePairingIconContainer: {
    position: "relative",
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  routePairingIconDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#eb7825",
    top: "50%",
    left: "50%",
    marginTop: -3,
    marginLeft: -3,
  },
  routePairingTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  routePairingDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
  },
  routePairingButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  routePairingButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  /**
   * #1605 wave 4 — the ~80-line grocery-store block's styles are DELETED. The
   * store is now ONE row of the companion `StopList` with a `SHOP` index chip,
   * which is the same furniture every other stop gets.
   */

  // The body gallery strip — the ONE horizontal scrollable on this sheet, and
  // the thing that finally gives a single place's photos a lightbox.
  galleryStrip: { paddingHorizontal: SPINE.gutter, gap: GALLERY.gap },
  galleryItem: {
    width: GALLERY.itemWidth,
    height: GALLERY.height,
    borderRadius: GALLERY.itemRadius,
    backgroundColor: SPINE.chipFill,
    marginRight: GALLERY.gap,
  },

  // The alternatives panel. A WRAPPING GRID, not a horizontal ScrollView — see
  // the render site: the strip was one of the nested scrollables.
  altPanel: { gap: 12, paddingTop: 4 },
  altEmpty: { fontSize: 14, color: SPINE.factLabel },
  altGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  altCard: { width: 140, gap: 4 },
  altImage: {
    width: 140,
    height: 96,
    borderRadius: 10,
    backgroundColor: SPINE.chipFill,
    borderWidth: 1,
    borderColor: SPINE.rule,
  },
  altName: { fontSize: 14, fontWeight: '600', color: SPINE.factValue },
  altMeta: { fontSize: 13, color: SPINE.muted },
});

// META-ORCH-1148 2.2b — the consumer "Reserve a table" affordance in the
// nightOut expanded card (alongside VenueExperiencesSection).
const reserveStyles = StyleSheet.create({
  reserveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: "#ea580c",
  },
  reserveButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
