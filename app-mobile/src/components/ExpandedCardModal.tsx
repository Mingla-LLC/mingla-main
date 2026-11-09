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
  AccessibilityInfo,
  AppState,
  BackHandler,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from 'react-i18next';
import { Icon } from "./ui/Icon";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";
import { ExpandedCardModalProps, ExpandedCardData } from "../types/expandedCardTypes";
import type { CuratedExperienceCard, CuratedStop } from '../types/curatedExperience';
import { formatChargedInLine, formatDisplayPrice, parseAndFormatDistance } from "./utils/formatters";
import { canonicalDiscoveryPriceDetail } from '../utils/priceTiers';
import { getReadableCategoryName } from "../utils/categoryUtils";  // ORCH-0685
import { weatherService, WeatherData } from "../services/weatherService";
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
import { LocalReviewsSection } from "./expandedCard/LocalReviewsSection";
import PracticalDetailsSection from "./expandedCard/PracticalDetailsSection";
// #4347 wave 3 — the expanded curated plan: gallery tagged by stop, summary +
// route strip, the one warning, stop cards with clock times, conditions,
// getting there, ends near. The old plan timeline, the old conditions section
// and the plan's old hero are DELETED — this replaces all three.
import { CuratedPlanBody } from "./expandedCard/CuratedPlanBody";
import { PlanStopNavigator } from "./expandedCard/PlanStopNavigator";
import { PlanScrollStore, useResetOnPlanIdentity } from "./expandedCard/planScroll";
import { defaultPlanStart, planMode, planTimeline, stopOrdinals } from "./expandedCard/curatedPlanModel";
import { curatedPlanPriceLabel } from "./expandedCard/expandedCardFacts";
import StopList, { type StopListStop } from "./expandedCard/StopList";
import { occasionFromCategory, stopPurpose } from "./expandedCard/stopPurpose";
// #1605 P1-3 — the picnic Shopping List, re-homed onto the spine. It rendered on
// `main` at :990-992 via the deleted PicnicShoppingList and was not in the
// spec's deletion list; five producers still carry `shoppingList`.
import SuppliesList from "./expandedCard/SuppliesList";
import { SectionError } from "./expandedCard/SpineParts";
import { PINNED_PRIMARY, SPINE } from "./expandedCard/spineTokens";
import { companionStopMeta } from "./expandedCard/expandedCardFacts";
// The ONE Been-here state machine in the app. Declared in SwipeableCards.tsx (the
// #1687 gate delimits it there); imported here so the sheet mounts the SAME
// component rather than a second one in a different shape. The import edge is a
// documented, render-time-only cycle — see that component's header.
import { BeenHereControl } from "./SwipeableCards";
import ReservationPassSection from "./expandedCard/ReservationPassSection";
import TimelineSection from "./expandedCard/TimelineSection";
import EventDetailLayout, { NightOutTicketBar } from "./expandedCard/EventDetailLayout";
// ORCH-1072: brand experiences claimed-to-this-venue, rendered as compact rows
// beneath the stars/miles/price block and above the weather section.
import VenueExperiencesSection from "./expandedCard/VenueExperiencesSection";
// META-ORCH-1148 2.2b: consumer reserve-a-table for reservable venues. The
// affordance + 3-step sheet appear ONLY for a place whose verified-claimed
// brand has reservations enabled (useVenueReservable gate — no dead tap).
import VenueReserveSheet from "./expandedCard/VenueReserveSheet";
import { useVenueReservable } from "../hooks/useVenueReservable";
import { ImageLightbox } from "./ImageLightbox";
// issue #2468 / #4347 wave 2 — every maps link on this sheet goes through
// expandedCard/placeDirections (openPlaceDirections), which wraps the ONE host
// effect, openMapsTarget.
import ActionButtons from "./expandedCard/ActionButtons";
import { pinnedPrimaryStyles } from "./expandedCard/pinnedPrimary";
import InAppBrowserModal from "./InAppBrowserModal";
// #4261: rows inside the sheet (LinkRow, price attribution) open links through
// this provider, mounted INSIDE the sheet's own RN Modal window.
import { InAppBrowserProvider } from "./InAppBrowserProvider";
import { classifyLink } from "../utils/inAppLink";
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
import { useUserLocation } from "../hooks/useUserLocation";
import {
  useUnifiedShare,
  type SharePresentationFailureClass,
  type SharePresentationObservation,
} from "./share/UnifiedShareProvider";
import { trackContentShareEvent } from "../services/contentShareAdapter";
// #4347 wave 2 — the expanded single place, gallery first.
import { useReducedMotion } from "react-native-reanimated";
import { PlaceGallery } from "./expandedCard/PlaceGallery";
import { PlaceBasics } from "./expandedCard/PlaceBasics";
import { WhenYoudGo } from "./expandedCard/WhenYoudGo";
import { openPlaceDirections, openRouteAllStops, planRouteTargets, routeCap } from "./expandedCard/placeDirections";
import {
  basicsTiles,
  lightboxFor,
  sheetGalleryMedia,
  whenChips,
  type WhenKey,
} from "./expandedCard/placeSheetModel";
import { formatClockMinute, weekdayShort } from "./deckCard/useDeckFactLabels";
import { canonicalDiscoveryPriceLabel } from "../utils/priceTiers";

const SHARE_PRESENTATION_WATCHDOG_MS = 2_000;

type VoidDeferred = {
  readonly promise: Promise<void>;
  resolve: () => void;
  cancel: () => void;
  readonly settled: boolean;
};

function createVoidDeferred(): VoidDeferred {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;
  let settled = false;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const deferred: VoidDeferred = {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      resolvePromise?.();
    },
    cancel: () => {
      if (settled) return;
      settled = true;
      rejectPromise?.(new Error('handoff_cancelled'));
    },
    get settled() { return settled; },
  };
  // Back/unmount can cancel before the handoff task reaches its first await.
  void promise.catch(() => undefined);
  return deferred;
}

/** Acknowledgement timeout measured only while the app owns active foreground. */
function withActiveForegroundWatchdog(
  acknowledgement: Promise<void>,
  timeoutMs = SHARE_PRESENTATION_WATCHDOG_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let remainingMs = timeoutMs;
    let activeStartedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let subscription: { remove: () => void } | null = null;

    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      subscription?.remove();
    };
    const settle = (result: 'resolved' | 'rejected', error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result === 'resolved') resolve();
      else reject(error ?? new Error('active_foreground_timeout'));
    };
    const pause = (): void => {
      if (activeStartedAt !== null) {
        remainingMs = Math.max(0, remainingMs - (Date.now() - activeStartedAt));
        activeStartedAt = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const resume = (): void => {
      if (settled || activeStartedAt !== null) return;
      if (remainingMs <= 0) {
        settle('rejected', new Error('active_foreground_timeout'));
        return;
      }
      activeStartedAt = Date.now();
      timer = setTimeout(
        () => settle('rejected', new Error('active_foreground_timeout')),
        remainingMs,
      );
    };
    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
      else pause();
    });
    if (AppState.currentState === 'active') resume();
    acknowledgement.then(
      () => settle('resolved'),
      (error: unknown) => settle(
        'rejected',
        error instanceof Error ? error : new Error('presentation_rejected'),
      ),
    );
  });
}

