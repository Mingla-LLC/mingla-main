import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
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
import { BaseBottomSheet, BottomSheetFlatList } from "./ui/BaseBottomSheet";
import { ExpandedCardModalProps, ExpandedCardData } from "../types/expandedCardTypes";
import type { CuratedExperienceCard, CuratedStop } from '../types/curatedExperience';
import { formatCurrency } from "./utils/formatters";
import { canonicalDiscoveryPriceDetail } from '../utils/priceTiers';
import { getReadableCategoryName } from "../utils/categoryUtils";  // ORCH-0685
import { weatherService, WeatherData } from "../services/weatherService";
import { busynessService, BusynessData } from "../services/busynessService";
/*
  #1605 P2-1 — `bookingService` is GONE from this sheet, not left fetching.

  `ActionButtons` declared `bookingOptions` and `onPurchase` as props and
  referenced NEITHER in its body — the never-consumed pair that made §6.1's
  proposed Reserve gate a dead tap. Wave 4 deleted the props and left the
  FETCH: `getBookingOptions` still ran once per expanded card, against an
  external service, and `setBookingOptions` still populated state that nothing
  read. One discarded round trip per card open.

  Subtract before adding (Constitution 8). The real reserve affordance is the
  `useVenueReservable` gate on the action band, which reads a claimed brand's
  own reservation settings — not a third-party booking-link lookup.
*/
import { stopReplacementService } from "../services/stopReplacementService"; // ORCH-0640 ch09: experienceGenerationService DELETED; methods moved to stopReplacementService
import { useRecommendationsOptional } from "../contexts/RecommendationsContext";
import ExpandedCardHeader from "./expandedCard/ExpandedCardHeader";
import CardInfoSection from "./expandedCard/CardInfoSection";
// #1605 wave 4 — WeatherSection + BusynessSection are DELETED. Two orange-tinted
// boxes with 26pt icon badges became two fact rows under one RIGHT NOW heading.
import ConditionsSection from "./expandedCard/ConditionsSection";
import PracticalDetailsSection from "./expandedCard/PracticalDetailsSection";
import PlanTimeline, { type PlanTimelineLeg } from "./expandedCard/PlanTimeline";
import { ExpandedCardHero } from "./expandedCard/ExpandedCardHero";
import StopList, { type StopListStop } from "./expandedCard/StopList";
import { occasionFromCategory, stopPurpose } from "./expandedCard/stopPurpose";
// #1605 P1-3 — the picnic Shopping List, re-homed onto the spine. It rendered on
// `main` at :990-992 via the deleted PicnicShoppingList and was not in the
// spec's deletion list; five producers still carry `shoppingList`.
import SuppliesList from "./expandedCard/SuppliesList";
import { Section, SectionError } from "./expandedCard/SpineParts";
import { SPINE, GALLERY } from "./expandedCard/spineTokens";
// `planVisibleStops` is deliberately NOT imported here any more: the sheet's
// plate takes its count from `curatedPlanSpans`, which calls it internally, and
// the plan list's main-stop count must NOT go through its all-optional fallback
// (see `planMainStopCount` below). One reader, one meaning.
import {
  companionStopMeta,
  curatedPlanSpans,
  singlePlaceSpans,
  stopMetaText,
} from "./expandedCard/expandedCardFacts";
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
import { normalizeWebsiteUrl } from "../utils/normalizeWebsiteUrl";
// #1605 P2-2 — the body strip renders plain <Image>, and ImageLightbox is
// images-only, so a video entry past the hero was a broken tile.
import { isVideoUrl } from "../utils/videoUrl";
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
  /**
   * #1707 — the edited plan, handed back so the DECK's copy changes too.
   *
   * Without it `curatedLocalCard` is component state that dies with the sheet:
   * the swap works, closing throws it away, and reopening shows the original.
   */
  onCardEdited,
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
  const [viewerTravelTime, setViewerTravelTime] = useState<string | null>(null);
  const [viewerDistance, setViewerDistance] = useState<number | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [loadingBusyness, setLoadingBusyness] = useState(false);
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
            firstStop.lng
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
          card.location.lng
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
   * IS THIS PLAN A BRAND EXPERIENCE? — #1605 rework, the P1-6 class again.
   *
   * The deck passes `isBrandExperience` into `curatedPlanSpans`; this call site
   * did not, which meant the ONE producer could still be asked two different
   * questions. It matters for exactly one span: ORCH-1065 BUG-1 — a brand
   * experience carries its all-in price as the ENVELOPE total and every stop
   * carries `price_cents: 0`, so summing the stops prints "Free" over a paid
   * experience. The plate on the deck says the price; the plate on the sheet
   * said Free. One tap apart, on the money span.
   *
   * IT IS REACHABLE, and it is not the deck that reaches it. `handleCardExpand`
   * routes `cardType === 'experience'` to the business-event sheet before the
   * curated branch, so the deck NEVER opens this modal for one. Likes does:
   * a right-swiped experience is persisted by `savedCardsService.saveCard`
   * (which spreads the whole card, `cardType`, `stops`, envelope totals and all,
   * because the swipe handler's `if (!isCuratedType)` includes experiences), and
   * `savedCardToExpandedCardData` then stamps `cardType: "curated"` over the
   * `'experience'` discriminator on its `Array.isArray(stops)` branch. So the
   * sheet receives a brand experience wearing a curated tag.
   *
   * The tag being overwritten is why this reads the BRAND ATTRIBUTION instead —
   * the same structural recovery `deckService.isExperiencePayload` performs for
   * the same reason (ORCH-1072 tag-loss hardening): a non-empty `brandId` AND a
   * non-empty `eventId` beside a stops array is a brand-authored envelope, and
   * an AI-curated plan has neither. Explicit tag first, structure second.
   */
  const isBrandExperiencePlan: boolean = (() => {
    const c = card as { cardType?: unknown; brandId?: unknown; eventId?: unknown };
    if (c.cardType === 'experience') return true;
    return (
      typeof c.brandId === 'string' &&
      c.brandId.length > 0 &&
      typeof c.eventId === 'string' &&
      c.eventId.length > 0 &&
      planStops.length > 0
    );
  })();

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

  /*
    THE PLATE'S FACTS — from the SAME producer the collapsed deck card calls.

    #1605 P1-6: this call used to pass three already-resolved labels the modal
    derived itself (envelope price, a locally re-summed duration, a stop count
    over ALL stops) while `CuratedExperienceSwipeCard` derived five spans its
    own way. Same card, one tap apart, and the count, the duration and the
    distance all changed — which contradicts the one claim the whole wave rests
    on. Both surfaces now hand `curatedPlanSpans` the CARD and nothing but
    viewer state, so they cannot disagree.
  */
  const heroSpans = isCuratedCard && planCard
    ? curatedPlanSpans(planCard, {
        measurementSystem: accountPreferences?.measurementSystem,
        formatMoney: (amount) => formatCurrency(amount, accountPreferences?.currency || 'USD'),
        freeLabel: t('cards:swipeable.free', { defaultValue: 'Free' }),
        stopCountLabel: (count) =>
          t('cards:expanded.stop_count', { defaultValue: '{{count}} stops', count }),
        intentLabel: (slug) => t(`common:intent_${slug}`),
        isBrandExperience: isBrandExperiencePlan,
      })
    : singlePlaceSpans(card, {
        measurementSystem: accountPreferences?.measurementSystem,
        // The viewer-relative distance the modal already computes for
        // chat-mounted cards, which by definition carry no `card.distance`.
        // Nothing read it after the wave-4 rewrite (#1605 rework).
        viewerDistanceKm: viewerDistance,
      });

  /** The venue's UTC offset, top-level or legacy-cased. Absent = no badge. */
  const cardUtcOffsetMinutes = card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null;

  /**
   * THE BODY GALLERY'S ENTRIES — PHOTOS, and only photos. #1605 P2-2.
   *
   * `ImageGallery` routed ANY `isVideoUrl(mediaUri)` entry through
   * `EventCoverMedia`, so a venue with a second video played it. The hero
   * handles `images[0]` (video or photo, correctly, with the unmute control);
   * the strip below renders a plain `<Image source={{uri}}>` for everything
   * else, and `ImageLightbox` is images-only. An `.mp4` at `images[1]` was
   * therefore a broken tile that opened a broken lightbox page — a dead tap on
   * a rendering failure.
   *
   * A tile that cannot play is not a video, so it is not rendered (Constitution
   * 9: missing is hidden, never faked). Playing a SECOND video in a 160x120
   * tile is a real capability the gallery had and this does not restore — it
   * needs a decode-per-tile policy the sheet does not have, and it is declared
   * rather than silently dropped.
   */
  const galleryPhotos: string[] = (Array.isArray(card.images) ? card.images : [])
    .filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0)
    .filter((uri) => uri !== heroCover && !isVideoUrl(uri));

  /*
    THE PLATE SAYS "2 stops" AND THE PLAN SECTION LISTS THREE ROWS — #1605 rework.

    Both numbers are correct and they were never wrong TOGETHER before, because
    they had never been on one screen: the plate's count is over the plan's
    NON-OPTIONAL stops (`planVisibleStops` — the same set `mutateCuratedCard`
    computes the title, the total price and the duration over), while `StopList`
    renders every `planStops` entry. `generate-curated-experiences` really does
    emit `optional: true` stops (the romantic combos' Flowers stop, :501/:529/:575),
    so a live 3-row / "2 stops" card is not a hypothetical.

    Fixing the COUNT would be wrong — it would disagree with the card's own title,
    which is the main stops joined by " → ". Dropping the row would be worse: an
    optional stop is a real suggestion the user can act on. So the LIST says which
    it is. An optional stop takes the `OPTIONAL` word in the index-chip slot
    instead of an ordinal — the same mechanism the picnic grocery row's `SHOP`
    chip already uses — and the main stops keep the contiguous 1…N numbering the
    count is about. Two numbers that disagree become one number and one label.
  */
  /*
    WHY THIS COUNTS THE STOPS DIRECTLY INSTEAD OF ASKING `planVisibleStops`.

    The guard below reads "do not mark rows optional when there are no MAIN
    stops", and until this line was fixed it could never fire: it took its count
    from `planVisibleStops`, which ends in `main.length > 0 ? main : all` — the
    deliberate fallback that gives an all-optional plan an identity (a title, a
    price, a duration) instead of an empty one. Through that fallback the count
    is positive for ANY non-empty plan, so the conjunct was dead and an
    all-optional plan rendered "3 stops" on the plate above three rows that were
    all chipped `Optional` and none of which was numbered — the same
    two-numbers-one-screen defect the chip exists to close, inverted.

    Counting the genuinely non-optional stops makes the guard live and leaves
    every reachable plan byte-identical (with at least one main stop the two
    quantities are the same number). On an all-optional plan there is no
    main/optional distinction left to draw, so no row is marked and the rows
    number 1..N against the same N the plate states. Latent when found — every
    generator type definition pairs the optional Flowers stop with two required
    ones — and now closed rather than left as a guard that reads live and is not.
  */
  const planMainStopCount = planStops.filter((stop) => stop.optional !== true).length;
  let planOrdinal = 0;
  /**
   * #1706 — the leg between the plan's first and last stop.
   *
   * `travelTimeFromPreviousStopMin` is written by `replaceStopInCard` using
   * `estimateTravelMinutes(haversineKm(...))` — real per-mode speeds over the
   * real distance between two real coordinates. It is COMPUTED, never measured,
   * so `estimated: true` is not a hedge: see `PlanTimelineLeg.estimated` for why
   * that disclosure is the condition of this number being on the sheet at all.
   *
   * Null when the plan carries no figure. Nothing is invented to fill the gap —
   * the leg simply does not render.
   */
  const planTimelineLeg: PlanTimelineLeg | null = useMemo(() => {
    const last = planStops[planStops.length - 1];
    const minutes = last?.travelTimeFromPreviousStopMin;
    if (typeof minutes !== 'number' || !(minutes > 0)) return null;
    return {
      minutes,
      mode: last?.travelModeFromPreviousStop ?? userPreferences?.travel_mode ?? null,
      estimated: true,
    };
  }, [planStops, userPreferences?.travel_mode]);

  const planListStops: StopListStop[] = planStops.map((stop, i) => {
    const isOptional = stop.optional === true && planMainStopCount > 0;
    if (!isOptional) planOrdinal += 1;
    // Cover first, then the rest, de-duplicated and photos only. `imageUrls`
    // carries up to five per stop and only the first was reachable after the
    // per-stop pager was deleted (#1605 P2-3).
    const stopPhotos = [
      ...(Array.isArray(stop.imageUrls) ? stop.imageUrls : []),
      stop.imageUrl,
    ].filter(
      (uri, idx, all): uri is string =>
        typeof uri === 'string' &&
        uri.trim().length > 0 &&
        !isVideoUrl(uri) &&
        all.indexOf(uri) === idx,
    );
    return {
    key: `${stop.placeId ?? 'stop'}_${i}`,
    index: i + 1,
    // The ordinal counts only the stops the PLATE counts, so "2 stops" and the
    // rows numbered 1 and 2 are exactly the same claim. An optional stop is not
    // in that sequence and so gets no number at all — it is marked in the row
    // instead (`optional` below).
    indexLabel: isOptional ? '' : String(planOrdinal),
    name: stop.placeName,
    imageUrl: stopPhotos[0] ?? null,
    imageUrls: stopPhotos,
    // Normalized HERE so the row's gate is the url, not the raw string — the
    // same fix the single-place Website row carries (a handler that bails on a
    // null normalization behind a control gated on the raw value is a visible
    // dead button).
    website: normalizeWebsiteUrl(stop.website ?? undefined),
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
    canReplace: !isOptional,
    // #1705 — from the slot's OWN comboCategory (the real picnic plan carries
    // 'groceries' on stop 1 and 'nature' on stop 2). Null for anything we cannot
    // state without guessing; the row then renders exactly as it did before.
    purpose: stopPurpose(stop),
    optional: isOptional,
    };
  });

  /**
   * THE PICNIC SUPPLIES. #1605 P1-3.
   *
   * One resolution for both branches, like every other value on this sheet: a
   * curated picnic plan carries it on the plan card (`mutateCuratedCard`
   * regenerates it when a stop is replaced, so the LOCAL card is read first),
   * and a picnic card that arrived through `cardConverters` /
   * `savedCardToExpandedCardData` / `holidayCardToExpandedCardData` carries it
   * at the top level. Empty or absent renders nothing — the section takes its
   * own rule with it.
   */
  const supplies: string[] = (() => {
    const raw =
      planCard?.shoppingList ??
      (card as { shoppingList?: unknown }).shoppingList ??
      null;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  })();

  /**
   * #1705 — the supplies list's occasion line, composed from the plan's OWN
   * data and NOTHING ELSE.
   *
   * Two facts, both already on the card: the plan's category ("Picnic Dates" ->
   * "your picnic") and which stop, if any, is the one that sells them (the first
   * stop whose purpose is the groceries one). Either may be missing, and the
   * line degrades rather than inventing: no shop -> just the occasion; no
   * recognised occasion -> no line at all, and `SuppliesList` renders exactly as
   * it did before.
   */
  const suppliesPurposeLine = useMemo((): string | null => {
    if (!Array.isArray(supplies) || supplies.length === 0) return null;
    // `CuratedExperienceCard` names it `categoryLabel`; the single-place shape
    // uses `category`. Read both rather than asserting one — a wrong field here
    // would silently disable the line on every plan.
    const occasionKey =
      (planCard as { categoryLabel?: string | null } | null)?.categoryLabel
      ?? (card as { category?: string | null } | null)?.category
      ?? null;
    const occasion = occasionFromCategory(occasionKey);
    if (occasion === null) return null;
    const shopIndex = planStops.findIndex(
      (st) => stopPurpose(st)?.key === 'expanded.purpose_groceries',
    );
    if (shopIndex >= 0) {
      return t('cards:expanded.supplies_for_at_stop', {
        defaultValue: 'Get these for {{occasion}} — stop {{n}} sells them',
        occasion: t(`cards:${occasion.key}`, { defaultValue: occasion.defaultValue }),
        n: shopIndex + 1,
      });
    }
    return t('cards:expanded.supplies_for', {
      defaultValue: 'Get these for {{occasion}}',
      occasion: t(`cards:${occasion.key}`, { defaultValue: occasion.defaultValue }),
    });
  }, [supplies, planCard, card, planStops, t]);


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
    // The i18n resolver for the reviews suffix, bound once. It is the SAME key
    // `CompanionStopsSection` used, translated in all 29 locales (#1605 rework).
    const reviewsLabel = (count: number): string =>
      t('expanded_details:companion_stops.reviews_count', {
        defaultValue: '({{count}} reviews)',
        count,
      });
    const grocery = picnicData?.groceryStore;
    if (grocery) {
      rows.push({
        key: `grocery_${grocery.name}`,
        index: 0,
        indexLabel: t('cards:expanded.shop_chip', { defaultValue: 'SHOP' }),
        name: grocery.name,
        imageUrl: grocery.imageUrl ?? null,
        imageUrls: typeof grocery.imageUrl === 'string' && grocery.imageUrl.length > 0
          ? [grocery.imageUrl]
          : [],
        website: null,
        /*
          The grocery row takes rating + REVIEW COUNT but NOT the type label:
          its `type` is `groceries`, which the companion map does not carry and
          would render as the wrong words ("Food & Drink" over a supermarket),
          and the `SHOP` index chip already names what it is. #1605 rework.
        */
        meta: companionStopMeta(
          { rating: grocery.rating, reviewCount: grocery.reviewCount },
          reviewsLabel,
        ),
        address: grocery.address ?? null,
        description: null,
        openingHours: undefined,
        utcOffsetMinutes: null,
        travelMinutes: null,
        travelMode: null,
        canReplace: false,
        // #1705 — no comboCategory on this producer, so no purpose. Never guessed.
        purpose: null,
        optional: false,
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
        imageUrls: typeof companion?.imageUrl === 'string' && companion.imageUrl.length > 0
          ? [companion.imageUrl]
          : [],
        website: null,
        /*
          THE ROW'S SUBTITLE IS BACK. `type` and `reviewCount` are written by
          `get-companion-stops` on every row and were read by nothing after the
          first cut — the type label was the companion row's ONLY subtitle and
          it was backed by a 20-entry map. Both come through the shared producer
          now, so the rule is stated once (#1605 rework).
        */
        meta: companionStopMeta(companion ?? {}, reviewsLabel),
        address: companion?.address ?? null,
        description: companion?.description ?? null,
        openingHours: undefined,
        utcOffsetMinutes: null,
        travelMinutes: null,
        travelMode: null,
        canReplace: false,
        // #1705 — no comboCategory on this producer, so no purpose. Never guessed.
        purpose: null,
        optional: false,
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

  /**
   * A stop's own booking / policies page. #1605 rework.
   *
   * The url is already normalized by the producer, so this cannot be handed a
   * string the OS will reject for a shape reason. The `canOpenURL` pre-flight
   * and the toast are the SAME contract `LinkRow` gives the single place's
   * Website row — six `Linking.openURL` sites on this sheet had zero pre-flights
   * and one console-only catch between them before this wave (Constitution 3).
   */
  const openStopWebsite = (url: string | null): void => {
    if (url === null || url.trim().length === 0) return;
    void (async () => {
      try {
        const can = await Linking.canOpenURL(url);
        if (!can) {
          toastManager.show(
            t('cards:expanded.link_unavailable', {
              defaultValue: "Couldn't open {{what}}",
              what: t('expanded_details:action_buttons.website', { defaultValue: 'Website' }),
            }),
            'error',
          );
          return;
        }
        await Linking.openURL(url);
      } catch {
        toastManager.show(
          t('cards:expanded.link_unavailable', {
            defaultValue: "Couldn't open {{what}}",
            what: t('expanded_details:action_buttons.website', { defaultValue: 'Website' }),
          }),
          'error',
        );
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
    const edited = replaceStopInCard(
      source,
      replacingStopIndex,
      alt,
      userPreferences?.travel_mode || 'walking',
      userLat,
      userLng,
    );
    setCuratedLocalCard(edited);
    /*
      #1707 — AND HAND IT BACK. `setCuratedLocalCard` alone is where this bug
      lived: state local to this sheet, four readers all in this file, nothing
      writing it anywhere. The sheet unmounts and the edit is gone.

      Keyed on the card's OWN id rather than whatever the caller last opened, so
      a sheet opened from Likes or the calendar patches the right card. Only the
      fields a replacement changes are sent — see `applyCuratedEdit`.
    */
    onCardEdited?.(edited.id, {
      stops: edited.stops,
      title: edited.title,
      travelTime: (edited as { travelTime?: string | null }).travelTime ?? null,
      distance: (edited as { distance?: string | null }).distance ?? null,
    } as never);
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
                /*
                  ALL THREE CONDITIONS, BECAUSE THE SHEET REQUIRES ALL THREE.

                  `venue_id !== null` is not decoration: `VenueReserveSheet`
                  takes `venueId` and its own render gate below requires it. A
                  button gated on two of the three conditions renders "Reserve a
                  table" on a reservable venue whose `venue_id` is null, the tap
                  sets `isReserveSheetOpen`, the sheet's gate is false and
                  NOTHING OPENS, forever, with no feedback — Constitution 1.
                  The ORCH-1148 strict-grep gate pins all three on both sites.
                */
                venueReservable?.reservable === true &&
                venueReservable.brand_id !== null &&
                venueReservable.venue_id !== null && (
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

              It is a horizontal list, and it is the ONE horizontal scrollable
              on this sheet.

              #1702 — AND IT IS `BottomSheetFlatList`, NOT A PLAIN RN `FlatList`.
              Seth, on a physical Samsung: "the single card photo gallery
              thumbnails don't scroll horizontally when i scroll them on the
              expanded sheet. Only when i expand them."

              A raw RN list nested in a gorhom sheet does not participate in the
              sheet's gesture negotiation, so on Android the sheet's pan handler
              claims the horizontal drag before the list ever sees it. It works
              in the lightbox because that view is OUTSIDE the sheet — which is
              exactly the "only when i expand them" half of the report.

              This file already knew: the replace-alternatives strip was
              deliberately rebuilt as a wrapping grid a few hundred lines below
              because "it fought the sheet's pan gesture every time a thumb
              crossed it". The same fight, the same file, the wrong conclusion
              drawn once. `BaseBottomSheet` — the sole permitted importer of
              @gorhom/bottom-sheet — already re-exports the sheet-aware list for
              precisely this, and its own comment says so. What it replaces is the 402x300 in-flow #000000 pager
              that used to BE the hero, with its 40pt chevrons, its dot row and its
              dead `.counter` style — and the 402x200 #f3f4f6 "no images" box that
              produced a 100pt layout jump against it.

              Tapping opens `ImageLightbox`, which today has exactly one importer
              and is reachable ONLY from a curated stop — so a single place's
              photos have never been openable at all.
            */}
            {!isCuratedCard && galleryPhotos.length > 0 ? (
              <Section title={t('cards:expanded.photos', { defaultValue: 'Photos' })}>
                <BottomSheetFlatList
                  data={galleryPhotos}
                  keyExtractor={(uri: string, i: number) => `${uri}_${i}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.galleryStrip}
                  renderItem={({ item, index }: { item: string; index: number }) => (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() =>
                        setCuratedLightbox({
                          visible: true,
                          images: galleryPhotos,
                          initialIndex: galleryPhotos.indexOf(item),
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

            {/*
              Slot 5c — SUPPLIES, ABOVE THE PLAN. #1705.

              It sat BELOW the stops ("directly under the stops it is shopped
              for"). Seth, after using it: "The supplies section should come just
              before the plan and indicate what it's for." He is right about the
              order for the same reason the list exists — you buy before you go,
              so the list is the first thing the plan asks of you, not a footnote
              to it.
            */}
            <SuppliesList items={supplies} purposeLine={suppliesPurposeLine} />

            {/* Slot 6 — THE PLAN (a plan has stops) … */}
            <View onLayout={(e) => setPlanSectionY(e.nativeEvent.layout.y)}>
              <StopList
                heading={t('cards:expanded.the_plan', { defaultValue: 'The plan' })}
                stops={planListStops}
                customized={curatedLocalCard !== null}
                onDirections={(stop) => openDirectionsForAddress(stop.address)}
                onReplace={(stop) => handleReplaceStop(stop.index - 1)}
                /* #1605 P2-3 — the stop's own photos, through the SHARED
                   lightbox. It had exactly one entry point in the app and it
                   was the deleted per-stop pager. */
                onOpenPhotos={(stop) =>
                  setCuratedLightbox({
                    visible: true,
                    images: [...stop.imageUrls],
                    initialIndex: 0,
                  })
                }
                onOpenWebsite={(stop) => openStopWebsite(stop.website)}
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
                /*
                  #1605 rework — the deleted `CompanionStopsSection`'s subtitle,
                  restored through the SAME key (translated in all 29 locales).
                  It is not decoration: `StopList` numbers its rows, and these
                  rows are places to BEGIN at, not a sequence to walk. Without
                  the line a stroll's companions read as a three-stop itinerary.
                  A picnic's rows are a shop plus a spot, which the SHOP chip and
                  the heading already explain, so it stays stroll-only.
                */
                subtitle={
                  isPicnicCard
                    ? undefined
                    : t('expanded_details:companion_stops.subtitle')
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

              A plan's coordinate IS `stops[0]`, because that is where the plan
              starts; it is stated once, at the fetch, rather than discovered
              twice.

              This comment used to also claim the wave had fixed time-of-day-aware
              weather for scheduled plans. It had not, and the claim is retracted:
              both fetch branches pass the venue's coordinates and nothing else,
              because `weatherService` only ever returns CURRENT conditions. The
              full retraction, with the two independent reasons the feature has
              never existed, is in `ConditionsSection.tsx`'s header.
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
              countryCode={isCuratedCard ? undefined : card.countryCode}
              website={isCuratedCard ? undefined : card.website}
              utcOffsetMinutes={isCuratedCard ? null : cardUtcOffsetMinutes}
              /*
                #1706 — the PLAN's Details is now `PlanTimeline` below, so this
                section renders the single-place branch only. Two rows that
                happen to be ordered do not say a plan is a sequence; a drawn
                spine does.
              */
              onLinkUnavailable={(what) =>
                toastManager.show(t('cards:expanded.link_unavailable', {
                    defaultValue: "Couldn't open {{what}}",
                    what,
                  }), 'error')
              }
            />

            {/*
              #1706 — THE PLAN'S DETAILS, DRAWN. Seth: "Details section should
              show an animated vertical timeline."

              Curated branch only. A single place's Details is an address, hours,
              a phone and a website — attributes with no order among them, so a
              timeline over them would be decoration pretending to be structure.
            */}
            {isCuratedCard ? (
              <PlanTimeline
                heading={t('expanded_details:action_buttons.details', { defaultValue: 'Details' })}
                startsAt={planStops[0]?.address ?? null}
                startsAtName={planStops[0]?.placeName ?? null}
                endsNear={planStops[planStops.length - 1]?.address ?? null}
                endsNearName={planStops[planStops.length - 1]?.placeName ?? null}
                leg={planTimelineLeg}
              />
            ) : null}

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