function waitUntilAppActive(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('handoff_cancelled'));
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: { remove: () => void } | null = null;
    const cleanup = (): void => {
      subscription?.remove();
      signal.removeEventListener('abort', cancelWait);
    };
    const cancelWait = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('handoff_cancelled'));
    };
    subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    });
    signal.addEventListener('abort', cancelWait, { once: true });
  });
}

type ExpandedShareRecoveryDependencies = {
  isCurrent: () => boolean;
  failureClass: SharePresentationFailureClass;
  cancelObservation: (failureClass: SharePresentationFailureClass) => void;
  waitForDismissal: () => Promise<void>;
  waitForActive: () => Promise<void>;
  releaseObservation: () => void;
  showFailure: () => void;
  restore: () => Promise<void>;
};

function isExpectedShareHandoffCancellation(error: unknown): boolean {
  return error instanceof Error && error.message === 'handoff_cancelled';
}

/**
 * #1880: the recovery transaction is dependency-injected so every async
 * boundary can re-check the exact admitted generation before side effects.
 */
async function runExpandedShareRecovery({
  isCurrent,
  failureClass,
  cancelObservation,
  waitForDismissal,
  waitForActive,
  releaseObservation,
  showFailure,
  restore,
}: ExpandedShareRecoveryDependencies): Promise<'cancelled' | 'recovered'> {
  if (!isCurrent()) return 'cancelled';
  cancelObservation(failureClass);
  try {
    await waitForDismissal();
  } catch (error: unknown) {
    if (!isCurrent() || isExpectedShareHandoffCancellation(error)) return 'cancelled';
    // A bounded native-dismiss timeout is itself the presentation failure;
    // continue only while this exact caller still owns recovery.
  }
  if (!isCurrent()) return 'cancelled';
  try {
    await waitForActive();
  } catch (error: unknown) {
    if (!isCurrent() || isExpectedShareHandoffCancellation(error)) return 'cancelled';
    throw error;
  }
  if (!isCurrent()) return 'cancelled';
  releaseObservation();
  if (!isCurrent()) return 'cancelled';
  showFailure();
  if (!isCurrent()) return 'cancelled';
  await restore();
  return isCurrent() ? 'recovered' : 'cancelled';
}

function observeExpandedShareTask(
  task: Promise<void>,
  isCurrent: () => boolean,
  recordUnexpected: (error: unknown) => void,
): Promise<void> {
  return task.catch((error: unknown) => {
    if (isExpectedShareHandoffCancellation(error) || !isCurrent()) return;
    recordUnexpected(error);
  });
}

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
  shareProducerSurface,
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
  const { beginExpandedPresentation } = useUnifiedShare();
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

  /*
    #4347 wave 3 (decision 4) — a HOST EXPERIENCE opens its public page, never
    the plan sheet. The deck already routes it (wave 1); this catches the one
    path that still reaches the sheet: a liked experience that Likes re-tags
    `curated` (see `isBrandExperiencePlan` below for why the brand attribution,
    not the tag, is read). Without slugs it stays here, in the plan layout with
    no swap.
  */
  useEffect(() => {
    if (!visible || !card) return;
    const c = card as {
      cardType?: unknown; brandId?: unknown; eventId?: unknown;
      brandSlug?: unknown; eventSlug?: unknown; stops?: unknown;
    };
    if (c.cardType !== 'curated') return;
    const brandExperience =
      typeof c.brandId === 'string' && c.brandId.length > 0 &&
      typeof c.eventId === 'string' && c.eventId.length > 0 &&
      Array.isArray(c.stops) && c.stops.length > 0;
    if (!brandExperience) return;
    if (typeof c.brandSlug === 'string' && c.brandSlug.length > 0 && typeof c.eventSlug === 'string' && c.eventSlug.length > 0) {
      router.push(`/exp/${c.brandSlug}/${c.eventSlug}` as never);
      onClose();
    }
  }, [visible, card, router, onClose]);

  const { t, i18n } = useTranslation(['cards', 'common']);
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
  /** #4347 rework (P2-b) — only the latest forecast request may write. */
  const weatherRequestRef = useRef(0);
  const [viewerTravelTime, setViewerTravelTime] = useState<string | null>(null);
  const [viewerDistance, setViewerDistance] = useState<number | null>(null);
  const [strollData, setStrollData] = useState(card?.strollData);
  const [loadingStrollData, setLoadingStrollData] = useState(false);
  const [picnicData, setPicnicData] = useState(card?.picnicData);
  const [loadingPicnicData, setLoadingPicnicData] = useState(false);
  const [seatMapFailed, setSeatMapFailed] = useState(false);
  const [ticketBrowserUrl, setTicketBrowserUrl] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserTitle, setBrowserTitle] = useState('');
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  // #4347 wave 2 — the "When you'd go" time; back to Now for every new card.
  const [whenKey, setWhenKey] = useState<WhenKey>('now');
  const reducedMotion = useReducedMotion();
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
  const scrollRef = useRef<ScrollView>(null);
  /**
   * The user's LOCAL edits to a curated plan (a replaced stop). `null` until the
   * first replacement, so "customized" is a real state rather than the reference
   * inequality it used to be — and it RESETS when the card changes, which the
   * old `useState(card)` inside MultiStopPlanView never did (a prop change
   * without a remount left the previous plan on screen).
   */
  const [curatedLocalCard, setCuratedLocalCard] = useState<CuratedExperienceCard | null>(null);
  /**
   * #4347 wave 3 — the plan's start time as the user picked it ("Starts · tap to
   * change", or a warning's "Start at …" fix). Null = the default: the
   * scheduled time when the plan is scheduled, otherwise the next sensible
   * slot. Every arrival time, forecast, crowd value and the warning follow it.
   */
  const [planStartOverride, setPlanStartOverride] = useState<Date | null>(null);
  /** Where the plan sheet is scrolled to — a store, not state (see planScroll.ts). */
  const [planScroll] = useState(() => new PlanScrollStore());
  /** Review mode's header height, so the navigator pins just under it. */
  const [reviewHeaderHeight, setReviewHeaderHeight] = useState(0);
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

  type ShareHandoffPhase = 'idle' | 'expanded_dismissing' | 'provider_presenting' | 'provider_visible' | 'expanded_restoring';
  const [shareHandoffPhase, setShareHandoffPhaseState] = useState<ShareHandoffPhase>('idle');
  const shareHandoffPhaseRef = useRef<ShareHandoffPhase>('idle');
  const shareHandoffGeneration = useRef(0);
  const capturedShareCard = useRef<ExpandedCardData | null>(null);
  const rootDismissedAcknowledgement = useRef<VoidDeferred | null>(null);
  const rootShownAcknowledgement = useRef<VoidDeferred | null>(null);
  const sharePresentationObservation = useRef<SharePresentationObservation | null>(null);
  const shareHandoffAbortController = useRef<AbortController | null>(null);
  const shareHandoffMounted = useRef(true);
  const shareControlRef = useRef<View | null>(null);
  const visibleRef = useRef(visible);
  const currentCardIdRef = useRef(card?.id ?? null);
  visibleRef.current = visible;
  currentCardIdRef.current = card?.id ?? null;

  const setShareHandoffPhase = useCallback((phase: ShareHandoffPhase): void => {
    shareHandoffPhaseRef.current = phase;
    setShareHandoffPhaseState(phase);
  }, []);

  const shareHandoffBusy =
    shareHandoffPhase === 'expanded_dismissing' ||
    shareHandoffPhase === 'provider_presenting' ||
    shareHandoffPhase === 'expanded_restoring';
  const rootSuspendedForShare =
    shareHandoffPhase !== 'idle' && shareHandoffPhase !== 'expanded_restoring';

  const anyChildModalOpen =
    browserUrl !== null ||
    ticketBrowserUrl !== null ||
    isSchedulePickerOpen ||
    curatedLightbox.visible ||
    selectedVenueExperience !== null ||
    isReserveSheetOpen ||
    rootSuspendedForShare;

  const handleRootSheetClose = useCallback(() => {
    // ORCH-1022: while a child RN Modal/WebView is open, the root sheet is
    // intentionally suppressed to free the native presentation slot. Swallow
    // BaseBottomSheet's synthetic close so the card state is not torn down.
    if (browserUrl !== null || ticketBrowserUrl !== null || isSchedulePickerOpen || curatedLightbox.visible || selectedVenueExperience !== null || isReserveSheetOpen || shareHandoffPhaseRef.current !== 'idle') {
      return;
    }
    onClose();
  }, [browserUrl, curatedLightbox.visible, isSchedulePickerOpen, onClose, ticketBrowserUrl, selectedVenueExperience, isReserveSheetOpen]);

  const focusShareControl = useCallback((): void => {
    const nativeNode = findNodeHandle(shareControlRef.current);
    if (nativeNode !== null) AccessibilityInfo.setAccessibilityFocus(nativeNode);
  }, []);

  const cancelShareHandoff = useCallback((): void => {
    shareHandoffGeneration.current += 1;
    shareHandoffAbortController.current?.abort();
    shareHandoffAbortController.current = null;
    rootDismissedAcknowledgement.current?.cancel();
    rootDismissedAcknowledgement.current = null;
    rootShownAcknowledgement.current?.cancel();
    rootShownAcknowledgement.current = null;
    sharePresentationObservation.current?.cancel('presentation_rejected');
    sharePresentationObservation.current = null;
    capturedShareCard.current = null;
    if (shareHandoffMounted.current) setShareHandoffPhase('idle');
  }, [setShareHandoffPhase]);

  const restoreExpandedAfterShare = useCallback(async (
    generation: number,
    failureAlreadyShown = false,
  ): Promise<void> => {
    const signal = shareHandoffAbortController.current?.signal;
    const captured = capturedShareCard.current;
    if (
      captured === null ||
      signal === undefined ||
      !visibleRef.current ||
      currentCardIdRef.current !== captured.id ||
      shareHandoffGeneration.current !== generation ||
      signal.aborted
    ) {
      capturedShareCard.current = null;
      if (shareHandoffMounted.current) setShareHandoffPhase('idle');
      return;
    }

    const shown = createVoidDeferred();
    rootShownAcknowledgement.current = shown;
    setShareHandoffPhase('expanded_restoring');
    try {
      await withActiveForegroundWatchdog(shown.promise);
      if (shareHandoffGeneration.current !== generation || signal.aborted) return;
      capturedShareCard.current = null;
      rootShownAcknowledgement.current = null;
      shareHandoffAbortController.current = null;
      setShareHandoffPhase('idle');
      focusShareControl();
    } catch {
      if (shareHandoffGeneration.current !== generation || signal.aborted) return;
      capturedShareCard.current = null;
      rootShownAcknowledgement.current = null;
      shareHandoffAbortController.current = null;
      setShareHandoffPhase('idle');
      if (!failureAlreadyShown) {
        toastManager.show("Couldn't open sharing. Please try again.", 'error');
        AccessibilityInfo.announceForAccessibility("Couldn't open sharing. Please try again.");
      }
      focusShareControl();
    }
  }, [focusShareControl, setShareHandoffPhase]);

  const emitParentPresentationFailure = useCallback((
    captured: ExpandedCardData,
    failureClass: SharePresentationFailureClass,
    startedAt: number,
    correlationId: string,
  ): void => {
    trackContentShareEvent('share_failure', {
      kind: captured.cardType === 'curated' || Array.isArray(captured.stops) ? 'curated' : 'place',
      producer_surface: shareProducerSurface,
      platform: Platform.OS,
      duration_ms: Math.max(0, Date.now() - startedAt),
      request_correlation: correlationId,
      failure_type: failureClass,
    });
  }, [shareProducerSurface]);

  const admitExpandedShare = useCallback((cardToCapture: ExpandedCardData): void => {
    if (shareHandoffPhaseRef.current !== 'idle') return;

    const planningPreference = cardToCapture.shareMessageContext?.planningPreference ?? {
      timeOfDay: userPreferences?.timeOfDay ?? 'Afternoon',
      dayOfWeek: userPreferences?.dayOfWeek ?? 'Weekend',
      planningTimeframe: userPreferences?.planningTimeframe ?? 'This month',
    };
    const shareMessageContext = Object.freeze({
      ...cardToCapture.shareMessageContext,
      planningPreference: typeof planningPreference === 'string'
        ? planningPreference
        : Object.freeze({ ...planningPreference }),
    });
    const captured: ExpandedCardData = Object.freeze({
      ...cardToCapture,
      shareMessageContext,
    });

    shareHandoffGeneration.current += 1;
    const generation = shareHandoffGeneration.current;
    const abortController = new AbortController();
    shareHandoffAbortController.current = abortController;
    const startedAt = Date.now();
    const parentCorrelationId = `expanded-parent-${generation}`;
    const dismissed = createVoidDeferred();
    rootDismissedAcknowledgement.current = dismissed;
    capturedShareCard.current = captured;
    shareHandoffPhaseRef.current = 'expanded_dismissing';
    setShareHandoffPhaseState('expanded_dismissing');
    void Haptics.selectionAsync().catch((error: unknown) => {
      console.info('[content-share] selection haptic unavailable', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    });
    AccessibilityInfo.announceForAccessibility('Opening sharing.');

    const isCurrentHandoffTask = (): boolean =>
      shareHandoffMounted.current &&
      shareHandoffGeneration.current === generation &&
      !abortController.signal.aborted &&
      visibleRef.current &&
      currentCardIdRef.current === captured.id &&
      capturedShareCard.current === captured;

    const handoffTask = (async (): Promise<void> => {
      let observation: SharePresentationObservation | null = null;
      let parentDismissed = false;
      try {
        await withActiveForegroundWatchdog(dismissed.promise);
        parentDismissed = true;
        if (!isCurrentHandoffTask()) return;
        if (rootDismissedAcknowledgement.current === dismissed) {
          rootDismissedAcknowledgement.current = null;
        }
        await waitUntilAppActive(abortController.signal);
        if (!isCurrentHandoffTask()) return;

        observation = beginExpandedPresentation(shareProducerSurface);
        sharePresentationObservation.current = observation;
        setShareHandoffPhase('provider_presenting');
        onShare(captured);
        await withActiveForegroundWatchdog(observation.presented);
        if (!isCurrentHandoffTask()) return;
        setShareHandoffPhase('provider_visible');

        await observation.dismissalRequested;
        if (!isCurrentHandoffTask()) return;
        // Lifecycle contract: `await observation.dismissed` is deliberately
        // watchdog-bounded below so a missing native callback recovers visibly.
        await withActiveForegroundWatchdog(observation.dismissed);
        if (!isCurrentHandoffTask()) return;
        await waitUntilAppActive(abortController.signal);
        // Revalidate the mounted generation, visible caller, and captured card
        // after foreground ownership returns and before expanded_restoring.
        if (!isCurrentHandoffTask()) return;
        if (sharePresentationObservation.current === observation) {
          sharePresentationObservation.current = null;
        }
        // The foreground and caller checks above gate the expanded_restoring transition.
        await restoreExpandedAfterShare(generation);
      } catch (error: unknown) {
        if (!isCurrentHandoffTask() || isExpectedShareHandoffCancellation(error)) return;
        const failureClass: SharePresentationFailureClass =
          observation === null
            ? parentDismissed
              ? 'presentation_rejected'
              : 'parent_modal_still_presented'
            : error instanceof Error && error.message === 'active_foreground_timeout'
              ? 'presentation_timeout'
              : 'presentation_rejected';
        if (observation === null) {
          emitParentPresentationFailure(captured, failureClass, startedAt, parentCorrelationId);
        }
        const recoveryObservation = observation;
        await runExpandedShareRecovery({
          isCurrent: isCurrentHandoffTask,
          failureClass,
          cancelObservation: (classification) => recoveryObservation?.cancel(classification),
          waitForDismissal: () => recoveryObservation === null
            ? Promise.resolve()
            : withActiveForegroundWatchdog(recoveryObservation.dismissed),
          waitForActive: () => waitUntilAppActive(abortController.signal),
          releaseObservation: () => {
            if (
              shareHandoffGeneration.current === generation &&
              sharePresentationObservation.current === recoveryObservation
            ) sharePresentationObservation.current = null;
          },
          showFailure: () => {
            toastManager.show("Couldn't open sharing. Please try again.", 'error');
            AccessibilityInfo.announceForAccessibility("Couldn't open sharing. Please try again.");
          },
          restore: () => restoreExpandedAfterShare(generation, true),
        });
      }
    })();
    void (async (): Promise<void> => {
      await observeExpandedShareTask(
        handoffTask,
        isCurrentHandoffTask,
        (error) => {
          console.info('[content-share] expanded handoff task failed', {
            reason: error instanceof Error ? error.name : 'unknown',
          });
        },
      );
    })();
  }, [
    beginExpandedPresentation,
    emitParentPresentationFailure,
    onShare,
    restoreExpandedAfterShare,
    setShareHandoffPhase,
    shareProducerSurface,
    userPreferences?.dayOfWeek,
    userPreferences?.planningTimeframe,
    userPreferences?.timeOfDay,
  ]);

  const handleRootNativeDismiss = useCallback((): void => {
    rootDismissedAcknowledgement.current?.resolve();
  }, []);

  const handleRootNativeShow = useCallback((): void => {
    rootShownAcknowledgement.current?.resolve();
  }, []);

  useEffect(() => {
    if (shareHandoffPhase === 'idle' || shareHandoffPhase === 'provider_visible') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelShareHandoff();
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [cancelShareHandoff, onClose, shareHandoffPhase]);

  useEffect(() => {
    if (
      shareHandoffPhaseRef.current !== 'idle' &&
      (!visible || capturedShareCard.current?.id !== (card?.id ?? null))
    ) cancelShareHandoff();
  }, [cancelShareHandoff, card?.id, visible]);

  useEffect(() => () => {
    shareHandoffMounted.current = false;
    cancelShareHandoff();
  }, [cancelShareHandoff]);

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
      // #4347 rework (P2-b) — the previous card's forecast never shows on this
      // one (review mode switches cards without closing the sheet), and a slow
      // response for the previous card is dropped (weatherRequestRef).
      setWeatherData(null);
      fetchAdditionalData();
      if ((card as any).cardType !== 'curated') {
        setStrollData(card.strollData);
        setPicnicData(card.picnicData);
      }
    } else {
      // Reset state when modal closes
      setWeatherData(null);
      setViewerTravelTime(null);
      setViewerDistance(null);
      setStrollData(undefined);
      setPicnicData(undefined);
      setSeatMapFailed(false);
      setTicketBrowserUrl(null);
      setBrowserUrl(null);
      setBrowserTitle('');
      setIsSchedulePickerOpen(false);
      setCuratedLightbox({ visible: false, images: [], initialIndex: 0 });
    }
  }, [visible, card, viewerLoc?.lat, viewerLoc?.lng, effectiveTravelMode]);

  // A replaced stop belongs to the card it was replaced on. The old
  // `useState(card)` inside MultiStopPlanView had no sync effect at all, so on
  // the deck — a single stable mount whose `target` prop changes — a previous
  // plan could survive onto the next card. #4347 rework: keyed on the card's
  // IDENTITY only, so a GPS refetch or a collab mode change (which re-run the
  // fetch effect above) no longer throws away the chosen start time and swaps.
  useResetOnPlanIdentity(visible, card?.id ?? null, () => {
    setWhenKey('now');
    setCuratedLocalCard(null);
    setPlanStartOverride(null);
    planScroll.reset();
    setReplacingStopIndex(null);
    clearAlternatives();
  });

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
      // #4347 wave 3 — a plan fetches its forecasts PER STOP inside
      // CuratedPlanBody (the hourly forecast at each arrival); the stop-1-only
      // "right now" weather and busyness fetch is gone with the old conditions section.
      computeViewerTravelForChatMount();
      return;
    }

    // The hourly forecast "When you'd go" reads. (#4347 wave 3: the typical
    // crowd now comes from the built-in curves in placeSheetModel, so the old
    // busyness fetch — whose only reader was the old conditions section — is gone.)
    let weather: WeatherData | null = null;
    const request = ++weatherRequestRef.current;
    if (card.location) {
      try {
        weather = await weatherService.getWeatherForecast(
          card.location.lat,
          card.location.lng
        );
        if (request === weatherRequestRef.current) setWeatherData(weather);
      } catch (error) {
        console.error("Error fetching weather in modal:", error);
        if (request === weatherRequestRef.current) setWeatherData(null);
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
   * #4347 — a brand experience's price, when converted, also says what the host
   * charges: "₦100,000 · charged in naira" under the plate's "≈ $74". AI plans
   * show a spend level and have no amount to restate.
   */
  const planChargedInLine: string | null = (() => {
    if (!isCuratedCard || !isBrandExperiencePlan || !planCard) return null;
    const converted = formatDisplayPrice({
      min: planCard.totalPriceMin,
      max: planCard.totalPriceMax,
      openEnded: planCard.totalPriceOpenEnded,
      sourceCurrency: typeof planCard.currency === 'string' ? planCard.currency : '',
      viewerCurrency: accountPreferences?.currency,
      server: planCard,
    });
    if (!converted?.isApprox) return null;
    return formatChargedInLine(converted.sourceText, converted.sourceCurrency, t);
  })();

  /** The venue's UTC offset, top-level or legacy-cased. Absent = no badge. */
  const cardUtcOffsetMinutes = card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null;

  /*
    #4347 wave 2 — the old in-body "Photos" strip (`galleryPhotos`, a 160 x 120
    BottomSheetFlatList half way down the sheet) is DELETED: a single place now
    OPENS on its gallery (PlaceGallery), which pages every photo, plays a video
    cover in slot 1 and opens the same ImageLightbox. A plan never had one.
  */

  /*
    #4347 wave 2 — THE EXPANDED SINGLE PLACE, decided once per render.
  */
  const sheetLanguage = i18n?.language ?? 'en';
  const sheetNow = new Date();
  const sheetClock = (minute: number): string => formatClockMinute(minute, sheetLanguage);
  const sheetMedia = isCuratedCard ? [] : sheetGalleryMedia(card.images, card.image);
  const sheetTiles = isCuratedCard
    ? []
    : basicsTiles(
        {
          openingHours: card.openingHours,
          utcOffsetMinutes: cardUtcOffsetMinutes,
          priceText: canonicalDiscoveryPriceLabel(card) ?? card.priceRange ?? null,
          travelTime: viewerTravelTime ?? card.travelTime ?? null,
          distanceText: card.distance
            ? parseAndFormatDistance(card.distance, accountPreferences?.measurementSystem)
            : viewerDistance !== null
              ? parseAndFormatDistance(`${viewerDistance} km`, accountPreferences?.measurementSystem)
              : null,
          rating: card.rating ?? null,
          reviewCount: card.reviewCount ?? null,
        },
        sheetNow,
        {
          openUntil: (time) => t('cards:deck.open_until', { time }),
          closesIn: (minutes) => t('cards:deck.closes_in', { minutes }),
          opensAt: (time) => t('cards:deck.opens_at', { time }),
          opensTomorrow: (time) => t('cards:deck.opens_tomorrow', { time }),
          opensOn: (dayOffset, time) =>
            t('cards:deck.opens_on', { day: weekdayShort(sheetNow, dayOffset, sheetLanguage), time }),
          open24h: t('cards:deck.open_24h'),
          clock: sheetClock,
          rating: (rating, count) =>
            count === null
              ? t('cards:sheet.rating_value_no_count', { rating })
              : t('cards:sheet.rating_value', { rating, count }),
        },
      );
  const sheetScheduledAt = (() => {
    const raw = (card as { scheduledAt?: unknown }).scheduledAt;
    if (typeof raw !== 'string') return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  })();
  /*
    #4347 rework — "When you'd go" reads ONE clock. With no venue offset on the
    card, the chips and the crowd take the forecast's own offset (Open-Meteo's
    timezone=auto is the venue's zone), never the device clock beside a
    venue-local forecast.
  */
  const whenUtcOffsetMinutes: number | null =
    cardUtcOffsetMinutes ??
    (typeof weatherData?.utcOffsetSeconds === 'number' ? Math.round(weatherData.utcOffsetSeconds / 60) : null);
  const sheetWhenChips = whenChips(sheetNow, whenUtcOffsetMinutes, sheetScheduledAt);
  const sheetKicker = card.category ? getReadableCategoryName(card.category) : null;
  const sheetDirections = (): void =>
    openPlaceDirections(
      {
        lat: card.location?.lat ?? null,
        lng: card.location?.lng ?? null,
        label: card.address || card.title,
        googlePlaceId: card.googlePlaceId ?? null,
      },
      {
        onUnavailable: () =>
          toastManager.show(t('cards:expanded.directions_unavailable', { defaultValue: "Couldn't open directions" }), 'error'),
      },
    );

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
  const suppliesPurposeLine = ((): string | null => {
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
  })();


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
        // #1705 — no comboCategory on this producer, so no purpose. Never guessed.
        purpose: null,
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
        // #1705 — no comboCategory on this producer, so no purpose. Never guessed.
        purpose: null,
      });
    });
    return rows.filter((row) => row.name.trim().length > 0);
  })();

  /**
   * Directions for the card's own venue. #2468.
   *
   * It ALREADY had the coordinate and threw it away: the iOS arm built
   * `maps:0,0?q=<lat>,<lng>`, which is a free-TEXT search for the string
   * "6.43,3.42" — Apple re-geocodes it exactly like an address and can land
   * anywhere. Both arms were also `Platform.select({ios, android})`, which
   * returns undefined on web, so `if (url)` silently no-opped there (the #1605
   * dead-tap class), and neither arm had a `canOpenURL` pre-flight or any
   * user-visible failure. `openMapsTarget` fixes all three at once.
   */
  const openDirections = (): void => {
    const coords = nightOut?.coordinates;
    const label = nightOut?.venueName || card.address || null;
    // #4347 wave 2 — through the sheet's ONE directions helper.
    openPlaceDirections(
      { lat: coords?.lat ?? null, lng: coords?.lng ?? null, label },
      {
        // This arm never had a pre-flight; the https fallback + toast are new
        // and are the whole point (it used to no-op silently on web).
        onUnavailable: () =>
          toastManager.show(
            t('cards:expanded.directions_unavailable', {
              defaultValue: "Couldn't open directions",
            }),
            'error',
          ),
      },
    );
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
    /*
      #2468 — a plan STOP carries no lat/lng (`StopListStop` has `address` and
      no coordinate; the curated/companion producers never emit one), so this
      surface keeps the HONEST text path. It now goes through the one builder so
      the day a stop gains a coordinate, this call site gets the fix for free.
      The canOpenURL pre-flight, the https fallback and the failure toast all
      live inside `openMapsTarget`.
    */
    openPlaceDirections(
      { label: address },
      {
        // #1605 added the pre-flight on THIS site; it is preserved.
        preflight: true,
        onUnavailable: () =>
          toastManager.show(
            t('cards:expanded.directions_unavailable', {
              defaultValue: "Couldn't open directions",
            }),
            'error',
          ),
      },
    );
  };

  /**
   * A stop's own booking / policies page. #1605 rework.
   *
   * #4261: opens in Mingla's in-app browser through this sheet's existing
   * browser mount (`browserUrl`), so the ORCH-1022 gate (`anyChildModalOpen`)
   * still lowers the root sheet while the page is up. `classifyLink` is the
   * one URL check; a link it refuses gets the same toast as before.
   */
  const openStopWebsite = (url: string | null): void => {
    if (url === null || url.trim().length === 0) return;
    const link = classifyLink(url);
    if (link.kind !== 'web' && link.kind !== 'document') {
      toastManager.show(
        t('cards:expanded.link_unavailable', {
          defaultValue: "Couldn't open {{what}}",
          what: t('expanded_details:action_buttons.website', { defaultValue: 'Website' }),
        }),
        'error',
      );
      return;
    }
    setBrowserUrl(link.url);
    setBrowserTitle(t('expanded_details:action_buttons.website', { defaultValue: 'Website' }));
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

  /*
    ═══════════════════════════════════════════════════════════════════════════
    #4347 wave 3 — THE EXPANDED CURATED PLAN's sheet-level pieces: the start
    time, the Spend tile, "Route all stops", the navigator jump, the swap grid.
    ═══════════════════════════════════════════════════════════════════════════
  */
  const planStart: Date = planStartOverride ?? defaultPlanStart(sheetNow, sheetScheduledAt);
  const planOrdinals = stopOrdinals(planStops);
  /**
   * The card the pinned bar acts on: the place, or the plan AS EDITED (a
   * swapped stop is what Save and Schedule must keep — #1707). One cast site.
   */
  const actionCard = (isCuratedCard && planCard ? planCard : card) as unknown as ExpandedCardData;
  const planSpend: { value: string; sub: string | null } | null = (() => {
    if (!isCuratedCard || !planCard) return null;
    const value = curatedPlanPriceLabel(planCard, {
      formatMoney: (price) =>
        formatDisplayPrice({ ...price, viewerCurrency: accountPreferences?.currency })?.text ?? null,
      spendLevelLabel: (level) => t(`cards:price.spend_${level}`),
      freeLabel: t('cards:swipeable.free', { defaultValue: 'Free' }),
      isBrandExperience: isBrandExperiencePlan,
    });
    return value === null ? null : { value, sub: planChargedInLine };
  })();
  const directionsUnavailable = (): void => {
    toastManager.show(t('cards:expanded.directions_unavailable', { defaultValue: "Couldn't open directions" }), 'error');
  };
  // #4347 wave 3 rework — every platform routes the whole plan, so the index
  // of the next stop (still reported by the plan body's route link) is not used.
  const routeAllStops = (_nextIndex: number, mode: 'driving' | 'walking' | 'transit' | 'bicycling'): void =>
    openRouteAllStops(planRouteTargets(planStops), { mode, onUnavailable: directionsUnavailable });
  /** The navigator / route strip / warning jump: smooth scroll, then a pulse. */
  const jumpToStop = (index: number): void => {
    const y = planScroll.jumpTarget(index);
    if (y === null) return;
    scrollRef.current?.scrollTo({ y, animated: !reducedMotion });
    if (!reducedMotion) planScroll.pulse(index);
  };
  /** The existing alternatives grid (replace-curated-stop), inside the stop card. */
  const alternativesPanel = (stopIndex: number): React.ReactNode => (
    <View style={styles.altPanel} testID="plan-swap-panel">
      <View style={styles.altHeader}>
        <Text style={styles.altTitle}>
          {t('cards:plan.swap_title', { number: stopIndex + 1 })}
        </Text>
        <TouchableOpacity
          onPress={() => {
            setReplacingStopIndex(null);
            clearAlternatives();
          }}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.altCancel}>{t('expanded_details:action_buttons.cancel', { defaultValue: 'Cancel' })}</Text>
        </TouchableOpacity>
      </View>
      {isLoadingAlts ? (
        <ActivityIndicator size="small" color={SPINE.accentFill} />
      ) : altsError ? (
        <SectionError
          message={t('cards:expanded.couldnt_load_alternatives')}
          retryLabel={t('cards:expanded.retry')}
          onRetry={() => handleReplaceStop(stopIndex)}
        />
      ) : alternatives.length === 0 ? (
        <Text style={styles.altEmpty}>{t('cards:expanded.no_alternatives')}</Text>
      ) : (
        /*
          A WRAPPING GRID, not a horizontal ScrollView: a nested horizontal
          scrollable fights the sheet's pan gesture.
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
                <Image source={{ uri: alt.imageUrl }} style={styles.altImage} resizeMode="cover" />
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
  );

  // [ORCH-0696 S-6] Conditionally render sticky header + review nav for
  // review-flow surfaces only (Discover deck + Solo deck pass nav props).
  // Drag handle owns chrome role on all other 6 mount surfaces.
  // META-ORCH-0991 Wave A — this is the BaseBottomSheet `header` slot.
  // #4347 wave 2 — the night out's pinned "Get tickets" bar.
  const nightOutTicketBar =
    isNightOut && nightOut ? (
      <NightOutTicketBar
        card={card}
        nightOut={nightOut}
        viewerCurrency={accountPreferences?.currency}
        onOpenBrowser={(url, title) => {
          setBrowserUrl(url);
          setBrowserTitle(title);
        }}
        bottomInset={insets.bottom}
      />
    ) : null;

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
        onNativeShow={handleRootNativeShow}
        onNativeDismiss={handleRootNativeDismiss}
        androidPostCommitNativeShow={shareHandoffPhase === 'expanded_restoring'}
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
        header={
          isCuratedCard && planStops.length > 1 ? (
            <>
              {reviewNavHeader ? (
                <View onLayout={(e) => setReviewHeaderHeight(e.nativeEvent.layout.height)}>{reviewNavHeader}</View>
              ) : null}
              {/* #4347 wave 3 — the sticky stop navigator: absolutely placed over the top of the body. */}
              <PlanStopNavigator
                store={planScroll}
                stops={planStops.map((stop, i) => ({
                  key: `${stop.placeId}_${i}`,
                  ordinal: planOrdinals[i] ?? null,
                  name: stop.placeName,
                }))}
                onJump={jumpToStop}
                reducedMotion={reducedMotion}
                top={reviewNavHeader ? reviewHeaderHeight : 0}
              />
            </>
          ) : (
            reviewNavHeader
          )
        }
        /*
          #4347 wave 2 — THE PINNED ACTION BAR (single place): Save · Schedule ·
          Share · one main button ("Reserve a table" when the venue takes
          reservations, otherwise Directions). It is the SAME ActionButtons
          component — paywall, schedule safety checks, the closed-venue message,
          the device-calendar write — in its pinned layout, so no behaviour moved.
          A plan keeps its in-flow band until wave 3; a night out gets its own
          pinned "Get tickets" bar.
        */
        stickyFooter={
          isNightOut && nightOut ? (
            nightOutTicketBar
          ) : !isCuratedCard ? (
            <View style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <ActionButtons
                variant="pinned"
                card={actionCard}
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
                onShare={() => admitExpandedShare(card)}
                shareLabel={t('cards:swipeable.share_card', { defaultValue: 'Share {{title}}', title: card.title })}
                shareBusy={shareHandoffBusy}
                shareControlRef={shareControlRef}
                reserve={
                  venueReservable?.reservable === true &&
                  venueReservable.brand_id !== null &&
                  venueReservable.venue_id !== null ? (
                    <TouchableOpacity
                      testID="sheet-primary-reserve"
                      style={pinnedPrimaryStyles.button}
                      activeOpacity={0.85}
                      onPress={() => setIsReserveSheetOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={t('cards:sheet.reserve_a11y', { name: card.title })}
                    >
                      <Icon name="restaurant-outline" size={18} color={PINNED_PRIMARY.label} />
                      <Text style={pinnedPrimaryStyles.label} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {t('cards:sheet.reserve')}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      testID="sheet-primary-directions"
                      style={pinnedPrimaryStyles.button}
                      activeOpacity={0.85}
                      onPress={sheetDirections}
                      accessibilityRole="button"
                      accessibilityLabel={t('cards:sheet.directions_a11y', { name: card.title })}
                    >
                      <Icon name="navigate-outline" size={18} color={PINNED_PRIMARY.label} />
                      <Text style={pinnedPrimaryStyles.label} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {t('cards:sheet.directions')}
                      </Text>
                    </TouchableOpacity>
                  )
                }
              />
            </View>
          ) : planCard ? (
            /*
              #4347 wave 3 — THE PLAN's pinned bar: Save plan · Route all stops ·
              Share · "Schedule this plan". The same ActionButtons, so the
              curated paywall (Save and Schedule) and the arrival-time safety
              check (checkAllCuratedStopsOpen) are unchanged; the picker opens
              on the start time chosen on the sheet. It replaces the in-flow
              band. (A host experience never gets here — it opens its page.)
            */
            <View style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <ActionButtons
                variant="pinned"
                card={actionCard}
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
                onShare={() => admitExpandedShare(card)}
                shareLabel={t('cards:swipeable.share_card', { defaultValue: 'Share {{title}}', title: card.title })}
                shareBusy={shareHandoffBusy}
                shareControlRef={shareControlRef}
                // A plan has no reservation of its own (its stops are not one venue).
                reserve={null}
                primaryScheduleLabel={t('cards:plan.schedule_cta')}
                initialScheduleAt={planStart}
                afterSave={
                  planStops.length > 0 ? (
                    <TouchableOpacity
                      testID="sheet-route-all"
                      style={styles.routeAllButton}
                      onPress={() => {
                        const timeline = planTimeline(planStops, planStart, effectiveTravelMode);
                        routeAllStops(0, planMode(timeline, effectiveTravelMode));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('cards:plan.route_all')}
                      accessibilityHint={(() => {
                        const cap = routeCap(planRouteTargets(planStops));
                        return cap ? t('cards:plan.route_capped', { count: cap.total }) : undefined;
                      })()}
                    >
                      <Icon name="map-outline" size={20} color={SPINE.prose} />
                      <Text style={styles.routeAllLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                        {t('cards:plan.route_all')}
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
              />
            </View>
          ) : undefined
        }
        scrollMode="scroll"
        accessibilityLabel={card.title}
        scrollProps={{
          ref: scrollRef,
          style: styles.scrollView,
          // #4347 wave 3 — the plan's navigator reads the scroll from a store, so
          // a scroll frame never re-renders this sheet.
          onScroll: isCuratedCard
            ? (e: { nativeEvent: { contentOffset: { y: number } } }) => planScroll.onScroll(e.nativeEvent.contentOffset.y)
            : undefined,
          scrollEventThrottle: 16,
          contentContainerStyle: [
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ],
        }}
      >
        {/* #4261: links opened by rows in this sheet present inside its window. */}
        <InAppBrowserProvider>
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
                  onShare={admitExpandedShare}
                  shareBusy={shareHandoffBusy}
                  shareControlRef={shareControlRef}
                  onClose={onClose}
                  onOpenBrowser={(url, title) => {
                    setBrowserUrl(url);
                    setBrowserTitle(title);
                  }}
                  accountPreferences={accountPreferences}
                  seatMapFailed={seatMapFailed}
                  setSeatMapFailed={setSeatMapFailed}
                  openDirections={openDirections}
                  onOpenLightbox={(images, initialIndex) =>
                    setCuratedLightbox({ visible: true, images, initialIndex })
                  }
                  active={visible && !anyChildModalOpen}
                  reducedMotion={reducedMotion}
                />
              </>
            ) : (
              <>
            {isCuratedCard && planCard ? (
              <CuratedPlanBody
                title={planCard.title || card.title}
                kicker={t('cards:deck.curated_kicker')}
                tagline={planCard.tagline ?? null}
                stops={planStops}
                originalStops={curatedCard?.stops ?? null}
                isBrandExperience={isBrandExperiencePlan}
                start={planStart}
                onStartChange={setPlanStartOverride}
                now={sheetNow}
                viewer={viewerLoc ? { lat: viewerLoc.lat, lng: viewerLoc.lng } : null}
                fallbackMode={effectiveTravelMode}
                measurementSystem={accountPreferences?.measurementSystem}
                spend={planSpend}
                beenHere={
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
                banners={
                  <>
                    <LockedInBanner card={card} />
                    {reservationPass && <ReservationPassSection pass={reservationPass} />}
                  </>
                }
                supplies={supplies}
                suppliesPurposeLine={suppliesPurposeLine}
                reducedMotion={reducedMotion}
                active={visible && !anyChildModalOpen}
                onClose={onClose}
                closeLabel={t('common:close', { defaultValue: 'Close' })}
                onOpenLightbox={(images, initialIndex) =>
                  setCuratedLightbox({ visible: true, images, initialIndex })
                }
                onDirections={(stop) =>
                  openPlaceDirections(
                    { lat: stop.lat, lng: stop.lng, label: stop.placeName || stop.address, googlePlaceId: stop.placeId || null },
                    { onUnavailable: directionsUnavailable },
                  )
                }
                onRouteAll={routeAllStops}
                onSwap={handleReplaceStop}
                swapPanel={(index) => (replacingStopIndex === index ? alternativesPanel(index) : null)}
                onCall={(tel, display) => {
                  Linking.openURL(`tel:${tel}`).catch(() => toastManager.show(display, 'error'));
                }}
                onWebsite={(url) => openStopWebsite(url)}
                scroll={planScroll}
                onJump={jumpToStop}
              />
            ) : (
              <>
            {/*
              ═══════════════════════════════════════════════════════════════
              #4347 wave 2 — THE EXPANDED SINGLE PLACE, in the approved order:
              see it (gallery), know the basics (kicker, title, Been here, four
              tiles), then read more: About, local reviews, your stroll / picnic,
              experiences at this venue, "When you'd go", Details. The actions
              are the PINNED bar (BaseBottomSheet stickyFooter), not a band that
              scrolls away. Every block that existed before is still here.
              ═══════════════════════════════════════════════════════════════
            */}
            <PlaceGallery
              media={sheetMedia}
              title={card.title}
              reducedMotion={reducedMotion}
              active={visible && !anyChildModalOpen}
              onClose={onClose}
              closeLabel={t('common:close', { defaultValue: 'Close' })}
              onOpen={(uri, shown) => {
                // #4347 rework — from the media STILL in the gallery (failed photos gone).
                const target = lightboxFor(shown, shown.findIndex((m) => m.uri === uri));
                if (target.images.length === 0) return;
                setCuratedLightbox({ visible: true, images: target.images, initialIndex: target.initialIndex });
              }}
            />
            <PlaceBasics
              kicker={sheetKicker}
              title={card.title}
              tiles={sheetTiles}
              beenHere={
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
            />

            {card && <LockedInBanner card={card} />}
            {reservationPass && <ReservationPassSection pass={reservationPass} />}

            {/* About — 3 lines, then More; the typical spend and its "charged in" line stay here. */}
            <CardInfoSection description={card.description} tip={card.tip} discoveryPrice={card} />

            <LocalReviewsSection placePoolId={card.placePoolId ?? card.id} />

            {/*
              … and slot 6 again — COMPANION STOPS, the same component with a
              different producer. A stroll is a multi-stop plan; a picnic's
              grocery store is one stop of it with a SHOP chip.
            */}
            {companionStops.length > 0 ? (
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
            {(isStrollCard || isPicnicCard) &&
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

            {/* Timeline Section (for Take a Stroll cards) */}
            {isStrollCard && strollData && strollData.timeline && (
              <TimelineSection
                category={getReadableCategoryName(card.category)}
                title={card.title}
                address={card.address}
                priceRange={canonicalDiscoveryPriceDetail(card)?.source}
                priceApprox={canonicalDiscoveryPriceDetail(card)?.approximate}
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
                priceApprox={canonicalDiscoveryPriceDetail(card)?.approximate}
                travelTime={viewerTravelTime ?? card.travelTime ?? undefined}
                strollTimeline={picnicData.timeline}
                routeDuration={picnicData.route?.duration}
                currency={accountPreferences?.currency}
              />
            )}

            {/* Slot 7 — experiences at this venue (claimed brands only, single place). */}
            {(
              <VenueExperiencesSection
                placePoolId={card.id}
                currency={accountPreferences?.currency}
                onOpenExperience={setSelectedVenueExperience}
              />
            )}


            <WhenYoudGo
              chips={sheetWhenChips}
              selected={whenKey}
              onSelect={setWhenKey}
              hourly={weatherData?.hourlyForecast ?? null}
              weatherUtcOffsetSeconds={weatherData?.utcOffsetSeconds ?? null}
              category={card.category}
              utcOffsetMinutes={whenUtcOffsetMinutes}
              openingHours={card.openingHours}
              driveTime={viewerTravelTime ?? card.travelTime ?? null}
              lat={card.location?.lat ?? null}
              lng={card.location?.lng ?? null}
              measurementSystem={accountPreferences?.measurementSystem}
              clock={sheetClock}
              reducedMotion={reducedMotion}
            />

            {/* Details — address + Directions (by coordinates), today's hours with All hours, phone, website. */}
            <PracticalDetailsSection
              address={card.address}
              openingHours={card.openingHours}
              phone={card.phone}
              countryCode={card.countryCode}
              website={card.website}
              utcOffsetMinutes={cardUtcOffsetMinutes}
              coordinates={
                typeof card.location?.lat === 'number' && typeof card.location?.lng === 'number'
                  ? { lat: card.location.lat, lng: card.location.lng }
                  : null
              }
              onLinkUnavailable={(what) =>
                toastManager.show(t('cards:expanded.link_unavailable', {
                    defaultValue: "Couldn't open {{what}}",
                    what,
                  }), 'error')
              }
            />
              </>
            )}
              </>
            )}
        </InAppBrowserProvider>
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

    </>
  );
}

// Night Out detail styles

const styles = StyleSheet.create({
  // #4347 wave 3 — the plan bar's "Route all stops".
  routeAllButton: {
    minWidth: 52,
    height: 48,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  routeAllLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: SPINE.factValue,
  },

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

  // #4347 wave 2 — `galleryStrip` / `galleryItem` are DELETED with the strip;
  // the single place's photos are the PlaceGallery at the top of the sheet.

  // The alternatives panel. A WRAPPING GRID, not a horizontal ScrollView — see
  // the render site: the strip was one of the nested scrollables.
  altPanel: { gap: 12, paddingTop: 4 },
  altHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  altTitle: { fontSize: 14, fontWeight: '700', color: SPINE.factValue },
  altCancel: { fontSize: 14, fontWeight: '600', color: SPINE.link },
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
