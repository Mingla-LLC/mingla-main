import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  StatusBar,
  Platform,
  Alert,
  AccessibilityInfo,
  AppState,
  InteractionManager,
  PixelRatio,
  findNodeHandle,
} from "react-native";
import { GestureDetector } from 'react-native-gesture-handler';
import Reanimated from 'react-native-reanimated';
// ORCH-1042: deck hero photos render via expo-image (NOT react-native <Image>).
// expo-image gives us a placeholder + fade transition + a bounded disk-only
// cache + recyclingKey so the per-card remount (`key={currentRec.id}`, ORCH-0694)
// never flashes a bare dark `#1a1a2e` panel during async decode. Keep
// `key={currentRec.id}` — the fix works WITH the remount, not by removing it.
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
// ORCH-1069: shared video-capable cover renderer (image + GIF + video, muted
// autoplay, reduce-motion aware). Same renderer the event/trip grid + hero use
// (COMMS-0007). A venue with a `.mp4` cover plays its video on the deck hero;
// still-only venues keep the ExpoImage CardHeroImage path unchanged. Do NOT add
// a parallel player or a direct expo-video call site here.
import { EventCoverMedia } from "@mingla/offering-rendering";
// ORCH-1069: single owner of video-URL detection, mirrors discover-cards
// isVideoUrl (I-1069-VIDEO-DETECTION-MATCHES-EDGE).
import { firstVideoUrl } from "../utils/videoUrl";
import { useTranslation } from 'react-i18next';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HapticFeedback } from "../utils/hapticFeedback";
import { Icon } from "./ui/Icon";
import { useHasVisited, useRemoveVisit } from "../hooks/useVisits";
// #1687 — the deck's half of the voluntary rating prompt. It WRITES a request
// here; the single PostExperienceModal mount in app/index.tsx reads it. No second
// modal instance, no prop threaded through two memo boundaries.
import {
  usePlaceReviewRequestStore,
  openPlaceReviewRequest,
  placeReviewRequestFromCard,
} from "../store/placeReviewRequestStore";
// #1609 Direction C — the plate. One piece of glass replaces five chips, the
// action rail and the "Details" text. Lives in a leaf module so BOTH card trees
// can read it without reopening the SwipeableCards <-> CuratedExperienceSwipeCard
// require cycle.
import {
  BeenHereBody,
  CardStateDiscs,
  CuratedSlivers,
  DeckCardPlate,
  beenHereStateStyle,
  // #1609 tester P1-1 — the ONE predicate that decides which silhouette a card
  // draws. This tree did not import it at all and hard-coded the 96pt anchor into
  // its stylesheet, so the name and the curated slivers did not follow the plate
  // when it shrank to the short silhouette. Every face-level offset now reads this.
  platePresentation,
  type BeenHereVisualState,
  type MetaSpanInput,
} from "./deckCardPlate";
import { BEEN_HERE, MAX_FONT_SCALE, SURFACES } from "../../../packages/card-identity/index.js";
import { LinearGradient } from "expo-linear-gradient";
import { ANDROID_GLASS_USES_OPAQUE_FALLBACK, colors, fontWeights, glass, radius, typography } from "../constants/designSystem";
import { throttledReverseGeocode } from '../utils/throttledGeocode';

import { ImageWithFallback } from "./figma/ImageWithFallback";
import { formatCurrency, formatDistance, parseAndFormatDistance } from "./utils/formatters";
import { PriceTierSlug, tierLabel, tierRangeLabel, googleLevelToTierSlug, TIER_BY_SLUG } from "../constants/priceTiers";
// ORCH-0640 ch09: experiencesService + experienceGenerationService DELETED.
// UserPreferences re-imported from canonical source. Legacy save calls
// (ExperiencesService.saveExperience) redirected to savedCardsService.saveCard
// (snapshot pattern into saved_card table). Dislike tracking dropped (engagement_metrics
// handles impressions via recordCardSwipe → record_engagement RPC).
import type { UserPreferences } from "../types/preferences";
import { savedCardsService } from "../services/savedCardsService";
import { useAppStore } from "../store/appStore";
import { useUserPreferences } from "../hooks/useUserPreferences";
import ExpandedCardModal from "./ExpandedCardModal";
// #1669 [expanded-card-one-producer]: the deck's producer, which delegates to
// the ONE canonical mapper. The deck no longer hand-writes the object.
import { recommendationToExpandedCardData } from "./utils/recommendationToExpandedCardData";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { CuratedExperienceSwipeCard } from "./CuratedExperienceSwipeCard";
import type { CuratedExperienceCard } from "../types/curatedExperience";
// ORCH-1065 BUG-3: leaf hero-image constants now live in their own module so
// CuratedExperienceSwipeCard can import them WITHOUT importing SwipeableCards
// (which imports CuratedExperienceSwipeCard back — that closed a require cycle).
import {
  CARD_FALLBACK_IMAGE,
  DECK_BOTTOM_SCRIM_HEIGHT_PT,
  DECK_HERO_PLACEHOLDER_BLURHASH,
  DECK_SCRIM_COLORS,
  DECK_SCRIM_LOCATIONS,
  DECK_TOP_SCRIM_COLORS,
  DECK_TOP_SCRIM_HEIGHT_PT,
  DECK_TOP_SCRIM_LOCATIONS,
} from "./deckHeroConstants";
// ORCH-1065: brand experiences expand → business-event sheet → ticket-checkout-create
// (the proven ORCH-1016 trip pattern). NO parallel money fn (COMMS-0014/0016).
import type { BusinessEventCard } from "../types/mergedDiscover";
import { hueFromId } from "../utils/hueFromId";
// ORCH-1157 Round-3 [consumer-hide-address] — fail-closed extractor for the
// anon-safe address-privacy flag (mirrors the discover-merged-events edge fn).
import { extractHideAddressUntilTicket } from "../utils/venueExperienceMapping";
import { mixpanelService } from "../services/mixpanelService";
import { logAppsFlyerEvent } from "../services/appsFlyerService";
// META-ORCH-1187 [Growth Analytics Hub] — behavior events mirror the existing
// Mixpanel sites (parallel run; identical event-name strings for a 1:1 future
// retirement mapping).
import { postHogService } from "../services/postHogService";
import { BoardCardService } from "../services/boardCardService";
// ORCH-0532 / ORCH-0558: shared helper for collab right-swipe — calls
// BoardCardService.recordSwipeAndCheckMatch (atomic RPC: upsert swipe_state +
// fire check_mutual_like trigger under advisory lock + return match state),
// shows provisional + match toasts, fires notifyMatch on matched:true.
// Used by primary swipe gesture AND the 3 non-gesture save callsites so ALL
// collab right-swipes go through one code path.
import { collabSaveCard } from "./helpers/collabSaveCard";
import { collabRecordLeftSwipe } from "./helpers/collabRecordLeftSwipe";
import { useSessionDismissedCards } from "../hooks/useSessionDismissedCards";
import { recordCardSwipe, recordCardExpand } from "../services/cardEngagementService";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useRecommendations,
  Recommendation,
  DeckUIState,
} from "../contexts/RecommendationsContext";
import { FEATURE_FLAG_PER_CONTEXT_DECK_STATE } from "../config/featureFlags";
import { deckContextKey } from "../contexts/deckStateRegistry";
import { DismissedCardsSheet } from "./DismissedCardsSheet";
import { getReadableCategoryName } from "../utils/categoryUtils";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { SkeletonCard } from './SkeletonCard';
import { useFeatureGate } from '../hooks/useFeatureGate';
import { useCalendarEntries } from '../hooks/useCalendarEntries';
import { getTierLimits } from '../constants/tierLimits';
import { useCreatorTier } from '../hooks/useCreatorTier';
import { CustomPaywallScreen } from './CustomPaywallScreen';
import type { GatedFeature } from '../hooks/useFeatureGate';
import NoGpsBanner from './collab/NoGpsBanner';
import {
  buildCollabDeadEndBannerContent,
  classifyIntersectionCase,
  detectIntersectionOutlier,
  formatParticipantName,
  formatTravelDiagnostic,
  normalizeParticipants,
  postCollabDeadEndBanner,
} from "../services/collabDeadEndBannerService";
import type { CollabDeadEndReason } from "../services/deckService";
// ORCH-1058: privacy-aware location chips for the intersection_empty empty state.
import {
  CollabLocationChips,
  type CollabLocationChip,
} from "./collab/CollabLocationChips";
import { resolveParticipantLocationLabel } from "../utils/formatLocationLabel";
// ORCH-1241: pure horizontal-swipe commit decision (translation OR velocity).
// Single source of truth in ../utils/swipeCommit so the thresholds are unit-tested.
import {
  shouldCommitSwipe,
  SWIPE_COMMIT_DISTANCE,
  SWIPE_COMMIT_VELOCITY,
  SWIPE_COMMIT_MIN_DX,
} from "../utils/swipeCommit";
import {
  consumeDeckTokenIntent,
  DeckCommitSettlement,
  DeckSwipeCommitToken,
  DeckSwipePhase,
} from './swipeDeck/deckSwipeLifecycle';
import {
  DECK_VISIBLE_POSTER_CACHE_POLICY,
  DeckHeroDecodeTarget,
  getDeckHeroDecodeTarget,
} from './swipeDeck/deckHeroPolicy';
import {
  DeckSwipeStage,
  type DeckSwipeStageHandle,
} from './swipeDeck/DeckSwipeStage';
import type { UseDeckSwipeControllerOptions } from './swipeDeck/useDeckSwipeController';
import {
  appendDeckSessionHistory,
  flushDeckSessionHistory,
  hydrateDeckSessionHistory,
  rollbackDeckSessionHistory,
  setDeckSessionHistoryInteractionPhase,
  useDeckSessionHistoryStore,
} from '../store/deckSessionHistoryStore';
// Re-export so existing import sites (if any) resolve from this module too.
export { shouldCommitSwipe, SWIPE_COMMIT_DISTANCE, SWIPE_COMMIT_VELOCITY, SWIPE_COMMIT_MIN_DX };

const DECK_PERSISTENCE_QUIET_IDLE_MS = 750;
const DECK_POST_SWIPE_QUIET_IDLE_MS = 2500;

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// ORCH-1065: map a brand-experience Recommendation onto the BusinessEventCard
// shape ExpandedBusinessEventSheet consumes — so the proven cart → tax →
// runNativeCheckout path is reused verbatim. Mirrors tripToBusinessEventCard
// (ConsumerTripDetailScreen.tsx). NO parallel money fn (COMMS-0014/0016):
// eventId = experience.id rides the existing ticket-checkout-create contract.
function experienceRecToBusinessEventCard(rec: any): BusinessEventCard {
  const firstStop = Array.isArray(rec?.stops) && rec.stops.length > 0 ? rec.stops[0] : null;
  const eventId = String(rec?.eventId ?? rec?.id ?? '');
  const brandSlug = typeof rec?.brandSlug === 'string' ? rec.brandSlug : '';
  const eventSlug = typeof rec?.eventSlug === 'string' ? rec.eventSlug : '';
  return {
    eventId,
    brandId: typeof rec?.brandId === 'string' ? rec.brandId : '',
    brandSlug,
    brandName: typeof rec?.brandName === 'string' ? rec.brandName : '',
    brandProfilePhotoUrl: typeof rec?.brandLogoUrl === 'string' ? rec.brandLogoUrl : null,
    eventSlug,
    title: typeof rec?.title === 'string' ? rec.title : '',
    // ORCH-1072: use the experience's REAL description (events.description),
    // NOT the one-line tagline. Empty → null → the sheet shows its empty-state.
    description:
      typeof rec?.description === 'string' && rec.description.trim().length > 0
        ? rec.description
        : null,
    // ORCH-1072: use the experience's REAL cover (image OR video), NOT the
    // fabricated first-stop image + hardcoded 'image'. EventCoverMedia in the
    // shared render layer plays video/gif/image. Falls back to the first stop
    // image only when the experience has no cover at all (honest fallback).
    coverMediaUrl:
      typeof rec?.coverMediaUrl === 'string' && rec.coverMediaUrl.length > 0
        ? rec.coverMediaUrl
        : (firstStop?.imageUrl ?? null),
    coverMediaType:
      rec?.coverMediaType === 'image' ||
      rec?.coverMediaType === 'video' ||
      rec?.coverMediaType === 'gif'
        ? rec.coverMediaType
        : (typeof rec?.coverMediaUrl === 'string' && rec.coverMediaUrl.length > 0
            ? 'image'
            : (firstStop?.imageUrl ? 'image' : null)),
    coverHue: hueFromId(eventId),
    masterDateUtc: rec?.masterDateUtc ?? null,
    masterEndAtUtc: rec?.masterEndAtUtc ?? null,
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: typeof rec?.timezone === 'string' ? rec.timezone : 'UTC',
    venueName: firstStop?.placeName ?? null,
    // ORCH-1138 rework (§4.C.3) — carry the resolved city (rec.city) or fall back
    // to the first stop's city → the consumer City,Country meta chip (was hard null).
    city:
      typeof rec?.city === 'string' && rec.city.length > 0
        ? rec.city
        : (typeof firstStop?.city === 'string' && firstStop.city.length > 0
            ? firstStop.city
            : null),
    address: null,
    // ORCH-1157 Round-3 [consumer-hide-address] — carry the REAL flag instead of
    // a hardcoded `false`. The deck experience envelope carries no top-level
    // street (address is null) and may not carry the theme; honor a direct
    // boolean if present, else fail CLOSED to true (street hidden). Never
    // fabricate a reveal-by-default privacy flag (Constitution rule 9).
    hideAddressUntilTicket:
      typeof rec?.hideAddressUntilTicket === 'boolean'
        ? rec.hideAddressUntilTicket
        : extractHideAddressUntilTicket(rec?.theme),
    format: 'in-person',
    locationGeo:
      firstStop && typeof firstStop.lat === 'number' && typeof firstStop.lng === 'number'
        ? { lat: firstStop.lat, lng: firstStop.lng }
        : null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    priceMin: typeof rec?.totalPriceMin === 'number' ? rec.totalPriceMin : null,
    priceMax: typeof rec?.totalPriceMax === 'number' ? rec.totalPriceMax : null,
    displayPriceCents: null,
    displayCurrency: null,
    currency: typeof rec?.currency === 'string' ? rec.currency : 'USD',
    publicBuyerUrl: `https://business.usemingla.com/e/${brandSlug}/${eventSlug}`,
    // ORCH-1072: carry the multi-stop itinerary + upcoming occurrences so the
    // detail sheet renders the route + the date picker. Experience-only (an
    // event/trip card never sets these → undefined → no itinerary/picker).
    experienceStops: Array.isArray(rec?.stops)
      ? rec.stops.map((s: any, idx: number) => {
          // ORCH-1138 rework (§4.C.3) — carry the FULL per-stop gallery + coords +
          // start time + label so the consumer detail renders count-aware
          // galleries, the "Where you'll start" map, time pills, and START
          // HERE/THEN/END WITH (these were silently dropped — the mockup gap).
          const imageUrls: string[] = Array.isArray(s?.imageUrls)
            ? s.imageUrls.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
            : [];
          const single =
            typeof s?.imageUrl === 'string' && s.imageUrl.length > 0 ? s.imageUrl : null;
          const total = rec.stops.length;
          const stopLabel: 'Start Here' | 'Then' | 'End With' =
            typeof s?.stopLabel === 'string' &&
            (s.stopLabel === 'Start Here' || s.stopLabel === 'Then' || s.stopLabel === 'End With')
              ? s.stopLabel
              : (idx === 0 ? 'Start Here' : idx === total - 1 ? 'End With' : 'Then');
          return {
            stopNumber: typeof s?.stopNumber === 'number' ? s.stopNumber : 0,
            placeName: typeof s?.placeName === 'string' && s.placeName.length > 0 ? s.placeName : null,
            address: typeof s?.address === 'string' && s.address.length > 0 ? s.address : null,
            imageUrl: single ?? (imageUrls.length > 0 ? imageUrls[0] : null),
            aiDescription:
              typeof s?.aiDescription === 'string' && s.aiDescription.length > 0 ? s.aiDescription : null,
            imageUrls: imageUrls.length > 0 ? imageUrls : (single !== null ? [single] : []),
            lat: typeof s?.lat === 'number' && s.lat !== 0 ? s.lat : null,
            lng: typeof s?.lng === 'number' && s.lng !== 0 ? s.lng : null,
            startTime:
              typeof s?.startTime === 'string' && s.startTime.length > 0 ? s.startTime : null,
            stopLabel,
          };
        })
      : undefined,
    experienceIntents: Array.isArray(rec?.experienceIntents)
      ? rec.experienceIntents.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
      : undefined,
    brandTheme:
      rec?.brandTheme !== null && typeof rec?.brandTheme === 'object' ? rec.brandTheme : null,
    upcomingOccurrences: Array.isArray(rec?.upcomingOccurrences)
      ? rec.upcomingOccurrences.map((o: any) => ({
          eventDateId: typeof o?.eventDateId === 'string' ? o.eventDateId : '',
          startAt: typeof o?.startAt === 'string' ? o.startAt : '',
          endAt: typeof o?.endAt === 'string' ? o.endAt : '',
          capacity: typeof o?.capacity === 'number' ? o.capacity : null,
          sold: typeof o?.sold === 'number' ? o.sold : 0,
          remaining: typeof o?.remaining === 'number' ? o.remaining : null,
        }))
      : undefined,
    // ORCH-1153 WS2: recurrence fields → the consumer rule-based open-daily
    // detector (the final seed the ConsumerExperienceDetailScreen reads).
    isRecurring: rec?.isRecurring === true,
    recurrenceRule:
      rec?.recurrenceRule !== null && typeof rec?.recurrenceRule === 'object'
        ? rec.recurrenceRule
        : null,
  } as unknown as BusinessEventCard;
}

function parseDistanceToKm(distanceStr: string): number | null {
  const match = distanceStr.match(/([\d.]+)\s*(km|mi|m)/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'km') return value;
  if (unit === 'mi') return value * 1.60934;
  if (unit === 'm') return value / 1000;
  return null;
}

// #1609 — IMAGE_SECTION_RATIO / DETAILS_SECTION_RATIO are DELETED, not retuned.
// They were the flex-axis key behind #1593: one `flex: 0.88` style applied to the
// poster photo box (one sibling -> 689.00pt) and the face hero hole (two siblings ->
// 667.67pt), whose 21.33pt disagreement bled through the white tray. The tray is gone
// and the hero is a full-bleed absolute fill in both trees, so there is no flex axis
// left to disagree about and no measurement to single-source.
const CARD_ANIMATION_DURATION = 400;

// ORCH-1042 / ORCH-1065 BUG-3: these two leaf constants moved to
// ./deckHeroConstants to break the SwipeableCards <-> CuratedExperienceSwipeCard
// require cycle. Re-exported here so any historical importer that read them off
// SwipeableCards keeps working (back-compat); the canonical source is the new
// module. expo-image accepts a constant blurhash natively — no new dependency.
export { CARD_FALLBACK_IMAGE, DECK_HERO_PLACEHOLDER_BLURHASH };

// ORCH-1042: fade-in once the photo decodes so the swap is never a hard black→photo
// cut. Within the spec's 180–300 ms band.
const DECK_HERO_TRANSITION_MS = 220;

/**
 * Card hero image with automatic fallback on load failure.
 *
 * ORCH-1042: renders via expo-image with a placeholder + fade transition +
 * `cachePolicy="memory-disk"` + `recyclingKey` so the per-card remount
 * (`key={currentRec.id}`, ORCH-0694) never flashes a bare dark panel during the
 * async decode window. The placeholder covers the decode gap; `CARD_FALLBACK_IMAGE`
 * is the hard-failure fallback (a real photo, distinct from the placeholder).
 */
const S1 = SURFACES.s1Single;

/** The behind face is `pointerEvents="none"`; its plate can never be pressed. */
const NOOP = (): void => {};

/**
 * #1609 Direction C §3.4 — the card's meta spans, in TRUNCATION-PRIORITY order.
 *
 *     ★ 4.4  ·  6.7 mi  ·  ££  ·  Whiskey Bar
 *     └700┘    └──── 500 @1.0 ────┘  └500 @0.72┘
 *
 * The rating leads because it is the only fact that ranks places against each
 * other; the category trails because tail-ellipsis eats the last span first and
 * it is the sacrificial one. Every span is omitted when its value is absent, and
 * the separators are rendered BETWEEN PRESENT SPANS ONLY by CardMetaLine — a
 * card with no rating begins at distance, with no orphaned leading "·"
 * (Constitution 9). When EVERY span is absent the plate drops to its shorter
 * alternate silhouette (`PLATE_H_NO_META`) — the FACTS ROW goes, the divider and
 * its chevron stay, because the chevron is the card's only visible expand
 * affordance (Seth, #1609 comment 5196932627).
 *
 * D-2 — TRAVEL TIME IS DROPPED from the collapsed card. "14 min" beside "6.7 mi"
 * is the same fact twice, and it is 8 characters in a line that has room for a
 * category instead. `I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME` is unaffected: it
 * governs what the edge functions must EMIT (both, dropping to null together),
 * not what the card must render, and its mobile clause is "branches on null to
 * hide the badge".
 */
function metaSpansForCard(
  card: { rating?: number | null; distance?: string | number | null; priceRange?: string | null; category?: string | null },
  measurementSystem: 'Metric' | 'Imperial' | undefined,
): MetaSpanInput[] {
  const spans: MetaSpanInput[] = [];
  if (card.rating != null && card.rating > 0) {
    spans.push({ kind: 'rating', text: `★ ${card.rating.toFixed(1)}` });
  }
  if (card.distance != null) {
    const d = parseAndFormatDistance(card.distance as any, measurementSystem);
    if (typeof d === 'string' && d.length > 0) spans.push({ kind: 'fact', text: d });
  }
  if (card.priceRange) spans.push({ kind: 'fact', text: card.priceRange });
  if (card.category) {
    const c = getReadableCategoryName(card.category);
    if (typeof c === 'string' && c.length > 0) spans.push({ kind: 'tail', text: c });
  }
  return spans;
}

/**
 * #1609 Amendment 1 — "I've been here" as a real control on the COLLAPSED card.
 *
 * Pillar 1 §1.6 specified a passive badge here, reasoning that an action which opens
 * a rating flow must never be reachable by an errant thumb during a swipe burst. Seth
 * overrode that. The override is implemented WITH the safety property preserved
 * rather than dropped:
 *
 *   - it never opens the rating flow; that stays on the expanded card. The tap only
 *     records or unrecords the visit, so a mis-tap costs a toggle, and one more tap
 *     undoes it.
 *   - 44pt target (touchTargets.minimum), inboard of BOTH card edges where a swipe
 *     begins, on the plate at the card's foot rather than in the drag zone.
 *   - it adds no gesture-handler gesture. This is a plain RN Pressable inside the
 *     existing card subtree, so it never contends for the deck's gesture lease
 *     (I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS).
 *   - state is NOT carried by colour alone: THREE independent channels move
 *     together — the glyph, the copy, and the fill category.
 *
 * Renders nothing while the visited query is pending — never a skeleton on the swipe
 * path — and nothing at all when signed out, because the visit cannot be recorded.
 *
 * ---------------------------------------------------------------------------
 * #1618 — THE SILENT 75-SECOND HANG. Two defects, both fixed here.
 *
 * The issue recorded the cause as "no timeout is set at all". That is wrong, and
 * knowing why matters for the fix. A 20-second cap DOES exist, on the Supabase
 * client's fetch (services/supabase.ts `fetchWithTimeout`). It did not fire
 * because the wait was UPSTREAM OF THE FETCH:
 *
 *     supabase.functions.invoke('record-visit')
 *       -> SupabaseClient.fetch  =  fetchWithAuth(key, _getAccessToken, fetchWithTimeout)
 *       -> await getAccessToken()            <-- the whole auth preamble runs HERE
 *            -> auth.getSession()
 *            -> _callRefreshToken -> _refreshAccessToken, which retries with
 *               exponential backoff for up to AUTO_REFRESH_TICK_DURATION_MS (30s),
 *               each attempt itself capped at 20s
 *       -> fetchWithTimeout(...)             <-- the 20s cap only starts NOW
 *
 * `fetchWithTimeout` is a PER-REQUEST cap, not a per-operation one, and every
 * token-refresh attempt gets its own fresh 20 seconds. So the 75 seconds is the
 * auth preamble's retry ladder plus the real request, and no single timer was
 * ever exceeded. The operation-level bound therefore has to live at the
 * operation, which is why visitService now wraps both mutations (see
 * `VISIT_WRITE_TIMEOUT_MS` there) rather than anything changing in supabase.ts.
 *
 * Defect 1 — NOTHING VISUAL BOUND TO `inFlight`. The `inFlight` / `disabled`
 * wiring already existed; the control simply looked identical while it worked.
 * Fixed by `showSpinner`: past BEEN_HERE.inFlightAfterMs (6s) a spinner replaces
 * the glyph. Below that threshold the press feedback alone is the signal —
 * flashing a spinner on a 300ms write is worse than none.
 *
 * Defect 2 — THE PRESS FELL THROUGH AND OPENED THE CARD. `disabled` on an RN
 * `Pressable` means it does not claim the touch, so while the write was in
 * flight a deliberate, accurate press on the control passed straight through to
 * the card's expand handler underneath. That is the exact accident the control's
 * placement was engineered to prevent, triggered by CORRECT use. Fixed by
 * keeping the Pressable ENABLED and making `onPress` a no-op while in flight:
 * the touch is consumed, and nothing opens.
 *
 * ---------------------------------------------------------------------------
 * #1687 — THE TAP NOW OPENS THE RATING PROMPT, AND WRITES NOTHING.
 *
 * This SUPERSEDES #1609 Amendment 1 ("it must not open a rating flow on the
 * collapsed card"), on Seth's decision of 2026-08-06 (issue #1687, comment
 * 5209318118). Amendment 1's destination — the rating strip in the expanded card,
 * #1605 pillar 4 — was never built, so "not here" ended up meaning "nowhere":
 * there was no way for any user to rate any place, ever, unless they had
 * scheduled it and let the time pass.
 *
 * THE SAFETY PROPERTY IS PRESERVED BY A DIFFERENT MECHANISM. Amendment 1's
 * argument was that an errant thumb mid-swipe must not cost more than a toggle.
 * It still does not: the prompt opens with a CLOSE ICON and writes nothing until
 * the user rates and submits, so a mis-tap costs one tap to dismiss and leaves
 * the database untouched. Under the old design a mis-tap wrote a `user_visits`
 * row and trained the recommender before the user could react.
 *
 * WHY THE WRITE MOVED. Recording on tap and deleting on cancel means two round
 * trips against a write whose cold path measures 11.8 seconds — the delete would
 * race an insert that has not landed. #1618, #1642 and #1661 are all that same
 * control. The visit is now recorded on CONFIRM, in one write, by the modal
 * (`services/placeReviewService.ts`), which is also the only actor that survives
 * the card being swiped away.
 *
 * This control keeps the REMOVE side (a settled tap still un-records, still
 * bounded, still surfaced) — it is the un-toggle, and #1686 is about making it
 * visible, which is why the settled body now carries a remove glyph.
 */
const BEEN_HERE_SPINNER_TICK_MS = 250;

const BeenHereControl = React.memo(function BeenHereControl({
  userId,
  card,
}: {
  userId: string | undefined;
  card: {
    id: string;
    title: string;
    category: string;
    image: string;
    priceRange?: string | null;
    address?: string;
    placeId?: string;
    // #1687 rework — the card's PROVENANCE, carried through so the request
    // builder never has to infer a place identity from the shape of an id. This
    // control renders on all four deck trees, and one of them (cardType
    // 'experience') carries an events.id.
    cardType?: string;
    placePoolId?: string;
  };
}) {
  const { t } = useTranslation();
  const { data: visited, isPending } = useHasVisited(userId, card.id);
  const removeVisit = useRemoveVisit();
  // #1687 — the confirmed-review signal. `confirmToken` moves ONLY on a confirm,
  // never on a cancel, so a cancelled tap produces no flash.
  const confirmedCardId = usePlaceReviewRequestStore((s) => s.confirmedCardId);
  const confirmToken = usePlaceReviewRequestStore((s) => s.confirmToken);

  const inFlight = removeVisit.isPending;
  // Constitution rule 3 — no silent failures. useVisits' own onError only
  // console.errors, so without this the user taps, nothing moves, and the control is a
  // dead tap. The RECORD side's failure is surfaced by the modal that owns it
  // (#1687) — it stays open on its rating step with the error, rather than
  // dismissing onto a control the user would have to interpret.
  const failed = removeVisit.isError;

  const [pressed, setPressed] = React.useState(false);
  // #1618 defect 1 — the write's elapsed time, so a slow write becomes VISIBLE.
  const startedAtRef = React.useRef<number | null>(null);
  const [slow, setSlow] = React.useState(false);
  // The 1400ms "Thank you" flash after a write resolves, before it settles.
  const [flashing, setFlashing] = React.useState(false);

  React.useEffect(() => {
    if (!inFlight) {
      startedAtRef.current = null;
      setSlow(false);
      return;
    }
    if (startedAtRef.current == null) startedAtRef.current = Date.now();
    const id = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt != null && Date.now() - startedAt >= BEEN_HERE.inFlightAfterMs) setSlow(true);
    }, BEEN_HERE_SPINNER_TICK_MS);
    return () => clearInterval(id);
  }, [inFlight]);

  const wasInFlight = React.useRef(false);
  React.useEffect(() => {
    // A write just resolved successfully -> flash, then settle.
    if (wasInFlight.current && !inFlight && !failed) {
      setFlashing(true);
      const id = setTimeout(() => setFlashing(false), BEEN_HERE.flashHoldMs);
      wasInFlight.current = inFlight;
      return () => clearTimeout(id);
    }
    wasInFlight.current = inFlight;
  }, [inFlight, failed]);

  // #1687 — the confirmed voluntary review flashes "Thank you" here too, so the
  // control still settles THROUGH the flash rather than snapping to settled. The
  // write happened in the modal, so there is no local in-flight edge to hang it
  // on. Seeded with the CURRENT token so a re-mount of an already-confirmed card
  // does not re-flash; only a token that MOVES fires.
  const seenConfirmTokenRef = React.useRef(confirmToken);
  React.useEffect(() => {
    if (confirmToken === seenConfirmTokenRef.current) return;
    seenConfirmTokenRef.current = confirmToken;
    if (confirmedCardId !== card.id) return;
    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), BEEN_HERE.flashHoldMs);
    return () => clearTimeout(id);
  }, [confirmToken, confirmedCardId, card.id]);

  // Signed out, or the visited state is not known yet: render nothing rather than a
  // control whose label would be a guess.
  if (!userId || isPending) return null;

  const isVisited = visited === true;

  const state: BeenHereVisualState = failed
    ? 'failed'
    : flashing
      ? 'flash'
      : isVisited
        ? 'settled'
        : pressed
          ? 'pressed'
          : 'rest';

  const label = failed
    ? t('cards:swipeable.been_here_failed')
    : flashing
      ? t('cards:swipeable.been_here_thanks')
      : isVisited
        ? t('cards:swipeable.been_here_settled')
        : t('cards:swipeable.been_here');

  const onPress = (): void => {
    // #1618 defect 2 — NOT `disabled`. A disabled RN Pressable does not claim the
    // touch, so the press fell through to the card and opened it. Consuming the
    // press and doing nothing is the whole fix.
    if (inFlight) return;
    HapticFeedback.light();
    if (failed) {
      // Constitution rule 3 — the failure offers a retry rather than dead-ending.
      removeVisit.reset();
    }
    if (isVisited) {
      removeVisit.mutate(card.id);
      return;
    }
    // #1687 — NOT a write. This opens the rating prompt on the single
    // PostExperienceModal instance in app/index.tsx; the visit is recorded there,
    // on confirm, together with the review. A cancelled tap leaves nothing.
    //
    // #1687 rework 3 — `visited` deliberately does NOT ride along any more.
    // Rework 2 sent it so a half-landed write could decide whether to delete the
    // visit; `useHasVisited` is cached for ten minutes, so that answer destroyed a
    // three-day-old visit on device. The confirm-time write no longer deletes
    // anything, so there is nothing here to authorise. `visited` still does its
    // real job two lines up: it is why an already-settled pill un-toggles instead
    // of opening this prompt at all.
    openPlaceReviewRequest(placeReviewRequestFromCard(card));
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.beenHere, beenHereStateStyle(state)]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: isVisited, busy: inFlight }}
      accessibilityLabel={
        failed
          ? t('cards:swipeable.been_here_failed')
          : isVisited
            ? t('cards:swipeable.been_here_on', { title: card.title })
            : t('cards:swipeable.been_here_off', { title: card.title })
      }
    >
      <BeenHereBody state={state} label={label} showSpinner={inFlight && slow} />
    </Pressable>
  );
});

const CardHeroImage = React.memo(function CardHeroImage({
  uri,
  style,
  decodeTarget,
}: {
  uri: string;
  style: any;
  decodeTarget: DeckHeroDecodeTarget;
}) {
  const [src, setSrc] = React.useState(uri && uri.length > 0 ? uri : CARD_FALLBACK_IMAGE);
  React.useEffect(() => {
    setSrc(uri && uri.length > 0 ? uri : CARD_FALLBACK_IMAGE);
  }, [uri]);
  const source = React.useMemo(
    () => ({ uri: src, width: decodeTarget.width, height: decodeTarget.height }),
    [decodeTarget.height, decodeTarget.width, src],
  );
  return (
    <ExpoImage
      source={source}
      style={style}
      contentFit="cover"
      cachePolicy={DECK_VISIBLE_POSTER_CACHE_POLICY}
      allowDownscaling
      enforceEarlyResizing={Platform.OS === 'ios'}
      recyclingKey={src}
      transition={DECK_HERO_TRANSITION_MS}
      placeholder={{ blurhash: DECK_HERO_PLACEHOLDER_BLURHASH }}
      placeholderContentFit="cover"
      onError={() => {
        if (src !== CARD_FALLBACK_IMAGE) setSrc(CARD_FALLBACK_IMAGE);
      }}
    />
  );
});

/**
 * ORCH-1069 — video-aware deck card hero.
 *
 * Decides per card whether it has a cover VIDEO (a `.mp4`/Cloudinary-video URL
 * detected in `images` via `firstVideoUrl`, mirroring the edge `isVideoUrl`):
 * The memoized DeckSwipeStage owns the stable current/behind poster resource.
 * This component therefore renders only the optional current-card video layer;
 * still-only cards return null so promotion cannot mount a second ExpoImage.
 *
 * Perf guard (I-1069-ONE-PLAYING-DECK-VIDEO, §5): only the TOP card plays.
 * `isTopCard` gates BOTH `autoplay` and `playbackActive`; the card behind mounts
 * the player paused on its poster (`playbackActive=false`), ready to play the
 * instant it promotes to top. Cards deeper than index 1 are never rendered by the
 * swipe stack, so at most two players exist and at most one plays. No video is
 * loaded only when mounted as the bounded current/behind poster.
 *
 * META-ORCH-0991 Bug 3a (LOCKED): the `EventCoverMedia` layer is wrapped in a
 * `pointerEvents="none"` View so the native VideoView never eats the card's
 * swipe/tap gesture. Without this, video-cover cards would be un-swipeable.
 */
function CardHero({
  images,
  title,
  isTopCard,
  style,
}: {
  image: string;
  images: string[];
  title: string;
  isTopCard: boolean;
  style: any;
  decodeTarget: DeckHeroDecodeTarget;
}) {
  const coverVideoUrl = firstVideoUrl(images);
  const hasVideoCover = coverVideoUrl !== null;

  if (!hasVideoCover) return null;

  return (
    <View style={style}>
      {/* Video layer — pointerEvents="none" so the card stays swipeable/tappable. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <EventCoverMedia
          mediaUrl={coverVideoUrl}
          mediaType="video"
          radius={0}
          label={title}
          videoContentFit="cover"
          autoplay={isTopCard}
          playbackActive={isTopCard}
          muted
          loop
          showAudioControl={false}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  );
}

// #1609 Direction C — `getTravelModeIcon` is DELETED here. It existed only to
// pick the icon for the travel-time chip, and travel time leaves the collapsed
// card with D-2: "14 min" beside "6.7 mi" is the same fact twice. The curated
// tree keeps its own copy for as long as it needs one.

interface StrollData {
  anchor: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address: string;
  };
  companionStops: Array<{
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address: string;
    rating?: number;
    reviewCount?: number;
    imageUrl?: string | null;
    placeId: string;
    type: string;
  }>;
  route: {
    duration: number;
    startLocation: { lat: number; lng: number };
    endLocation: { lat: number; lng: number };
  };
  timeline: Array<{
    step: number;
    type: string;
    title: string;
    location: any;
    description: string;
    duration: number;
  }>;
}

const getDefaultPreferences = (): UserPreferences => ({
  mode: "explore",
  people_count: 1,
  categories: ["nature", "drinks_and_music", "icebreakers"],
  travel_mode: "walking",
  travel_constraint_type: "time",
  travel_constraint_value: 30,
  datetime_pref: new Date().toISOString(),
  use_gps_location: true,
  intent_toggle: true,
  category_toggle: true,
  selected_dates: null,
});

// Recommendation interface is now imported from RecommendationsContext

interface SwipeableCardsProps {
  userPreferences?: any;
  currentMode?: string;
  /** ORCH-0635: coach-mark target ref for step 1 (Meet your deck). Attached to
   *  the cardContainer View so the cutout traces the actual card bounds. */
  coachDeckRef?: (node: View | null) => void;
  // ORCH-0532: authoritative session list from AppStateManager. MUST be passed
  // from app/index.tsx via HomePage so SwipeableCards reads session state from
  // the SAME source as AppHandlers, eliminating dual-source divergence (V2 §6).
  boardsSessions?: any[];
  onCardLike: (card: any) => Promise<boolean>;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  onOpenPreferences?: () => void;
  onOpenCollabPreferences?: () => void;
  /**
   * ORCH-1059: invoked by the collab deck ONLY after a successful "Notify the
   * group" post (a real banner row landed). The owning CollabDeckSheet uses this
   * to dismiss the deck (and any open prefs sub-sheet) and return the user to the
   * group chat, where the global success toast + posted banner are in context.
   * NOT called on debounce, cancel, or failure — the user stays put to retry.
   */
  onAfterNotify?: () => void;
  /**
   * ORCH-0918: sheet-embedded collab decks must scope to the chat session
   * even when the surrounding app mode points elsewhere.
   */
  sessionIdOverride?: string;
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string; // Key that changes to trigger refresh
  savedCards?: any[]; // Array of saved card IDs or card objects
}

// Real data will be fetched from Supabase

// #1609 Direction C — `getIconComponent` is DELETED. Its only consumer was the
// category GlassBadge on the card face, and the five chips are gone: the category
// is now the meta line's trailing 0.72 span, which carries no icon by design (the
// weighted spans create the register the icons used to, without five more nodes).

/** Shared pulsing-dots loading indicator */
function PulseDots({
  size = 8,
  speed = 600,
  reducedMotion = false,
}: {
  size?: number;
  speed?: number;
  reducedMotion?: boolean;
}) {
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    if (reducedMotion) {
      dots.forEach((dot) => dot.setValue(0.65));
      return () => dots.forEach((dot) => dot.setValue(0));
    }
    const stagger = Math.round(speed / 3);
    const halfSpeed = speed / 2;
    const handles: ReturnType<typeof setTimeout>[] = [];
    const anims: Animated.CompositeAnimation[] = [];

    dots.forEach((dot, i) => {
      const timeout = setTimeout(() => {
        const anim = Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: halfSpeed,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: halfSpeed,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        );
        anims.push(anim);
        anim.start();
      }, i * stagger);
      handles.push(timeout);
    });

    return () => {
      handles.forEach(clearTimeout);
      anims.forEach((a) => a.stop());
      dots.forEach((d) => d.setValue(0));
    };
  }, [dots, reducedMotion, speed]);

  return (
    <View style={pulseDotsStyles.container}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: '#eb7825',
            },
            {
              opacity: dot.interpolate({
                inputRange: [0, 1],
                outputRange: [0.35, 1],
              }),
              transform: [
                {
                  scale: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.4],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const pulseDotsStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});

/** Indeterminate progress bar for slow-load state */
function IndeterminateBar() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={indeterminateBarStyles.track}>
      <Animated.View
        style={[
          indeterminateBarStyles.fill,
          {
            width: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [24, 96],
            }),
          },
        ]}
      />
    </View>
  );
}

const indeterminateBarStyles = StyleSheet.create({
  track: {
    width: 120,
    height: 2,
    backgroundColor: '#ffedd5',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 8,
  },
  fill: {
    height: 2,
    backgroundColor: '#fb923c',
    borderRadius: 1,
  },
});

export default function SwipeableCards({
  userPreferences,
  currentMode = "solo",
  boardsSessions = [],
  onCardLike,
  accountPreferences,
  onAddToCalendar,
  onShareCard,
  onPurchaseComplete,
  removedCardIds = [],
  onResetCards,
  onOpenPreferences,
  onOpenCollabPreferences,
  onAfterNotify,
  sessionIdOverride,
  generateNewMockCard,
  onboardingData,
  refreshKey,
  savedCards = [],
  coachDeckRef,
}: SwipeableCardsProps) {
  const { t } = useTranslation(['cards', 'common']);
  // ORCH-1155 [public-brand-page]: navigate to the brand page from the
  // brand-experience card's badge (no dead tap).
  const router = useRouter();
  // ORCH-0589 v4 (V4): safe-area insets used to position the "View Previous" batchChip
  // below the floating top-bar chrome on the Swipe page (insets.top + ~62pt).
  const safeAreaInsets = useSafeAreaInsets();
  // Use recommendations from context

  const {
    recommendations,
    loading,
    isFetching,
    error,
    userLocation,
    isModeTransitioning,
    isWaitingForSessionResolution,
    isRefreshingAfterPrefChange,
    hasCompletedInitialFetch,
    refreshRecommendations,
    handleDeckCardProgress,
    hasMoreCards,
    dismissedCards,
    addDismissedCard,
    removeDismissedCard,
    addCardToFront,
    isExhausted,
    deckUIState,
    collabTravelMode,
    // ORCH-0474: pipeline-error toast overlay on LOADED + serverPath for
    // analytics dimension + retry routing in the new UI states.
    showPipelineErrorToast,
    serverPath,
    collabDeckDeadEndReason,
    // ORCH-1113 [curated-experience-empty-deck-regression]: solo+collab curated
    // empty verdict, used to branch the empty-state copy for 'all_closed_at_time'.
    curatedEmptyReason,
    collabDeadEndPayload,
    // ORCH-0490 Phase 2.3: expansion signal. True when a deck swap is a
    // same-context pref-change expansion (new cards streaming into the same
    // mode+session), so the wipe below is suppressed even when new IDs are
    // not a strict superset of previous. Undefined when flag-off — wipe uses
    // legacy first-5-IDs comparison.
    isDeckExpandingWithinContext,
    // ORCH-0490 Phase 2.3 rework (AH-138): registry + active context for
    // per-context swipe-state preservation (SC-2.3-01). Null/undefined
    // under flag-off — SwipeableCards falls through to legacy AsyncStorage.
    deckStateRegistry,
    activeDeckContext,
  } = useRecommendations();
  const sessionSwipedCards = useDeckSessionHistoryStore((state) => state.cards);

  useEffect(() => {
    void hydrateDeckSessionHistory();
    return () => {
      void flushDeckSessionHistory();
    };
  }, []);

  const isAnyLoading = loading || isModeTransitioning || isWaitingForSessionResolution;

  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  // #1609 — the hero is now full-bleed, so the pre-onLayout decode seed is the whole
  // card box rather than 88% of it. This state feeds getDeckHeroDecodeTarget ONLY; it
  // is never a layout input (see below).
  const [heroLayout, setHeroLayout] = useState({
    width: Math.max(1, Math.min(SCREEN_WIDTH, 500)),
    height: Math.max(1, SCREEN_HEIGHT - 280),
  });

  // Card content entrance animation values
  const cardContentOpacity = useRef(new Animated.Value(0)).current;
  const matchBadgeSlide = useRef(new Animated.Value(-20)).current;
  const titleOverlaySlide = useRef(new Animated.Value(30)).current;

  const hasRestoredStateRef = useRef(false);
  const previousRefreshKeyRef = useRef<number | string | undefined>(refreshKey);
  const previousModeRef = useRef<string>(currentMode);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] =
    useState<ExpandedCardData | null>(null);
  // ORCH-1065: brand experiences expand to the business-event sheet (NOT the
  // curated itinerary). Parallel state keeps them a first-class branch.
  const [expandedBrandExperience, setExpandedBrandExperience] =
    useState<BusinessEventCard | null>(null);
  const [showNextBatchLoader, setShowNextBatchLoader] = useState(false);
  const [dismissedSheetVisible, setDismissedSheetVisible] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  // ORCH-1064: true ONLY when the expanded card was opened from swipe-history
  // review. Gates the prev/next review chrome so it never appears on a normal
  // deck tap (reviewCards is the whole session-swiped list, so it is non-empty
  // after any swipe — it cannot be used alone to detect review mode).
  const [isReviewMode, setIsReviewMode] = useState(false);
  // ORCH-1064: timestamp of the last expanded-card close. Used to block a
  // re-open within ~500ms so the wrapInRNModal RN <Modal> is never re-presented
  // while the prior dismissal is still in flight on iOS (the intermittent
  // release-build present-during-dismiss freeze on rapid open/close).
  const lastModalCloseAtRef = useRef(0);

  const previousBatchRefreshKeyRef = useRef<number | string | undefined>(
    refreshKey
  );

  // ORCH-0532: currentSession + isInSolo retained for tier-inheritance logic
  // (creatorId, isInCollab). availableSessions and sessionsLoading dropped —
  // resolvedSessionId now derives from boardsSessions prop (AppStateManager)
  // instead, eliminating the dual-source-of-truth race documented in V2 §6.
  const {
    currentSession,
    isInSolo,
  } = useSessionManagement();
  const user = useAppStore((state) => state.user);
  const { data: cachedPreferences } = useUserPreferences(user?.id);
  const { data: calendarEntries } = useCalendarEntries(user?.id);
  // In collaboration mode, use the group's aggregated travel mode (majority vote).
  // In solo mode, fall back to the user's own cached preferences.
  const effectiveTravelMode = collabTravelMode ?? cachedPreferences?.travel_mode ?? userPreferences?.travelMode;
  const [reverseGeocodedAddress, setReverseGeocodedAddress] = useState<string | null>(null);

  // Feature gating hooks
  const { canAccess: userCanAccess } = useFeatureGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('curated_cards');

  // Collab tier inheritance: when in a session, use the creator's tier for gating
  const creatorId = !isInSolo ? (currentSession as any)?.created_by ?? null : null;
  const creatorTier = useCreatorTier(creatorId ?? undefined);
  const creatorLimits = creatorId ? getTierLimits(creatorTier) : null;
  const isInCollab = !isInSolo && !!currentSession;

  // Effective gate: in collab mode, inherit creator's tier; in solo, use user's own
  const canAccess = useCallback(
    (feature: GatedFeature): boolean => {
      if (isInCollab && creatorLimits) {
        switch (feature) {
          case 'curated_cards': return creatorLimits.curatedCardsAccess;
          default: return userCanAccess(feature);
        }
      }
      return userCanAccess(feature);
    },
    [isInCollab, creatorLimits, userCanAccess],
  );
  // Gesture boundary callbacks read this ref so the controller never closes
  // over stale entitlement state.
  const canAccessRef = useRef(canAccess);
  useEffect(() => { canAccessRef.current = canAccess; });

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    }).catch((error) => {
      console.error('[SwipeableCards] Reduce Motion read failed:', error);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Storage keys for persisting card state
  const getStorageKeys = useCallback(() => {
    const baseKey = `mingla_card_state_${currentMode}_${refreshKey || 0}`;
    return {
      index: `${baseKey}_index`,
      removedCards: `${baseKey}_removed`,
    };
  }, [currentMode, refreshKey]);

  // Reverse geocode user location for "no matches" display
  useEffect(() => {
    if (!userLocation) return;
    let cancelled = false;
    const fetchAddress = async () => {
      try {
        const { addresses } = await throttledReverseGeocode(
          userLocation.lat,
          userLocation.lng
        );
        if (cancelled) return;
        if (addresses?.[0]) {
          const r = addresses[0];
          const parts = [r.streetNumber, r.street, r.city].filter(Boolean);
          if (parts.length > 0) {
            setReverseGeocodedAddress(parts.join(" "));
          }
        }
      } catch {
        // Silently fail — will show coordinates as fallback
      }
    };
    fetchAddress();
    return () => { cancelled = true; };
  }, [userLocation?.lat, userLocation?.lng]);

  // ORCH-0532 (2026-04-19): resolvedSessionId MUST read from AppStateManager's
  // `boardsSessions` (prop) — the SAME authoritative source used by
  // AppHandlers.handleSaveCard via stateRef. Do NOT re-introduce a dependency
  // on useSessionManagement.availableSessions here — that hook's state can lag
  // behind AppStateManager's, producing dual-source divergence bugs (see V2
  // report §6 CF-1..CF-8 for the 8 ways that divergence fires).
  //
  // Resolution logic matches AppHandlers.tsx:687-699 verbatim (creator joined
  // via session.id, invitee via session.name, legacy rows via session_id field).
  //
  // currentMode can be: "solo", a session name, or a session ID.
  const resolvedSessionId = React.useMemo(() => {
    if (sessionIdOverride) return sessionIdOverride;
    if (currentMode === "solo") return null;
    const session = (boardsSessions || []).find(
      (s: any) =>
        s.id === currentMode ||
        s.name === currentMode ||
        (s as any).session_id === currentMode
    );
    return session
      ? ((session as any).session_id || session.id || null)
      : null;
  }, [currentMode, boardsSessions, sessionIdOverride]);

  // isWaitingForSessionResolution is now provided by RecommendationsContext

  // Check if we're in a board/collab session.
  // ORCH-0532: resolvedSessionId is now derived from boardsSessions (prop from
  // AppStateManager) — NOT from useSessionManagement's availableSessions. This
  // matches the source that AppHandlers uses, eliminating the dual-source race
  // that caused the quorum-bypass bug.
  const isBoardSession =
    currentMode !== "solo" && !!resolvedSessionId;

  // Load board preferences if in board session
  // Use hook unconditionally (React rules) but pass undefined when not in board session
  const boardSessionResult = useBoardSession(
    isBoardSession && resolvedSessionId ? resolvedSessionId : undefined
  );
  const boardPreferences = boardSessionResult?.preferences || null;
  const collabParticipants = Array.isArray((boardSessionResult?.session as any)?.participants)
    ? (boardSessionResult?.session as any).participants
    : [];
  const allParticipantPrefs =
    (boardSessionResult?.session as any)?.participant_prefs ??
    boardSessionResult?.allParticipantPreferences ??
    null;
  const myParticipantPrefs =
    user?.id && (boardSessionResult?.session as any)?.participant_prefs
      ? (boardSessionResult.session as any).participant_prefs[user.id]
      : null;

  // ORCH-0902 CR-6: visible-but-not-binding dismissed sheet — server-sourced
  // list of left-swipes by ANY participant in this session, attributed by
  // name. Hook is enabled only in collab mode (sessionId truthy). Returns []
  // for solo. Realtime subscription piggybacks on the existing
  // board_session:{sessionId} channel via onSwipeRecorded.
  const collabDismissedRows = useSessionDismissedCards(
    isBoardSession && resolvedSessionId ? resolvedSessionId : null,
    user?.id ?? null,
  );

  // Fresh deck refs used only at gesture state boundaries.
  const recommendationsRef = useRef<Recommendation[]>([]);
  const removedCardsRef = useRef<Set<string>>(new Set());
  const currentCardIndexRef = useRef(0);
  const previousBatchIdsRef = useRef<string>('');
  // ORCH-0490 Phase 2.3: full-set version of previousBatchIdsRef. Used by the
  // expansion signal under FEATURE_FLAG_PER_CONTEXT_DECK_STATE. Flag-off
  // continues to use previousBatchIdsRef (first-5-IDs compare).
  const previousCardIdsSetRef = useRef<Set<string>>(new Set());

  // ORCH-0490 Phase 2.3 rework (AH-138): per-context swipe state bridge.
  // - activeDeckContextKey: stable string key for the current context.
  // - prevDeckContextKeyRef: last context we restored for. Drives the
  //   restore effect to fire on genuine context changes only.
  // - lastSavedContextKeyRef: last context we saved-to. Guards the save
  //   effect from firing on the first render after a context change, where
  //   removedCards closure is still the PREVIOUS context's value while
  //   activeDeckContext already points to the new context (would corrupt
  //   the new context's registry entry with stale data).
  const activeDeckContextKey = activeDeckContext
    ? deckContextKey(activeDeckContext)
    : null;
  const prevDeckContextKeyRef = useRef<string | null>(activeDeckContextKey);
  const lastSavedContextKeyRef = useRef<string | null>(null);
  // ORCH-0490 Phase 2.3 rework (AH-138): separate context-key ref for the
  // expansion effect. The RESTORE effect fires at the render where
  // activeDeckContextKey changes but `recommendations` is still the PREVIOUS
  // context's cards. If the expansion effect ran its full diff on that same
  // render, it would lock in wrong-context IDs into previousCardIdsSetRef,
  // and the NEXT render (when new-context recommendations arrive) would see
  // non-superset and wipe. This ref lets expansion detect the context change
  // and early-return without updating previousCardIdsSetRef — preserving
  // RESTORE's `Set()` reset so the next render hits the INIT branch.
  const expansionPrevContextKeyRef = useRef<string | null>(activeDeckContextKey);
  const handleSwipeRef = useRef<((direction: "left" | "right", card: Recommendation) => Promise<void>) | null>(null);
  const handleCardExpandRef = useRef<(() => Promise<void>) | null>(null);
  const removedCardIdsRef = useRef<string[]>(removedCardIds);
  const pendingPaywallRef = useRef<DeckSwipeCommitToken | null>(null);
  const latestValidatedSwipeEpochRef = useRef(0);
  const lastCommittedTokenKeyRef = useRef<string | null>(null);
  const promotedCardIdRef = useRef<string | null>(null);
  const deckStageRef = useRef<DeckSwipeStageHandle | null>(null);
  const pendingAccessibilityFocusRef = useRef(false);
  const cardAccessibilityRef = useRef<View | null>(null);
  const anomalyReasonsRef = useRef(new Set<string>());
  const swipeQueueEpochRef = useRef(0);
  const postSwipeQueueRef = useRef<{
    epoch: number;
    run: () => Promise<void>;
  }[]>([]);
  const postSwipeDrainRunningRef = useRef(false);
  const postSwipeScheduleRef = useRef<{
    interaction: ReturnType<typeof InteractionManager.runAfterInteractions> | null;
    timeout: ReturnType<typeof setTimeout> | null;
  }>({ interaction: null, timeout: null });
  const persistenceGenerationRef = useRef(0);
  const lastEnqueuedPersistenceSignatureRef = useRef('');
  const pendingPersistenceRef = useRef<{
    contextKey: string;
    indexKey: string;
    removedKey: string;
    index: number;
    removedCardIds: string[];
    generation: number;
  } | null>(null);
  const persistenceDrainRef = useRef<Promise<void> | null>(null);
  const localDeckInteractionPhaseRef = useRef<DeckSwipePhase>('IDLE');
  const lastDeckInteractionAtRef = useRef(0);
  const persistenceQuietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistenceInteractionHandleRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const postSwipeUserIdRef = useRef<string | undefined>(user?.id);

  useEffect(() => {
    pendingPaywallRef.current = null;
  }, [activeDeckContextKey, currentMode, refreshKey, user?.id]);

  // Update refs when state changes
  useEffect(() => {
    recommendationsRef.current = recommendations;
    removedCardsRef.current = removedCards;
    currentCardIndexRef.current = currentCardIndex;
    removedCardIdsRef.current = removedCardIds;
  }, [recommendations, removedCards, currentCardIndex, removedCardIds]);

  // Filter out removed cards (needed for shouldShowLoader calculation)
  // Note: removedCards is a state variable, so we need to use it carefully
  const availableRecommendations = React.useMemo(
    () =>
      (recommendations || []).filter(
        (rec) => !removedCards.has(rec.id) && !removedCardIds.includes(rec.id)
      ),
    [recommendations, removedCards, removedCardIds]
  );

  // Combine all conditions that should show a loader
  const shouldShowLoader =
    isAnyLoading ||
    (!hasCompletedInitialFetch && availableRecommendations.length === 0);

  // ── Effective UI State: refines context-level deckUIState with local card availability ──
  // Context computes deckUIState from recommendations array, but SwipeableCards filters
  // out removedCards locally. effectiveUIState accounts for that local filtering.
  const effectiveUIState: DeckUIState = React.useMemo(() => {
    if (deckUIState.type === 'LOADED' && availableRecommendations.length === 0) {
      if (isBoardSession && !collabDeckDeadEndReason) {
        return { type: 'INITIAL_LOADING' };
      }
      // ORCH-0469 / ORCH-0472: If context reports LOADED, recommendations.length > 0
      // (see RecommendationsContext.tsx:1218). When every served card is in
      // removedCards, the user has swiped through everything they were served — that
      // IS exhaustion, regardless of the context-level isExhausted flag (which only
      // fires on server-side empty responses / pagination-exhaustion, not on local
      // swipe-through of a single-batch pool). The dead-state auto-recovery at
      // ~line 651 handles stale-persistence removedCards pollution; it clears after
      // 1.5s, so genuine EXHAUSTED persists past that window. Genuine EMPTY (server
      // returned zero for the filter) never enters this branch because
      // deckUIState.type is 'EMPTY' not 'LOADED' — see context line 1204.
      return { type: 'EXHAUSTED' };
    }
    return deckUIState;
  }, [deckUIState, availableRecommendations.length, isBoardSession, collabDeckDeadEndReason]);

  // Auto-recovery: detect dead "Pulling up more for you" state.
  // When recommendations exist but ALL are filtered by removedCards (stale persistence),
  // clear removedCards after 1.5s to escape the dead state. This is a safety net — the
  // primary fix is in the AsyncStorage restore (filtering stale IDs) and useDeckCards
  // (matching initialData on categories, not just batchSeed). But if those fail, this
  // prevents the user from being permanently stuck.
  //
  // IMPORTANT: Do NOT fire when removedCards >= recommendations — that means the user
  // legitimately swiped every card. That's exhaustion, not a dead state.
  useEffect(() => {
    if (
      availableRecommendations.length === 0 &&
      recommendations.length > 0 &&
      removedCards.size > 0 &&
      removedCards.size < recommendations.length && // User hasn't swiped all — this is stale data
      hasCompletedInitialFetch &&
      !isExhausted &&
      !loading &&
      !isModeTransitioning &&
      !isWaitingForSessionResolution
    ) {
      const recoveryTimer = setTimeout(() => {
        if (__DEV__) {
          console.warn(
            '[SwipeableCards] Dead state detected — clearing removedCards to recover',
            { recommendations: recommendations.length, removed: removedCards.size }
          );
        }
        setRemovedCards(new Set());
        setCurrentCardIndex(0);
      }, 1500);
      return () => clearTimeout(recoveryTimer);
    }
  }, [
    availableRecommendations.length, recommendations.length, removedCards.size,
    hasCompletedInitialFetch, isExhausted, loading, isModeTransitioning,
    isWaitingForSessionResolution,
  ]);

  useEffect(() => {
    if (
      previousBatchRefreshKeyRef.current !== undefined &&
      previousBatchRefreshKeyRef.current !== refreshKey
    ) {
      setShowNextBatchLoader(true);
    }

    previousBatchRefreshKeyRef.current = refreshKey;
  }, [refreshKey]);

  useEffect(() => {
    if (!showNextBatchLoader) return;

    if (
      !isFetching &&
      !isRefreshingAfterPrefChange &&
      !isModeTransitioning &&
      !isWaitingForSessionResolution
    ) {
      const hideTimer = setTimeout(() => setShowNextBatchLoader(false), 220);
      return () => clearTimeout(hideTimer);
    }
  }, [
    showNextBatchLoader,
    isFetching,
    isRefreshingAfterPrefChange,
    isModeTransitioning,
    isWaitingForSessionResolution,
  ]);

  // Fade-in animation for primary loader
  const loaderFadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (shouldShowLoader) {
      loaderFadeIn.setValue(0);
      const anim = Animated.timing(loaderFadeIn, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      });
      anim.start();
      return () => anim.stop();
    }
  }, [shouldShowLoader]);

  // Location and fetching are now handled by RecommendationsContext

  // Always use currentCardIndex to track position in the deck
  const currentRec = availableRecommendations[currentCardIndex];
  const nextRec = availableRecommendations.find((rec) => rec.id !== currentRec?.id) ?? null;
  const isCurrentCardSaved = currentRec ? savedCards.some(
    (s: any) => s?.id === currentRec.id || s === currentRec.id
  ) : false;
  const isCurrentCardScheduled = currentRec ? (calendarEntries ?? []).some(
    (e) => (e.status === 'pending' || e.status === 'confirmed') && e.card_id === currentRec.id
  ) : false;

  const reportDeckAnomaly = useCallback((
    reason: string,
    phase: string,
    durationMs: number,
  ): void => {
    if (anomalyReasonsRef.current.has(reason)) return;
    anomalyReasonsRef.current.add(reason);
    const card = recommendationsRef.current
      .filter((rec) => !removedCardsRef.current.has(rec.id))[
        currentCardIndexRef.current
      ];
    const cardType = (card as { cardType?: unknown } | undefined)?.cardType;
    postHogService.capture('deck_swipe_lifecycle_anomaly', {
      platform: Platform.OS,
      phase,
      reason,
      duration_bucket:
        durationMs <= 250 ? 'lte_250' : durationMs <= 400 ? '251_400' : 'gt_400',
      reduced_motion: reducedMotion,
      card_type:
        cardType === 'curated' || cardType === 'experience' ? cardType : 'place',
      deck_mode: currentMode === 'solo' ? 'solo' : 'collab',
    });
  }, [currentMode, reducedMotion]);

  const cancelPostSwipeSchedule = useCallback((): void => {
    postSwipeScheduleRef.current.interaction?.cancel();
    if (postSwipeScheduleRef.current.timeout) {
      clearTimeout(postSwipeScheduleRef.current.timeout);
    }
    postSwipeScheduleRef.current = { interaction: null, timeout: null };
  }, []);

  const drainPostSwipeQueue = useCallback(async (force = false): Promise<void> => {
    const isQuietIdle = (): boolean => localDeckInteractionPhaseRef.current === 'IDLE' &&
      Date.now() - lastDeckInteractionAtRef.current >= DECK_POST_SWIPE_QUIET_IDLE_MS;
    if (!force && !isQuietIdle()) return;
    if (postSwipeDrainRunningRef.current) return;
    postSwipeDrainRunningRef.current = true;
    cancelPostSwipeSchedule();
    try {
      while (postSwipeQueueRef.current.length > 0) {
        if (!force && !isQuietIdle()) break;
        if (force && localDeckInteractionPhaseRef.current !== 'IDLE') break;
        const item = postSwipeQueueRef.current.shift();
        if (!item || item.epoch !== swipeQueueEpochRef.current) continue;
        try {
          await item.run();
        } catch (error) {
          console.error('[SwipeableCards] Deferred post-swipe work failed:', error);
        }
        // A large completed deck can enqueue dozens of saves, analytics calls,
        // cache invalidations, and toasts. Yield a macrotask between exact FIFO
        // items so a newly started deck can admit/finalize its native gestures.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (localDeckInteractionPhaseRef.current !== 'IDLE') break;
        // Foreground work is intentionally one item per quiet window. Starting
        // a second item here can starve the runOnJS boundary of the next deck.
        if (!force) break;
      }
    } finally {
      postSwipeDrainRunningRef.current = false;
    }
  }, [cancelPostSwipeSchedule]);

  const scheduleQuietPostSwipeDrain = useCallback((): void => {
    if (postSwipeQueueRef.current.length === 0 || localDeckInteractionPhaseRef.current !== 'IDLE') {
      return;
    }
    cancelPostSwipeSchedule();
    const quietForMs = Date.now() - lastDeckInteractionAtRef.current;
    const remainingMs = Math.max(0, DECK_POST_SWIPE_QUIET_IDLE_MS - quietForMs);
    postSwipeScheduleRef.current.timeout = setTimeout(() => {
      postSwipeScheduleRef.current.timeout = null;
      if (localDeckInteractionPhaseRef.current !== 'IDLE') return;
      postSwipeScheduleRef.current.interaction = InteractionManager.runAfterInteractions(() => {
        postSwipeScheduleRef.current.interaction = null;
        void drainPostSwipeQueue().finally(() => {
          if (
            postSwipeQueueRef.current.length > 0 &&
            localDeckInteractionPhaseRef.current === 'IDLE'
          ) scheduleQuietPostSwipeDrain();
        });
      });
    }, remainingMs);
  }, [cancelPostSwipeSchedule, drainPostSwipeQueue]);

  const enqueuePostSwipeWork = useCallback((run: () => Promise<void>): void => {
    postSwipeQueueRef.current.push({
      epoch: swipeQueueEpochRef.current,
      run,
    });
    scheduleQuietPostSwipeDrain();
  }, [scheduleQuietPostSwipeDrain]);

  const drainPersistence = useCallback((force = false): Promise<void> => {
    const isQuietIdle = (): boolean => localDeckInteractionPhaseRef.current === 'IDLE' &&
      Date.now() - lastDeckInteractionAtRef.current >= DECK_PERSISTENCE_QUIET_IDLE_MS;
    if (!force && !isQuietIdle()) return Promise.resolve();
    if (persistenceDrainRef.current) return persistenceDrainRef.current;
    const drain = async (): Promise<void> => {
      while (pendingPersistenceRef.current) {
        if (!force && !isQuietIdle()) break;
        const snapshot = pendingPersistenceRef.current;
        pendingPersistenceRef.current = null;
        try {
          await AsyncStorage.multiSet([
            [snapshot.indexKey, snapshot.index.toString()],
            [snapshot.removedKey, JSON.stringify(snapshot.removedCardIds)],
          ]);
        } catch (error) {
          console.error('[SwipeableCards] Deck state persistence failed:', error);
          reportDeckAnomaly('persistence_failure', 'COMMITTING', 0);
        }
      }
    };
    persistenceDrainRef.current = drain().finally(() => {
      persistenceDrainRef.current = null;
    });
    return persistenceDrainRef.current;
  }, [reportDeckAnomaly]);

  const scheduleQuietPersistenceDrain = useCallback((): void => {
    if (!pendingPersistenceRef.current || localDeckInteractionPhaseRef.current !== 'IDLE') return;
    if (persistenceQuietTimerRef.current) clearTimeout(persistenceQuietTimerRef.current);
    persistenceInteractionHandleRef.current?.cancel();
    persistenceInteractionHandleRef.current = null;
    const quietForMs = Date.now() - lastDeckInteractionAtRef.current;
    const remainingMs = Math.max(0, DECK_PERSISTENCE_QUIET_IDLE_MS - quietForMs);
    persistenceQuietTimerRef.current = setTimeout(() => {
      persistenceQuietTimerRef.current = null;
      persistenceInteractionHandleRef.current = InteractionManager.runAfterInteractions(() => {
        persistenceInteractionHandleRef.current = null;
        void drainPersistence();
      });
    }, remainingMs);
  }, [drainPersistence]);

  const enqueuePersistenceSnapshot = useCallback((
    index: number,
    nextRemovedCards: Set<string>,
  ): void => {
    if (!hasRestoredStateRef.current || !recommendationsRef.current.length) return;
    const keys = getStorageKeys();
    const removedCardIds = Array.from(nextRemovedCards);
    const signature = `${keys.index}:${index}:${removedCardIds.join(',')}`;
    if (signature === lastEnqueuedPersistenceSignatureRef.current) return;
    lastEnqueuedPersistenceSignatureRef.current = signature;
    persistenceGenerationRef.current += 1;
    pendingPersistenceRef.current = {
      contextKey: activeDeckContextKey ?? `${currentMode}:${String(refreshKey ?? 0)}`,
      indexKey: keys.index,
      removedKey: keys.removedCards,
      index,
      removedCardIds,
      generation: persistenceGenerationRef.current,
    };
    scheduleQuietPersistenceDrain();
  }, [activeDeckContextKey, currentMode, getStorageKeys, refreshKey, scheduleQuietPersistenceDrain]);

  useEffect(() => {
    if (postSwipeUserIdRef.current !== user?.id) {
      swipeQueueEpochRef.current += 1;
      postSwipeQueueRef.current = [];
      cancelPostSwipeSchedule();
      postSwipeUserIdRef.current = user?.id;
    }
  }, [cancelPostSwipeSchedule, user?.id]);

  useEffect(() => () => {
    cancelPostSwipeSchedule();
    void drainPostSwipeQueue(true);
  }, [cancelPostSwipeSchedule, drainPostSwipeQueue]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        void drainPostSwipeQueue(true);
        void drainPersistence(true);
      }
    });
    return () => {
      subscription.remove();
      void drainPersistence(true);
    };
  }, [drainPersistence, drainPostSwipeQueue]);

  useEffect(() => () => {
    if (persistenceQuietTimerRef.current) clearTimeout(persistenceQuietTimerRef.current);
    persistenceInteractionHandleRef.current?.cancel();
  }, []);

  const deckSwipeStageOptions: UseDeckSwipeControllerOptions = {
    activeCardId: currentRec?.id ?? null,
    screenWidth: SCREEN_WIDTH,
    reducedMotion,
    onSwipeValidated: (token: DeckSwipeCommitToken): boolean => {
      if (
        pendingPaywallRef.current &&
        pendingPaywallRef.current.epoch !== token.epoch
      ) {
        pendingPaywallRef.current = null;
      }
      const availableCards = recommendationsRef.current.filter(
        (rec) =>
          !removedCardsRef.current.has(rec.id) &&
          !removedCardIdsRef.current.includes(rec.id),
      );
      const card = availableCards[currentCardIndexRef.current];
      if (
        !card ||
        card.id !== token.cardId ||
        token.epoch <= latestValidatedSwipeEpochRef.current
      ) return false;
      if (
        token.direction === 'right' &&
        (card as { cardType?: unknown }).cardType === 'curated' &&
        !canAccessRef.current('curated_cards')
      ) {
        pendingPaywallRef.current = token;
        HapticFeedback.medium();
        return false;
      }
      latestValidatedSwipeEpochRef.current = token.epoch;
      if (token.direction === 'right') HapticFeedback.cardLike();
      else HapticFeedback.cardDislike();
      return true;
    },
    onSwipeRejectedCentered: (token: DeckSwipeCommitToken): void => {
      const intent = consumeDeckTokenIntent(pendingPaywallRef.current, token);
      pendingPaywallRef.current = intent.pending;
      if (!intent.shouldRun) return;
      setPaywallFeature('curated_cards');
      setShowPaywall(true);
    },
    onCommitRequested: (token: DeckSwipeCommitToken): DeckCommitSettlement | null => {
      const tokenKey = `${token.epoch}:${token.cardId}:${token.direction}`;
      if (
        token.epoch !== latestValidatedSwipeEpochRef.current ||
        lastCommittedTokenKeyRef.current === tokenKey
      ) {
        reportDeckAnomaly('duplicate_commit_blocked', 'COMMITTING', 0);
        return null;
      }
      const availableCards = recommendationsRef.current.filter(
        (rec) =>
          !removedCardsRef.current.has(rec.id) &&
          !removedCardIdsRef.current.includes(rec.id),
      );
      const card = availableCards[currentCardIndexRef.current];
      if (!card || card.id !== token.cardId) {
        reportDeckAnomaly('stale_completion_ignored', 'COMMITTING', 0);
        return null;
      }
      lastCommittedTokenKeyRef.current = tokenKey;
      // Exact full-card history is visible synchronously in the same local
      // commit batch as promotion; only its serialization/I/O is deferred.
      appendDeckSessionHistory(card);
      const nextRemoved = new Set(removedCardsRef.current);
      nextRemoved.add(card.id);
      removedCardsRef.current = nextRemoved;
      currentCardIndexRef.current = 0;
      const nextCardId = availableCards[1]?.id ?? null;
      if (nextCardId) promotedCardIdRef.current = nextCardId;
      enqueuePersistenceSnapshot(0, nextRemoved);
      enqueuePostSwipeWork(async () => {
        await handleSwipeRef.current?.(token.direction, card);
      });
      setRemovedCards(nextRemoved);
      setCurrentCardIndex(0);
      return nextCardId ? { nextCardId } : { exhausted: true };
    },
    onCommitSettled: (_token: DeckSwipeCommitToken, settlement: DeckCommitSettlement): void => {
      if ('exhausted' in settlement) {
        scheduleQuietPostSwipeDrain();
        void flushDeckSessionHistory();
        void drainPersistence(true);
      }
    },
    onPhaseChanged: (phase): void => {
      localDeckInteractionPhaseRef.current = phase;
      lastDeckInteractionAtRef.current = Date.now();
      setDeckSessionHistoryInteractionPhase(phase);
      if (phase === 'IDLE') {
        scheduleQuietPostSwipeDrain();
        scheduleQuietPersistenceDrain();
      } else {
        cancelPostSwipeSchedule();
        if (persistenceQuietTimerRef.current) clearTimeout(persistenceQuietTimerRef.current);
        persistenceQuietTimerRef.current = null;
        persistenceInteractionHandleRef.current?.cancel();
        persistenceInteractionHandleRef.current = null;
      }
    },
    onExpandValidated: (): boolean => {
      if (!currentRec) return false;
      HapticFeedback.medium();
      return true;
    },
    onExpandRequested: (): void => {
      void handleCardExpandRef.current?.();
    },
    onTransitionRejected: (): void => {
      // The uninterrupted native transition is the truthful feedback. Rejected
      // touches intentionally produce no haptic, state mutation, or telemetry.
    },
    onAnomaly: ({ reason, phase: anomalyPhase, durationMs }): void => {
      reportDeckAnomaly(reason, anomalyPhase, durationMs);
    },
    onInvalidated: (): void => {
      pendingPaywallRef.current = null;
    },
  };
  const invalidateDeckSwipe = useCallback((reason: string): void => {
    deckStageRef.current?.invalidate(reason);
  }, []);

  const heroDecodeTarget = useMemo(
    () => getDeckHeroDecodeTarget(heroLayout.width, heroLayout.height, PixelRatio.get()),
    [heroLayout.height, heroLayout.width],
  );

  // Track card viewed when the current card changes
  const lastViewedCardIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentRec && currentRec.id !== lastViewedCardIdRef.current) {
      lastViewedCardIdRef.current = currentRec.id;
      const view = {
        card_id: currentRec.id,
        card_title: currentRec.title,
        category: currentRec.category,
        position_in_deck: currentCardIndex,
        is_curated: (currentRec as any).cardType === 'curated',
      };
      const trackCardViewed = async (): Promise<void> => {
        mixpanelService.trackCardViewed(view);
        // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
        postHogService.capture("card_viewed", view);
      };
      if (promotedCardIdRef.current === currentRec.id) {
        enqueuePostSwipeWork(trackCardViewed);
      } else {
        void trackCardViewed();
      }
    }
  }, [currentRec, currentCardIndex, enqueuePostSwipeWork]);

  useEffect(() => {
    if (
      effectiveUIState.type !== 'LOADED' ||
      isExpandedModalVisible ||
      showPaywall
    ) {
      invalidateDeckSwipe('deck-surface-replacement');
    }
  }, [
    activeDeckContextKey,
    currentMode,
    effectiveUIState.type,
    isExpandedModalVisible,
    refreshKey,
    showPaywall,
    invalidateDeckSwipe,
  ]);

  // Trigger card content entrance animations when current card changes
  useEffect(() => {
    if (currentRec) {
      const promotedFromPreview = promotedCardIdRef.current === currentRec.id;
      cardContentOpacity.setValue(promotedFromPreview ? 1 : 0);
      matchBadgeSlide.setValue(promotedFromPreview ? 0 : -20);
      titleOverlaySlide.setValue(promotedFromPreview ? 0 : 30);

      if (promotedFromPreview || reducedMotion) {
        cardContentOpacity.setValue(1);
        matchBadgeSlide.setValue(0);
        titleOverlaySlide.setValue(0);
        return;
      }

      // Run entrance animations
      Animated.parallel([
        Animated.timing(cardContentOpacity, {
          toValue: 1,
          duration: CARD_ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(matchBadgeSlide, {
          toValue: 0,
          duration: CARD_ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(titleOverlaySlide, {
          toValue: 0,
          duration: CARD_ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [currentRec?.id, reducedMotion]);

  // Reset index if we're beyond the available cards
  useEffect(() => {
    if (availableRecommendations.length === 0) {
      // No cards available - reset index to 0 if it's not already 0
      if (currentCardIndex !== 0) {
        setCurrentCardIndex(0);
      }
      return;
    }

    if (
      currentCardIndex >= availableRecommendations.length &&
      availableRecommendations.length > 0
    ) {
      setCurrentCardIndex(0);
    }
  }, [availableRecommendations.length, currentCardIndex]);

  // ── ORCH-0490 Phase 2.3 rework (AH-138): RESTORE from registry on context change ──
  // When the active DeckContext changes (Solo↔Collab or session→different session),
  // read the NEW context's saved DeckState.removedCards + .currentCardIndex from
  // the registry and apply to local component state. Previous context's state was
  // saved by the SAVE effect below; nothing is lost on toggle.
  //
  // Also sets `previousCardIdsSetRef.current = new Set()` so the next expansion-
  // effect fire treats the transition as INIT (prev.size === 0 → no wipe). Without
  // this, the expansion effect would see the previous context's card IDs as
  // `prev` and the new context's as `new`, trigger the non-superset RESET branch,
  // and clobber the just-restored removedCards.
  //
  // Flag-off: no-op; legacy AsyncStorage-backed restoration in checkAndRestoreState
  // below runs unchanged.
  useEffect(() => {
    if (!FEATURE_FLAG_PER_CONTEXT_DECK_STATE) return;
    if (!deckStateRegistry || !activeDeckContext || !activeDeckContextKey) return;
    if (prevDeckContextKeyRef.current === activeDeckContextKey) return;

    const state = deckStateRegistry.get(activeDeckContext);
    const restoredRemoved = new Set(state.removedCards);
    setRemovedCards(restoredRemoved);
    setCurrentCardIndex(state.currentCardIndex);
    // Mirror to gesture-boundary refs — those read fresh values on swipe and
    // would otherwise see stale state until the next component render.
    removedCardsRef.current = new Set(restoredRemoved);
    currentCardIndexRef.current = state.currentCardIndex;
    // Force expansion effect to treat next recommendations update as INIT.
    previousCardIdsSetRef.current = new Set();

    prevDeckContextKeyRef.current = activeDeckContextKey;
  }, [activeDeckContextKey, deckStateRegistry, activeDeckContext]);

  // ── ORCH-0490 Phase 2.3 rework (AH-138): SAVE to registry on state change ──
  // Mirror SwipeableCards' local swipe state (`removedCards`, `currentCardIndex`)
  // into the registry entry for the currently-active DeckContext. Runs whenever
  // either local state value changes.
  //
  // Context-change race guard: on the render AFTER a context change, this
  // effect's closure captures the PREVIOUS context's removedCards value while
  // `activeDeckContext` already points to the NEW context. Writing that closure
  // would corrupt the new context's entry with stale data. The
  // `lastSavedContextKeyRef` check detects this first-fire-post-change and
  // skips; the RESTORE effect above updates state to the new context's values,
  // which triggers this effect again in the subsequent render (now closing
  // over the correct, restored state) and the save proceeds normally.
  //
  // Flag-off: no-op.
  useEffect(() => {
    if (!FEATURE_FLAG_PER_CONTEXT_DECK_STATE) return;
    if (!deckStateRegistry || !activeDeckContext || !activeDeckContextKey) return;
    // Guard against first-fire-after-context-change race.
    if (lastSavedContextKeyRef.current !== activeDeckContextKey) {
      lastSavedContextKeyRef.current = activeDeckContextKey;
      return;
    }
    const state = deckStateRegistry.get(activeDeckContext);
    state.removedCards = new Set(removedCards);
    state.currentCardIndex = currentCardIndex;
  }, [
    removedCards,
    currentCardIndex,
    deckStateRegistry,
    activeDeckContext,
    activeDeckContextKey,
  ]);

  // Load saved state from AsyncStorage when recommendations are ready
  useEffect(() => {
    // Wait for recommendations to be available
    if (!recommendations.length) {
      return;
    }

    const checkAndRestoreState = async () => {
      // Check if refreshKey OR mode changed - reset state
      const preferencesChanged = previousRefreshKeyRef.current !== refreshKey;
      const modeChanged = previousModeRef.current !== currentMode;

      // ORCH-0490 Phase 2.3 rework (AH-138): under flag-on, `modeChanged`
      // alone no longer triggers a wipe — per-context state is preserved in
      // the DeckStateRegistry and restored by the RESTORE effect above. The
      // old mode's AsyncStorage keys must ALSO be preserved (they are the
      // cold-launch fallback pending Phase 2.5's Zustand persist). Under
      // flag-off, the legacy wipe still fires exactly as before.
      //
      // `preferencesChanged` STILL triggers a wipe in both flag states —
      // same-context pref change is a user-initiated fresh deck; they
      // expect position to reset. The RESTORE effect runs on CONTEXT key
      // change only; it doesn't misfire on refreshKey change.
      const effectiveModeChanged = FEATURE_FLAG_PER_CONTEXT_DECK_STATE
        ? false
        : modeChanged;

      if (preferencesChanged || effectiveModeChanged) {
        // Preferences or (flag-off) mode changed - full state reset
        console.log(
          "🔄 State reset - Preferences changed:",
          preferencesChanged,
          "Mode changed:",
          effectiveModeChanged
        );
        setRemovedCards(new Set());
        setCurrentCardIndex(0);

        // Close any open modals on preference/mode change. Without this,
        // an expanded card modal or dismissed history sheet from the previous
        // mode/preferences stays visible over the new deck, showing stale data.
        // The swipe animation position is also zeroed to prevent a partially-
        // swiped card from carrying its offset into the fresh deck.
        setIsExpandedModalVisible(false);
        setSelectedCardForExpansion(null);
        setDismissedSheetVisible(false);
        invalidateDeckSwipe('preferences-or-mode-change');

        // Clear old storage keys (from previous refreshKey/mode) before updating the refs
        if (
          previousRefreshKeyRef.current !== undefined ||
          previousModeRef.current !== currentMode
        ) {
          const oldRefreshKey = previousRefreshKeyRef.current;
          const oldMode = previousModeRef.current;
          const oldBaseKey = `mingla_card_state_${oldMode}_${oldRefreshKey}`;
          await AsyncStorage.multiRemove([
            `${oldBaseKey}_index`,
            `${oldBaseKey}_removed`,
          ]);
        }

        previousRefreshKeyRef.current = refreshKey;
        previousModeRef.current = currentMode;
        hasRestoredStateRef.current = true;
        return;
      }

      // Update previous refs
      previousRefreshKeyRef.current = refreshKey;
      previousModeRef.current = currentMode;

      // Only restore once per refreshKey
      if (hasRestoredStateRef.current) {
        return;
      }

      // Load saved state from AsyncStorage
      try {
        const keys = getStorageKeys();
        const [savedIndex, savedRemovedCards] = await AsyncStorage.multiGet([
          keys.index,
          keys.removedCards,
        ]);

        if (savedIndex[1] !== null || savedRemovedCards[1] !== null) {
          const index = savedIndex[1] ? parseInt(savedIndex[1], 10) : 0;
          const rawRemovedCards: string[] = savedRemovedCards[1]
            ? JSON.parse(savedRemovedCards[1])
            : [];

          // Filter out stale IDs that don't match any card in the current batch.
          // Without this, persisted removedCards from a previous session (different
          // preferences or location) can filter out ALL cards in the new batch,
          // creating a dead state: availableRecommendations = 0, "Pulling up more
          // for you" shows permanently with no auto-recovery.
          const currentCardIds = new Set(recommendations.map(r => r.id));
          const removedCardsArray = rawRemovedCards.filter(id => currentCardIds.has(id));

          // Validate index is within bounds
          const availableCount = recommendations.filter(
            (r) =>
              !removedCardsArray.includes(r.id) &&
              !removedCardIds.includes(r.id)
          ).length;

          const restoredIndex =
            availableCount > 0
              ? Math.min(Math.max(0, index), availableCount - 1)
              : 0;

          console.log(
            "✅ Restored state from AsyncStorage - Index:",
            restoredIndex,
            "Removed:",
            removedCardsArray.length,
            rawRemovedCards.length !== removedCardsArray.length
              ? `(pruned ${rawRemovedCards.length - removedCardsArray.length} stale)`
              : ""
          );
          setRemovedCards(new Set(removedCardsArray));
          setCurrentCardIndex(restoredIndex);
        }
        hasRestoredStateRef.current = true;
      } catch (error) {
        console.error("Error loading state from AsyncStorage:", error);
        hasRestoredStateRef.current = true;
      }
    };

    checkAndRestoreState();
  }, [
    recommendations,
    recommendations.length,
    refreshKey,
    currentMode,
    removedCardIds,
    getStorageKeys,
    invalidateDeckSwipe,
  ]);

  // Persist through one serialized, coalescing writer. An older write can never
  // finish after and overwrite the newest settled deck snapshot.
  useEffect(() => {
    if (!hasRestoredStateRef.current || !recommendations.length) {
      return;
    }
    enqueuePersistenceSnapshot(currentCardIndex, removedCards);
  }, [
    currentCardIndex,
    removedCards,
    recommendations.length,
    enqueuePersistenceSnapshot,
  ]);

  // ORCH-0490 Phase 2.3: deck replacement vs expansion signal.
  //
  // Flag-on path (FEATURE_FLAG_PER_CONTEXT_DECK_STATE):
  //   Two signals gate the reset. RESET fires only when BOTH:
  //     (a) new IDs are NOT a strict superset of previous (real replacement), AND
  //     (b) `isDeckExpandingWithinContext` is false (not a same-context pref
  //         change — context actually changed).
  //   Strict superset means: every ID in previous is also in new, and new is
  //   at least as large. Covers both:
  //     - batch append (prev=[A,B,C], new=[A,B,C,D,E]) → superset, EXPANSION.
  //     - progressive-delivery final interleave (prev=[A,B,C,D,E,F] from merge,
  //       new=[A,D,B,E,C,F] from final) → same IDs, different order, still
  //       superset since size is equal → EXPANSION (ORCH-0498 fix).
  //   Same-context pref change (prev=[A,B,C], new=[X,Y,Z] via different
  //   category filter) is NOT a superset, but context didn't change — the
  //   provider signals `isDeckExpandingWithinContext=true` → EXPANSION.
  //
  // Flag-off path:
  //   Legacy first-5-IDs comparison preserved. [TRANSITIONAL] — removed when
  //   flag flips to unconditional true per exit condition in featureFlags.ts.
  useEffect(() => {
    if (!recommendations || recommendations.length === 0) return;

    if (FEATURE_FLAG_PER_CONTEXT_DECK_STATE) {
      // Context-change gate (AH-138): if activeDeckContextKey changed since
      // this effect's last fire, RESTORE has already (a) set removedCards +
      // currentCardIndex from the new context's registry entry, and (b)
      // reset previousCardIdsSetRef to Set(). On this render, recommendations
      // may still be the PREVIOUS context's cards (provider's
      // setRecommendations call is queued, not yet applied). Running the
      // diff now would update previousCardIdsSetRef to wrong-context IDs and
      // trigger a wipe on the NEXT render when new recommendations arrive.
      // Early-return WITHOUT updating previousCardIdsSetRef — leave RESTORE's
      // Set() in place so the next fire hits the INIT branch cleanly.
      if (expansionPrevContextKeyRef.current !== activeDeckContextKey) {
        expansionPrevContextKeyRef.current = activeDeckContextKey;
        return;
      }

      const newCardIdsSet = new Set(recommendations.map((r) => r.id));
      const prevSet = previousCardIdsSetRef.current;

      if (prevSet.size === 0) {
        // INIT — first population, no reset needed. Just record.
        previousCardIdsSetRef.current = newCardIdsSet;
        return;
      }

      // Strict superset: every prev ID is in new AND new.size >= prev.size.
      let isStrictSuperset = newCardIdsSet.size >= prevSet.size;
      if (isStrictSuperset) {
        for (const id of prevSet) {
          if (!newCardIdsSet.has(id)) {
            isStrictSuperset = false;
            break;
          }
        }
      }

      // Reset gate: both signals must permit reset.
      const shouldReset =
        !isStrictSuperset && isDeckExpandingWithinContext !== true;

      if (shouldReset) {
        setRemovedCards(new Set());
        setCurrentCardIndex(0);
      }
      // Else: EXPANSION — preserve removedCards + currentCardIndex. The
      // availableRecommendations memo (ID-to-position tracking via filter)
      // keeps the current top card stable across the transition.

      previousCardIdsSetRef.current = newCardIdsSet;
      return;
    }

    // Flag-off: pre-2.3 first-5-IDs comparison.
    const newFirstIds = recommendations
      .slice(0, 5)
      .map((r) => r.id)
      .sort()
      .join(",");

    if (
      previousBatchIdsRef.current !== "" &&
      previousBatchIdsRef.current !== newFirstIds
    ) {
      // The first 5 cards changed — this is a full deck replacement (e.g. external
      // reset not caught by the preference/mode handler). Clear swipe state.
      setRemovedCards(new Set());
      setCurrentCardIndex(0);
    }
    // If only the array length grew but firstIds stayed the same, this is a batch
    // append — do NOT clear removedCards or reset currentCardIndex.

    previousBatchIdsRef.current = newFirstIds;
  }, [recommendations, isDeckExpandingWithinContext, activeDeckContextKey]);

  // #1669 [expanded-card-one-producer]: the deck's SINGLE producer, shared by
  // the tap/swipe-up path (`handleCardExpand`) and the review / dismissed-card
  // path — which were two separate hand-written literals before. The mapping
  // itself lives in `utils/recommendationToExpandedCardData` so it is
  // importable and the regression test can open the same place from the deck
  // and from Likes and compare the facts. All this closure adds is the one
  // thing a module cannot know: which datetime the viewer is planning for.
  const recommendationToExpanded = useCallback((card: Recommendation): ExpandedCardData => {
    return recommendationToExpandedCardData(card, {
      selectedDateTime: userPreferences?.datetime_pref
        ? new Date(userPreferences.datetime_pref)
        : new Date(),
    });
  }, [userPreferences]);

  const handleCardExpand = async () => {
    if (!currentRec) return;
    // ORCH-1064: re-open guard — ignore an open within 500ms of the last close so
    // the modal can't be re-presented mid-dismiss (intermittent freeze).
    if (Date.now() - lastModalCloseAtRef.current < 500) return;
    setIsReviewMode(false); // ORCH-1064: normal deck tap — no review chrome
    setIsExpandedModalVisible(true);

    // ORCH-0408 Phase 4: Record expand — counter + user interaction log (fire-and-forget)
    recordCardExpand(currentRec.id, {
      category: currentRec.category,
      priceTier: currentRec.priceTier,
      isCurated: (currentRec as any).cardType === 'curated',
    });

    // Track card expanded in Mixpanel (ALL card types — curated was previously skipped)
    mixpanelService.trackCardExpanded({
      cardId: currentRec.id,
      cardTitle: currentRec.title,
      category: currentRec.category,
      source: "home",
    });
    // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
    postHogService.capture("card_expanded", {
      card_id: currentRec.id,
      card_title: currentRec.title,
      category: currentRec.category,
      source: "home",
    });

    // ORCH-1065: brand experiences expand to the business-event sheet →
    // ticket-checkout-create (NO parallel money fn — COMMS-0014/0016), NOT the
    // curated AI itinerary view. Routed BEFORE the curated branch.
    if ((currentRec as any).cardType === 'experience') {
      setExpandedBrandExperience(experienceRecToBusinessEventCard(currentRec));
      return;
    }

    // Curated cards have their own shape — pass through directly
    if ((currentRec as any).cardType === 'curated') {
      setSelectedCardForExpansion(currentRec as unknown as ExpandedCardData);
      return;
    }
    logAppsFlyerEvent('af_content_view', {
      af_content_type: currentRec.category,
      af_content_id: currentRec.id,
      af_price: (currentRec as any).estimatedCostPerPerson || 0,
      source: 'home',
      rating: currentRec.rating || 0,
    });

    // #1669 [expanded-card-one-producer]: the deck used to hand-write this
    // object, which is how the price pill went missing on the deck (it never
    // spread `canonicalDiscoveryPriceFields`), how the Open-now badge got
    // computed against the viewer's clock (no `utcOffsetMinutes`), and how a
    // coordinate-less card ended up rendering the VIEWER's weather under the
    // venue's name (`: userLocation` fallback). One producer now.
    const expandedCardData = recommendationToExpanded(currentRec);

    setSelectedCardForExpansion(expandedCardData);
  };

  const handleCloseExpandedModal = () => {
    setIsExpandedModalVisible(false);
    setSelectedCardForExpansion(null);
    setExpandedBrandExperience(null);  // ORCH-1065
    setIsReviewMode(false); // ORCH-1064: reset review mode on close
    lastModalCloseAtRef.current = Date.now(); // ORCH-1064: re-open guard window
  };

  const handleSwipe = async (
    direction: "left" | "right",
    card: Recommendation
  ) => {
    if (!card) return;

    // ORCH-0408 Phase 4: Record swipe — counter + user interaction log (fire-and-forget)
    recordCardSwipe(card.id, direction, {
      category: card.category,
      priceTier: card.priceTier,
      isCurated: (card as any).cardType === 'curated',
    });

    // ── Analytics: save or dismiss ──
    const isCurated = (card as any).cardType === 'curated';
    if (direction === 'right') {
      logAppsFlyerEvent('af_add_to_wishlist', {
        af_content_type: card.category,
        af_price: (card as any).estimatedCostPerPerson || 0,
        af_content_id: card.id,
      });
      mixpanelService.trackCardSaved({
        card_id: card.id,
        card_title: card.title,
        category: card.category,
        is_curated: isCurated,
        source: 'swipe',
      });
      // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
      postHogService.capture("card_saved", {
        card_id: card.id,
        card_title: card.title,
        category: card.category,
        is_curated: isCurated,
        source: 'swipe',
      });

    } else {
      logAppsFlyerEvent('card_dismissed', {
        af_content_type: card.category,
      });
      mixpanelService.trackCardDismissed({
        card_id: card.id,
        card_title: card.title,
        category: card.category,
        is_curated: isCurated,
      });
      // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
      postHogService.capture("card_dismissed", {
        card_id: card.id,
        card_title: card.title,
        category: card.category,
        is_curated: isCurated,
      });
    }

    try {
      // Track interaction in Supabase (only if user is authenticated)
      if (user?.id) {
        const isCuratedType = (card as any).cardType === 'curated';

        // ── ORCH-0640 ch09: Legacy saves/experiences tables DROPPED in ch12.
        // Swipe-right now writes to saved_card via savedCardsService (snapshot pattern).
        // Swipe-left dislikes are captured by recordCardSwipe (engagement_metrics) above
        // — no separate dislike table needed.
        if (!isCuratedType) {
          if (direction === "right") {
            try {
              await savedCardsService.saveCard(user.id, card, "solo");
            } catch (saveError: any) {
              if (saveError?.code === "23505") {
                console.warn(
                  "Card already saved for this user, skipping duplicate save"
                );
              } else {
                console.error("Error saving card:", saveError);
                throw saveError;
              }
            }
          } else {
            // Swipe-left: no persistent table. Dislike is captured by recordCardSwipe
            // above, which fires into engagement_metrics as a 'seen_deck' event.
            try {
              // no-op (ORCH-0640 DEC-050)
              await Promise.resolve();
            } catch (dislikeError) {
              console.error("Error tracking dislike:", dislikeError);
              // Continue without tracking dislike
            }
          }
        }

        // ── Solo-only: right-swipe fires onCardLike (= handleSaveCard) ───
        // ORCH-0532: handleSaveCard is now SOLO-ONLY. Only fire it when NOT
        // in a collab session. Collab right-swipes go through collabSaveCard
        // below. This applies to BOTH curated and non-curated cards.
        if (direction === 'right' && !isBoardSession) {
          const saveResult = await onCardLike(card);
          if (saveResult === false) {
            rollbackDeckSessionHistory(card.id);
            // Preserve the existing save-failure rollback contract without
            // leaving the synchronous gesture refs or persisted snapshot one
            // render behind the visible deck.
            const rolledBack = new Set(removedCardsRef.current);
            rolledBack.delete(card.id);
            removedCardsRef.current = rolledBack;
            currentCardIndexRef.current = 0;
            setRemovedCards(rolledBack);
            setCurrentCardIndex(0);
            enqueuePersistenceSnapshot(0, rolledBack);
            return;
          }
        }

        // ── Collab-only: route through shared helper (right) or just record
        // swipe state (left). ORCH-0533: this block NOW fires for curated
        // cards too. ORCH-0558: both branches now go through
        // BoardCardService.recordSwipeAndCheckMatch (atomic RPC).
        if (isBoardSession && resolvedSessionId) {
          if (direction === 'right') {
            // collabSaveCard handles: RPC call → provisional toast → match
            // toast + notifyMatch on matched:true. Helper is try/catch-sealed.
            await collabSaveCard({
              card,
              sessionId: resolvedSessionId,
              userId: user.id,
              t,
            });
          } else {
            // Left-swipe: record swipe state via the shared collab helper
            // so OTHER participants see this user passed on the card
            // (ORCH-0902 CR-6 visible-but-not-binding dismissal). The helper
            // writes the full card payload — useSessionDismissedCards reads
            // it back to render attribution even for cards the viewer
            // hasn't seen yet. Soft-fails are logged but don't block UI.
            await collabRecordLeftSwipe({
              card,
              sessionId: resolvedSessionId,
              userId: user.id,
            });
          }
        }
      } else {
        // User not authenticated - just handle locally
        if (direction === "right" && onCardLike) {
          onCardLike(card);
        }
      }
    } catch (error) {
      console.error("Error handling swipe:", error);
    }

    // Track dismissed cards (left-swiped) for review
    if (direction === "left") {
      addDismissedCard(card);
    }

    // Report progress for prefetch trigger
    // availableRecommendations still includes the card being swiped (state not committed yet)
    // currentCardIndex is always 0 in the removed-cards pattern, so remaining = length - 1
    handleDeckCardProgress(0, availableRecommendations.length);

    // When last card is swiped, let the exhaustion screen handle next steps.
    // The user explicitly chooses: review a previous deck, load a new deck, or change preferences.
  };

  // Sync gesture-boundary function refs after their definitions.
  useEffect(() => {
    handleSwipeRef.current = handleSwipe;
  });

  useEffect(() => {
    handleCardExpandRef.current = handleCardExpand;
  });

  const handleBuyNow = () => {
    if (onAddToCalendar) {
      onAddToCalendar(currentRec);
    }
  };

  const handleShare = () => {
    if (onShareCard) {
      onShareCard(currentRec);
    }
  };

  const handleOpenPreferences = () => {
    if (currentMode === "solo") {
      onOpenPreferences?.();
    } else {
      onOpenCollabPreferences?.();
    }
  };

  // ORCH-1058B send-UX: tapping "Notify the group" first asks for explicit
  // confirmation (proceed/cancel via the app's standard Alert.alert pattern —
  // same shape used across SavedTab scheduling, ConnectionsPage, etc.). Only on
  // "Notify" do we post the banner; success/failure feedback is surfaced by
  // postCollabDeadEndBanner's toasts.
  const postNotifyGroup = useCallback(async (reason: CollabDeadEndReason) => {
    if (!resolvedSessionId || !user?.id) return;
    const posted = await postCollabDeadEndBanner({
      sessionId: resolvedSessionId,
      reason,
      payload: collabDeadEndPayload,
      participants: collabParticipants,
      participantPrefs: allParticipantPrefs,
      currentUserId: user.id,
    });
    // ORCH-1059: on a real successful post ONLY, return the user to the group
    // chat (the owning CollabDeckSheet dismisses the deck + any prefs sub-sheet).
    // The success toast is global, so it stays visible across the navigation.
    // On debounce/cancel/failure (posted === false) we stay put so they can retry.
    if (posted) {
      onAfterNotify?.();
    }
  }, [allParticipantPrefs, collabDeadEndPayload, collabParticipants, onAfterNotify, resolvedSessionId, user?.id]);

  const handleNotifyGroup = useCallback((reason: CollabDeadEndReason) => {
    if (!resolvedSessionId || !user?.id) return;
    Alert.alert(
      'Notify the group?',
      "We'll post a note in the chat that your locations don't overlap yet.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Notify', onPress: () => { void postNotifyGroup(reason); } },
      ],
    );
  }, [postNotifyGroup, resolvedSessionId, user?.id]);

  const getCollabDeadEndCopy = useCallback(() => {
    const reason = (collabDeadEndPayload?.reason ?? collabDeckDeadEndReason) as CollabDeadEndReason | undefined;
    if (!isBoardSession || !reason) return null;

    const normalizedParticipants = normalizeParticipants(collabParticipants);
    const namesById = new Map(normalizedParticipants.map((participant) => [participant.id, participant.name]));
    const participantPrefs = allParticipantPrefs ?? {};
    const detail = collabDeadEndPayload?.detail ?? '';
    const pendingGpsIds = collabDeadEndPayload?.pendingGpsUserIds ?? [];
    const pendingAcceptIds = normalizedParticipants
      .filter((participant) => participant.hasAccepted === false)
      .map((participant) => participant.id);
    const nameList = (ids: string[]) => ids.map((id) => namesById.get(id) ?? 'A participant').join(', ');

    switch (reason) {
      case 'intersection_empty': {
        const outlier = detectIntersectionOutlier(normalizedParticipants, participantPrefs);
        if (outlier.mode === 'single') {
          return {
            reason,
            title: `${namesById.get(outlier.userId) ?? 'Someone'} is too far from the group`,
            subtitle: formatTravelDiagnostic(normalizedParticipants, participantPrefs),
            showReviewDismissed: false,
          };
        }
        // ORCH-1058 §3: 2-person / no-clear-outlier path now routes to one of
        // three honest cases with privacy-aware location chips.
        const { kind, pendingIds } = classifyIntersectionCase(
          normalizedParticipants,
          participantPrefs,
          pendingGpsIds,
        );
        const selfId = user?.id ?? null;
        const pendingSet = new Set(pendingIds);

        if (kind === 'waiting') {
          const settledChips: CollabLocationChip[] = normalizedParticipants
            .filter((participant) => !pendingSet.has(participant.id))
            .map((participant) => {
              const resolved = resolveParticipantLocationLabel({
                prefs: participantPrefs[participant.id],
                isSelf: participant.id === selfId,
              });
              return {
                id: participant.id,
                label: resolved.label,
                kind: resolved.kind,
                a11yLabel: `${participant.name}: ${resolved.a11yLabel}`,
              };
            });
          const pendingChips: CollabLocationChip[] = pendingIds.map((id) => {
            const name = namesById.get(id) ?? 'A participant';
            return {
              id,
              label: t('cards:collab.deadend.waiting.pending_chip', { name }),
              kind: 'pending' as const,
              a11yLabel: `${name}: getting a fix`,
            };
          });
          const firstPendingName = namesById.get(pendingIds[0] ?? '') ?? 'a friend';
          return {
            reason,
            title:
              pendingIds.length > 1
                ? t('cards:collab.deadend.waiting.title_many')
                : t('cards:collab.deadend.waiting.title_one', { name: firstPendingName }),
            guidance: t('cards:collab.deadend.waiting.guidance'),
            chips: [...settledChips, ...pendingChips],
            showReviewDismissed: false,
          };
        }

        const locationChips: CollabLocationChip[] = normalizedParticipants.map((participant) => {
          const resolved = resolveParticipantLocationLabel({
            prefs: participantPrefs[participant.id],
            isSelf: participant.id === selfId,
          });
          return {
            id: participant.id,
            label: resolved.label,
            kind: resolved.kind,
            a11yLabel: `${participant.name}: ${resolved.a11yLabel}`,
          };
        });

        if (kind === 'different_cities') {
          return {
            reason,
            title: t('cards:collab.deadend.different_cities.title'),
            guidance: t('cards:collab.deadend.different_cities.guidance'),
            chips: locationChips,
            showReviewDismissed: false,
          };
        }

        // same_city_tight
        return {
          reason,
          title: t('cards:collab.deadend.same_city_tight.title'),
          guidance: t('cards:collab.deadend.same_city_tight.guidance'),
          chips: locationChips,
          showReviewDismissed: false,
        };
      }
      case 'no_matching_candidates': {
        const noGps = /no gps/i.test(detail) || pendingGpsIds.length > 0;
        if (noGps) {
          const pendingNames = pendingGpsIds.length > 0 ? nameList(pendingGpsIds) : 'someone';
          return {
            reason,
            title: `Waiting for ${pendingNames} to share location`,
            subtitle: `Waiting for ${pendingNames} to share location`,
            showReviewDismissed: false,
          };
        }
        return {
          reason,
          title: 'Pick some categories',
          subtitle: 'Nobody has picked categories or intents yet',
          showReviewDismissed: false,
        };
      }
      case 'no_unswiped_candidates':
        return {
          reason,
          title: "You've all seen everything for now",
          subtitle: `${sessionSwipedCards.length} cards reviewed this session`,
          showReviewDismissed: true,
        };
      case 'quorum_not_met': {
        const needed = Math.max(1, normalizedParticipants.length - (collabDeadEndPayload?.acceptedCount ?? 0));
        return {
          reason,
          title: `Waiting for ${needed} more to accept`,
          subtitle: pendingAcceptIds.length > 0 ? `Pending: ${nameList(pendingAcceptIds)}` : 'Pending: invited friends',
          showReviewDismissed: false,
        };
      }
      case 'all_pools_exhausted':
        return {
          reason,
          title: "You've exhausted today's options",
          subtitle: 'Try a wider date window?',
          showReviewDismissed: false,
        };
      default:
        return null;
    }
  }, [
    allParticipantPrefs,
    collabDeadEndPayload,
    collabDeckDeadEndReason,
    collabParticipants,
    isBoardSession,
    sessionSwipedCards.length,
    t,
    user?.id,
  ]);

  // ORCH-0532: dismissed-sheet re-save path. In collab mode, route through the
  // shared helper (writes swipe-state, honors quorum trigger). In solo mode,
  // fire onCardLike (= handleSaveCard, now solo-only). Previously this callsite
  // was unguarded — it always called onCardLike, which used to write directly
  // to board_saved_cards and bypass quorum. Now quorum is preserved on every path.
  const handleSaveDismissedCard = useCallback((card: Recommendation) => {
    if (isBoardSession && resolvedSessionId && user?.id) {
      // Fire-and-forget in collab — the helper handles its own toast/error UX.
      // .catch() guards against unhandled rejections.
      collabSaveCard({
        card,
        sessionId: resolvedSessionId,
        userId: user.id,
        t,
      }).catch((err) =>
        console.error('[handleSaveDismissedCard] collabSaveCard failed:', err)
      );
    } else {
      onCardLike(card);
    }
  }, [onCardLike, isBoardSession, resolvedSessionId, user?.id, t]);

  const handleDismissedCardPress = useCallback((card: Recommendation) => {
    // Find this card's index in the reversed session list (most recent first)
    const reversedCards = [...sessionSwipedCards].reverse();
    const idx = reversedCards.findIndex(c => c.id === card.id);
    setReviewIndex(idx >= 0 ? idx : 0);
    setIsReviewMode(true); // ORCH-1064: opened from swipe history — show review chrome

    setDismissedSheetVisible(false);
    setTimeout(() => {
      setSelectedCardForExpansion(recommendationToExpanded(card));
      setIsExpandedModalVisible(true);
    }, 300);
  }, [sessionSwipedCards, recommendationToExpanded]);

  // Review navigation: cycle through sessionSwipedCards (reversed = most recent first)
  const reviewCards = useMemo(() => [...sessionSwipedCards].reverse(), [sessionSwipedCards]);

  const handleReviewNext = useCallback(() => {
    const nextIdx = reviewIndex + 1;
    if (nextIdx < reviewCards.length) {
      setReviewIndex(nextIdx);
      setSelectedCardForExpansion(recommendationToExpanded(reviewCards[nextIdx]));
    }
  }, [reviewIndex, reviewCards, recommendationToExpanded]);

  const handleReviewPrevious = useCallback(() => {
    const prevIdx = reviewIndex - 1;
    if (prevIdx >= 0) {
      setReviewIndex(prevIdx);
      setSelectedCardForExpansion(recommendationToExpanded(reviewCards[prevIdx]));
    }
  }, [reviewIndex, reviewCards, recommendationToExpanded]);

  const handleViewCardsAgain = async () => {
    // Clear local state
    setRemovedCards(new Set());
    setCurrentCardIndex(0);
    invalidateDeckSwipe('view-cards-again');

    // Clear AsyncStorage for current mode and refreshKey
    try {
      const keys = getStorageKeys();
      await AsyncStorage.multiRemove([keys.index, keys.removedCards]);
    } catch (error) {
      console.error("Error clearing card state from AsyncStorage:", error);
    }

    onResetCards?.();
  };

  // ── State-machine-driven render branches ────────────────────────────────
  // Single switch on effectiveUIState replaces 5 independent conditional branches.
  // Each DeckUIState maps to exactly one render path — no ambiguity, no overlap.
  //
  // ORCH-1063 (production freeze-after-close): `deckBody` returns ONLY deck
  // content. The ExpandedCardModal / DismissedCardsSheet / CustomPaywallScreen
  // overlays are NO LONGER rendered inside any switch branch — they are mounted
  // exactly once, at a stable position, in the component's final return below.
  // Previously the modal lived inside two different switch branches; any
  // transient deck-state transition while a card was expanded (token refresh →
  // AUTH_REQUIRED, transient PIPELINE_ERROR, background refetch, or reaching
  // deck end → EXHAUSTED / EMPTY↔LOADED) unmounted the currently-PRESENTED RN
  // <Modal> mid-flight. On a real device + release build iOS tore the presented
  // modal window down, leaving an invisible full-screen modal that captured
  // every touch → total app freeze. Single stable mount = only the `visible`
  // prop ever changes, so no deck-state transition can swap the modal instance.
  const deckBody: React.ReactNode = (() => {
  switch (effectiveUIState.type) {
    case 'INITIAL_LOADING':
    case 'MODE_TRANSITIONING':
      return (
        <View style={styles.loadingContainer}>
          <Animated.View style={[styles.loadingContent, { opacity: loaderFadeIn }]}>
            <SkeletonCard
              width={SCREEN_WIDTH - 48}
              height={SCREEN_HEIGHT - 280}
              borderRadius={20}
            />
            <Text style={styles.skeletonLoadingText}>{t('cards:swipeable.curating_lineup')}</Text>
          </Animated.View>
        </View>
      );

    case 'ERROR':
      return (
        <View style={styles.noCardsContainer}>
          <View style={styles.noCardsContent}>
            <View style={styles.noCardsIcon}>
              <Icon name="alert-circle" size={48} color="#ef4444" />
            </View>
            <Text style={styles.noCardsTitle}>{t('cards:swipeable.error_title')}</Text>
            <Text style={styles.noCardsSubtitle}>{effectiveUIState.message}</Text>
            <TouchableOpacity
              onPress={() => {
                refreshRecommendations(refreshKey);
              }}
              style={styles.startOverButton}
              activeOpacity={0.7}
            >
              <Text style={styles.startOverButtonText}>{t('cards:swipeable.try_again')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );

    case 'EMPTY':
    case 'EXHAUSTED': {
      // ORCH-0469 / ORCH-0472: EMPTY and EXHAUSTED are two distinct user states.
      // EMPTY = user picked a filter that has no results. EXHAUSTED = user has
      // swiped through everything. Fire separate analytics events, render separate
      // copy, show/hide the "Review all cards" CTA accordingly.
      const isEmpty = effectiveUIState.type === 'EMPTY';
      const analyticsSentinel = isEmpty ? '__deck_empty__' : '__deck_exhausted__';
      if (lastViewedCardIdRef.current !== analyticsSentinel) {
        if (isEmpty) {
          // ORCH-0490 Phase 2.1 + I-DECK-EMPTY-IS-SERVER-VERDICT: fire the
          // analytic ONLY for genuine server-verdict pool-empty responses.
          // Filter-to-empty (serverPath === 'pipeline' with zero cards after
          // client-side date/hours filtering) is a different UX signal — the
          // filter was too narrow, not the pool. Previously we fired for both
          // and the ORCH-0494 false-EMPTY race overcounted "no matches"
          // events from populated server responses. Now: truthful only.
          if (serverPath === 'pool-empty') {
            mixpanelService.trackDeckEmptyFilter({
              categories: cachedPreferences?.categories ?? [],
              date_option: cachedPreferences?.date_option ?? 'today',
              travel_mode: cachedPreferences?.travel_mode ?? 'walking',
              travel_constraint_value: cachedPreferences?.travel_constraint_value ?? 30,
              session_mode: currentMode === 'solo' ? 'solo' : 'collab',
              server_path: 'pool-empty',
            });
          }
        } else {
          mixpanelService.trackDeckExhausted({
            cards_seen: currentCardIndex,
            cards_saved: savedCards.length,
            cards_dismissed: Math.max(0, currentCardIndex - savedCards.length),
            session_mode: currentMode === 'solo' ? 'solo' : 'collab',
          });
          // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
          postHogService.capture("deck_exhausted", {
            cards_seen: currentCardIndex,
            cards_saved: savedCards.length,
            cards_dismissed: Math.max(0, currentCardIndex - savedCards.length),
            session_mode: currentMode === 'solo' ? 'solo' : 'collab',
          });
        }
        lastViewedCardIdRef.current = analyticsSentinel;
      }

      // ORCH-1113: when a curated-only deck empties because every assembled
      // itinerary had a stop closed at the evaluated time, the title/subtitle
      // are honest ("Everything's closed right now") instead of the generic
      // "No spots match right now". Any other empty reason keeps the original
      // copy. The collab dead-end copy (getCollabDeadEndCopy) still takes
      // precedence below; this only affects the plain-empty case.
      const isAllClosedAtTime = isEmpty && curatedEmptyReason === 'all_closed_at_time';
      const titleKey = isEmpty
        ? (isAllClosedAtTime
            ? 'cards:swipeable.all_closed_title'
            : 'cards:swipeable.no_matches_title')
        : 'cards:swipeable.seen_everything';
      const collabDeadEndCopy = getCollabDeadEndCopy();

      // ORCH-1063: returns ONLY the empty-deck view. DismissedCardsSheet +
      // ExpandedCardModal moved to the single stable mount in the final return.
      return (
          <View style={styles.emptyDeckContainer}>
            <View style={styles.emptyDeckContent}>
              <View style={styles.emptyDeckIconCircle}>
                <Icon
                  name={isEmpty ? 'filter-outline' : 'earth-outline'}
                  size={24}
                  color="#eb7825"
                />
              </View>
              <Text style={styles.emptyDeckTitle}>
                {collabDeadEndCopy?.title ?? t(titleKey)}
              </Text>
              {/* ORCH-1058: intersection_empty returns privacy-aware chips +
                  a guidance line; all other reasons keep the plain subtitle. */}
              {collabDeadEndCopy && 'chips' in collabDeadEndCopy && collabDeadEndCopy.chips ? (
                <>
                  <CollabLocationChips chips={collabDeadEndCopy.chips} />
                  <Text style={[styles.emptyDeckSubtitle, styles.emptyDeckGuidance]}>
                    {collabDeadEndCopy.guidance}
                  </Text>
                </>
              ) : (
                <Text style={styles.emptyDeckSubtitle}>
                  {(collabDeadEndCopy && 'subtitle' in collabDeadEndCopy
                    ? collabDeadEndCopy.subtitle
                    : undefined) ??
                    (isEmpty
                    ? (isAllClosedAtTime
                        ? t('cards:swipeable.all_closed_subtitle')
                        : t('cards:swipeable.no_matches_subtitle'))
                    : (() => {
                        const hour = new Date().getHours();
                        const isLateNight = hour >= 21 || hour < 6;
                        // ORCH-0446 R8.3: Smart late night suggestion (EXHAUSTED only)
                        return isLateNight
                          ? 'Most places are closing soon. Try "This Weekend" for more options.'
                          : t('cards:swipeable.shift_vibe');
                      })())}
                </Text>
              )}

              <View style={styles.emptyDeckActions}>
                {collabDeadEndCopy && (
                  <TouchableOpacity
                    style={styles.emptyDeckButton}
                    onPress={() => handleNotifyGroup(collabDeadEndCopy.reason)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Notify the group"
                  >
                    <Icon name="chatbubble-ellipses-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.emptyDeckButtonText}>Notify the group</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={collabDeadEndCopy ? styles.emptyDeckOutlineButton : styles.emptyDeckButton}
                  onPress={handleOpenPreferences}
                  activeOpacity={0.7}
                >
                  <Icon name="options-outline" size={16} color={collabDeadEndCopy ? "#eb7825" : "#FFFFFF"} />
                  <Text style={collabDeadEndCopy ? styles.emptyDeckOutlineButtonText : styles.emptyDeckButtonText}>
                    {t('cards:swipeable.shift_preferences')}
                  </Text>
                </TouchableOpacity>

                {/* Only EXHAUSTED shows "Review all cards" — EMPTY has nothing to review. */}
                {((!isEmpty && sessionSwipedCards.length > 0) || collabDeadEndCopy?.showReviewDismissed) && (
                  <TouchableOpacity
                    style={styles.emptyDeckOutlineButton}
                    onPress={() => setDismissedSheetVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Icon name="time-outline" size={16} color="#eb7825" />
                    <Text style={styles.emptyDeckOutlineButtonText}>
                      {collabDeadEndCopy ? 'Review dismissed' : t('cards:swipeable.review_all_cards')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
      );
    }

    case 'WAITING_FOR_PARTICIPANTS':
      return (
        <View style={styles.noCardsContainer}>
          <Icon name="people-outline" size={48} color="#9CA3AF" />
          <Text style={styles.noCardsTitle}>Waiting for friends to join</Text>
          <Text style={styles.noCardsSubtitle}>
            Once someone accepts your invite, the deck will load automatically.
          </Text>
        </View>
      );

    // ORCH-0507.c: 'WAITING_FOR_PREFERENCES' case removed; was dead code —
    // declared in the union + rendered here but never returned by any selector.
    // Load-in-progress now falls through to INITIAL_LOADING via the Layer 4
    // null-check on allParticipantPrefs.
    case 'EMPTY_POOL':
      return (
        <View style={styles.noCardsContainer}>
          <Icon name="location-outline" size={48} color="#9CA3AF" />
          <Text style={styles.noCardsTitle}>No places found nearby</Text>
          <Text style={styles.noCardsSubtitle}>
            Try adjusting your categories or travel distance.
          </Text>
          {onOpenPreferences && (
            <TouchableOpacity
              style={styles.emptyPoolButton}
              onPress={onOpenPreferences}
              activeOpacity={0.7}
            >
              <Text style={styles.emptyPoolButtonText}>Adjust Preferences</Text>
            </TouchableOpacity>
          )}
        </View>
      );

    case 'AUTH_REQUIRED':
      // ORCH-0474: JWT sub unreadable — surface an honest retry banner
      // instead of the misleading EMPTY "no spots match" copy. Fire a
      // deck_server_error analytics event once per state entry.
      if (lastViewedCardIdRef.current !== '__deck_auth_required__') {
        mixpanelService.trackDeckServerError({
          server_path: 'auth-required',
          error_class: 'auth',
          elapsed_ms: 0,
          session_mode: currentMode === 'solo' ? 'solo' : 'collab',
        });
        lastViewedCardIdRef.current = '__deck_auth_required__';
      }
      return (
        <View style={styles.emptyDeckContainer}>
          <View style={styles.emptyDeckContent}>
            <View style={styles.emptyDeckIconCircle}>
              <Icon name="lock-closed-outline" size={24} color="#eb7825" />
            </View>
            <Text style={styles.emptyDeckTitle}>
              {t('cards:swipeable.auth_error_title')}
            </Text>
            <Text style={styles.emptyDeckSubtitle}>
              {t('cards:swipeable.auth_error_subtitle')}
            </Text>
            <View style={styles.emptyDeckActions}>
              <TouchableOpacity
                style={styles.emptyDeckButton}
                onPress={() => refreshRecommendations(refreshKey)}
                activeOpacity={0.7}
                accessibilityLabel={t('cards:swipeable.try_again')}
              >
                <Icon name="refresh-outline" size={16} color="#FFFFFF" />
                <Text style={styles.emptyDeckButtonText}>
                  {t('cards:swipeable.try_again')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );

    case 'PIPELINE_ERROR':
      // ORCH-0474: Server pipeline threw and we have no stale cards to keep
      // visible. Full-screen retry — distinct from EMPTY (seeding gap) and
      // from ERROR (location/unknown). Fires deck_server_error with the
      // sanitized error class carried in the state's `message` field.
      if (lastViewedCardIdRef.current !== '__deck_pipeline_error__') {
        mixpanelService.trackDeckServerError({
          server_path: 'pipeline-error',
          error_class: deckUIState.type === 'PIPELINE_ERROR'
            ? (deckUIState.message || 'unknown')
            : 'unknown',
          elapsed_ms: 0,
          session_mode: currentMode === 'solo' ? 'solo' : 'collab',
        });
        lastViewedCardIdRef.current = '__deck_pipeline_error__';
      }
      return (
        <View style={styles.emptyDeckContainer}>
          <View style={styles.emptyDeckContent}>
            <View style={styles.emptyDeckIconCircle}>
              <Icon name="cloud-offline-outline" size={24} color="#eb7825" />
            </View>
            <Text style={styles.emptyDeckTitle}>
              {t('cards:swipeable.pipeline_error_title')}
            </Text>
            <Text style={styles.emptyDeckSubtitle}>
              {t('cards:swipeable.pipeline_error_subtitle')}
            </Text>
            <View style={styles.emptyDeckActions}>
              <TouchableOpacity
                style={styles.emptyDeckButton}
                onPress={() => refreshRecommendations(refreshKey)}
                activeOpacity={0.7}
                accessibilityLabel={t('cards:swipeable.try_again')}
              >
                <Icon name="refresh-outline" size={16} color="#FFFFFF" />
                <Text style={styles.emptyDeckButtonText}>
                  {t('cards:swipeable.try_again')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );

    case 'LOADED':
      // Falls through to the main card render below
      break;

    default: {
      // Compile-time exhaustiveness guard: if a new DeckUIState variant is added
      // and not handled above, TypeScript will error here.
      const _exhaustive: never = effectiveUIState;
      return _exhaustive;
    }
  }

  if (!currentRec) {
    return null;
  }

  // #1609 tester P1-1 — the FRONT face's silhouette, decided once from the same
  // predicate the plate sizes itself with, and read by both the name's anchor and
  // the plate. The spans are computed once here rather than inline in the JSX so
  // the two cannot be handed different span sets, which is how the name and the
  // plate came to disagree about which silhouette was being drawn in the first
  // place. Curated/experience cards take the CuratedExperienceSwipeCard branch
  // above and resolve their own presentation there.
  const currentSpans = metaSpansForCard(currentRec, accountPreferences?.measurementSystem);
  const currentPresentation = platePresentation(currentSpans);

  // #1609 §1.9 — the composed VoiceOver label. Each clause is dropped when its value
  // is absent rather than rendered as a placeholder or a zero (Constitution rule 9),
  // so a card with no rating simply never mentions a rating.
  const composedCardAccessibilityLabel = [
    currentRec.title || t('cards:swipeable.experience'),
    getReadableCategoryName(currentRec.category),
    currentRec.rating != null && currentRec.rating > 0
      ? t('cards:swipeable.a11y_rating', { rating: currentRec.rating.toFixed(1) })
      : null,
    currentRec.distance != null
      ? t('cards:swipeable.a11y_distance', {
          distance: parseAndFormatDistance(currentRec.distance, accountPreferences?.measurementSystem),
        })
      : null,
    currentRec.travelTime != null
      ? t('cards:swipeable.a11y_travel_time', { travelTime: currentRec.travelTime })
      : null,
    currentRec.priceRange || null,
    isCurrentCardSaved ? t('cards:swipeable.a11y_saved') : null,
    isCurrentCardScheduled ? t('cards:swipeable.a11y_scheduled') : null,
  ]
    .filter((clause): clause is string => typeof clause === 'string' && clause.length > 0)
    .join('. ');

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        <View ref={coachDeckRef} collapsable={false} style={styles.cardContainer}>
          {isBoardSession && <NoGpsBanner participantPrefs={myParticipantPrefs} />}

          {/* ORCH-0474: Pipeline-error toast — only when stale cards remain
              visible. Deck continues to render underneath so the user can keep
              swiping what they have while they retry. Dismissible via retry. */}
          {showPipelineErrorToast && (
            <View
              style={styles.pipelineErrorToast}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Icon name="cloud-offline-outline" size={16} color="#FFFFFF" />
              <Text style={styles.pipelineErrorToastText} numberOfLines={2}>
                {t('cards:swipeable.pipeline_error_toast')}
              </Text>
              <TouchableOpacity
                onPress={() => refreshRecommendations(refreshKey)}
                accessibilityLabel={t('cards:swipeable.retry')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.pipelineErrorToastAction}>
                  {t('cards:swipeable.retry')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Swipe History overlay — appears after first swipe.
              ORCH-0991: renamed from the "{count} viewed" pill to a static "Swipe History"
              label, centered horizontally and sat in the empty center slot of the glass
              top bar (just below the status bar). top = safeArea.top + 10 aligns the chip
              vertically against the preferences/notifications buttons (button band
              safeArea.top+2 → +46, center +24). The center slot is empty here
              (sessionSwitcher={null} in HomePage), so it clears both buttons. */}
          {sessionSwipedCards.length > 0 && (
            <View
              style={[styles.batchChipWrap, { top: safeAreaInsets.top + 10 }]}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                style={styles.batchChip}
                onPress={() => setDismissedSheetVisible(true)}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="time-outline" size={14} color="#6b7280" />
                <Text style={styles.batchChipText}>
                  {t('cards:swipeable.swipe_history')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {showNextBatchLoader && (
            <View style={styles.nextBatchOverlay} pointerEvents="none">
              <PulseDots size={8} speed={400} />
            </View>
          )}

          <DeckSwipeStage
            ref={deckStageRef}
            {...deckSwipeStageOptions}
            transitionDelayAnnouncement={t('cards:swipeable.curating_lineup')}
            posterCards={[
              ...(nextRec ? [{
                id: nextRec.id,
                role: 'behind' as const,
                poster: (
                  <CardHeroImage
                    uri={nextRec.image}
                    style={styles.cardImage}
                    decodeTarget={heroDecodeTarget}
                  />
                ),
              }] : []),
              {
                id: currentRec.id,
                role: 'current' as const,
                poster: (
                  <CardHeroImage
                    uri={currentRec.image}
                    style={styles.cardImage}
                    decodeTarget={heroDecodeTarget}
                  />
                ),
              },
            ]}
            cardStyle={styles.card}
            nextCardStyle={styles.nextCard}
            cardInnerStyle={styles.cardInner}
            posterHeroStyle={[styles.heroFill, styles.posterHeroBackdrop]}
          >
          {(deckSwipe) => (
          <>
          {/* Next card is a poster-only, non-interactive continuity preview. */}
          {availableRecommendations.length > 1 &&
            (() => {
              const nextCard = availableRecommendations[1];
              // #1609 tester P1-1 — the behind face draws the same three
              // plate-anchored things the front face does (name, slivers, plate),
              // so it resolves the silhouette ONCE from the same predicate the
              // plate sizes itself with. Computing the spans once also keeps
              // metaSpansForCard off the promotion hot path twice over (#1481).
              const nextSpans = metaSpansForCard(nextCard, accountPreferences?.measurementSystem);
              const nextPresentation = platePresentation(nextSpans);

              return (
                <Reanimated.View
                  style={[
                    styles.card,
                    styles.nextCard,
                    styles.cardOverlay,
                    styles.behindCardOverlay,
                    deckSwipe.previewCardStyle,
                  ]}
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <View style={styles.cardInner}>
                  {/* #1609 — behind face is chrome only. The poster layer owns the
                      photo; this tree contributes the scrim + title so the promotion
                      diff stays small. No rail, no oneLiner (see pillar 1 §1.7). */}
                    <LinearGradient
                      colors={DECK_SCRIM_COLORS}
                      locations={DECK_SCRIM_LOCATIONS}
                      pointerEvents="none"
                      style={styles.heroScrim}
                    />

                    {/* #1609 amendment 4 — the top scrim. The behind face carries it too:
                        without it, a swipe would reveal a bright top band on the promoted
                        card exactly where the front card had a dark one, which reads as a
                        flash under the chrome on every single swipe. */}
                    <LinearGradient
                      colors={DECK_TOP_SCRIM_COLORS}
                      locations={DECK_TOP_SCRIM_LOCATIONS}
                      pointerEvents="none"
                      style={styles.topScrim}
                    />

                    {/* ORCH-0991: image-count badge removed from cards. */}

                    {/* #1609 Direction C — the behind face carries the name on the
                        photograph and the plate, exactly as the front face does.
                        The five GlassBadge chips are DELETED: they were five
                        BlurViews and five shadowed lifted objects per face, on a
                        face whose only job is continuity during a swipe.

                        No Been-here here — the preview is `pointerEvents="none"`,
                        and a control that cannot be pressed is a lie about
                        affordance (Rule L1). Share is inert for the same reason,
                        so the plate gets a no-op handler it can never reach. */}
                    <Text
                      style={[styles.cardTitle, { bottom: nextPresentation.titleBottom }]}
                      numberOfLines={S1.titleLines}
                      maxFontSizeMultiplier={MAX_FONT_SCALE.title}
                    >
                      {nextCard.title}
                    </Text>
                    {(nextCard as any).cardType === 'curated'
                      ? <CuratedSlivers plateH={nextPresentation.plateH} />
                      : null}
                    <DeckCardPlate
                      spans={nextSpans}
                      onSharePress={NOOP}
                      shareLabel={t('cards:swipeable.share_card', { title: nextCard.title })}
                    />
                  </View>
                  {deckSwipe.isTransitionDelayed && (
                    <View
                      style={styles.transitionDelayOverlay}
                      accessibilityRole="progressbar"
                      accessibilityLabel={t('cards:swipeable.curating_lineup')}
                    >
                      <PulseDots size={8} speed={400} reducedMotion={reducedMotion} />
                    </View>
                  )}
                </Reanimated.View>
              );
            })()}

          {/* Current Card */}
          {/* Each promoted face gets fresh native admission; all drag frames and
              transforms stay on the UI thread until discrete JS settlement. */}
          <GestureDetector key={currentRec.id} gesture={deckSwipe.gesture}>
          <Reanimated.View
            style={[
              styles.card,
              styles.cardOverlay,
              deckSwipe.currentCardStyle,
            ]}
          >
            <View style={styles.cardInner}>
            <View
              ref={cardAccessibilityRef}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              accessible
              accessibilityRole="button"
              // #1609 — the label was the RAW TITLE only: the poster nodes carry
              // accessibilityElementsHidden, so a VoiceOver user got no category,
              // rating, distance, price or state. Composed here instead, with each
              // clause omitted when its value is null (Constitution rule 9).
              accessibilityLabel={composedCardAccessibilityLabel}
              // The hint was a bare concatenation of the three action names,
              // "Save. PASS. More Details.", which also leaked the SHOUTING
              // cards:swipeable.pass string authored for the on-card swipe stamp.
              accessibilityHint={t('cards:swipeable.card_hint')}
              accessibilityActions={[
                { name: 'save', label: t('cards:expanded.save') },
                // NOT cards:swipeable.pass — that string is the uppercase on-card
                // stamp and must stay uppercase.
                { name: 'pass', label: t('cards:swipeable.pass_action') },
                { name: 'expand', label: t('cards:expanded.more_details') },
                // The rail Share sits beneath the `accessible` proxy and is otherwise
                // unreachable; the button ALSO carries its own label. Deliberately
                // redundant — both paths work.
                { name: 'share', label: t('cards:swipeable.share_action') },
              ]}
              onAccessibilityAction={(event) => {
                const action = event.nativeEvent.actionName;
                if (action === 'save' || action === 'pass') {
                  pendingAccessibilityFocusRef.current = true;
                  const accepted = deckSwipe.requestSwipe(
                    action === 'save' ? 'right' : 'left',
                  );
                  if (!accepted) pendingAccessibilityFocusRef.current = false;
                } else if (action === 'expand') {
                  deckSwipe.requestTapExpand();
                } else if (action === 'share') {
                  void handleShare();
                }
              }}
              onLayout={() => {
                if (!pendingAccessibilityFocusRef.current || !deckSwipe.isIdle()) return;
                const node = findNodeHandle(cardAccessibilityRef.current);
                if (node == null) return;
                pendingAccessibilityFocusRef.current = false;
                AccessibilityInfo.setAccessibilityFocus(node);
              }}
            />
            {/* Swipe Direction Overlays */}
            <Reanimated.View
              style={[
                styles.swipeOverlayRight,
                deckSwipe.likeIndicatorStyle,
              ]}
              pointerEvents="none"
            >
              <View style={styles.likeIndicator}>
                <Text style={styles.likeText} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                  {t('cards:swipeable.like')}
                </Text>
              </View>
            </Reanimated.View>

            <Reanimated.View
              style={[
                styles.swipeOverlayLeft,
                deckSwipe.passIndicatorStyle,
              ]}
              pointerEvents="none"
            >
              <View style={styles.passIndicator}>
                <Text style={styles.passText} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                  {t('cards:swipeable.pass')}
                </Text>
              </View>
            </Reanimated.View>

            <TouchableOpacity
              activeOpacity={1}
              onPress={() => deckSwipe.requestTapExpand()}
              accessible={false}
              style={StyleSheet.absoluteFill}
            >
              {(currentRec as any).cardType === 'experience' ? (
                  // ORCH-1065: brand experience reuses the curated multi-stop FACE
                  // with a brand badge + "Book" CTA (curated callers pass neither
                  // prop, so curated is byte-unaffected — SC-13).
                  <CuratedExperienceSwipeCard
                    card={currentRec as unknown as CuratedExperienceCard}
                    travelMode={effectiveTravelMode}
                    measurementSystem={accountPreferences?.measurementSystem}
                    currencyCode={accountPreferences?.currency || 'USD'}
                    // #1609 Direction C — the plate's control row. Passed IN as an
                    // element so the curated tree never imports SwipeableCards back.
                    beenHere={<BeenHereControl userId={user?.id} card={currentRec} />}
                    onSharePress={handleShare}
                    shareLabel={t('cards:swipeable.share_card', { title: currentRec.title })}
                    brandExperience={{
                      brandName: (currentRec as any).brandName,
                      brandLogoUrl: (currentRec as any).brandLogoUrl ?? null,
                    }}
                    // ORCH-1155 [public-brand-page]: brand badge → brand page.
                    // brandSlug is threaded end-to-end on the deck path; guard
                    // the empty slug (rule 9 — never nav to /b/).
                    onBrandPress={() => {
                      const s = (currentRec as any).brandSlug;
                      if (typeof s === 'string' && s.length > 0) {
                        router.push(`/b/${s}` as never);
                      }
                    }}
                    // ORCH-1072: real cover → card hero (image/video) with the
                    // stop photos as a strip below (CuratedExperienceSwipeCard).
                    experienceCover={{
                      coverMediaUrl: (currentRec as any).coverMediaUrl ?? null,
                      coverMediaType: (currentRec as any).coverMediaType ?? null,
                      coverHue: hueFromId(String((currentRec as any).eventId ?? (currentRec as any).id ?? '')),
                    }}
                    ctaOverride="Book"
                    // ORCH-1209: Current Card slot = the active front card, so it
                    // streams its cover video (parity with CardHero, I-1069). A
                    // future behind-card render MUST pass isTopCard={false}.
                    isTopCard={true}
                  />
              ) : (currentRec as any).cardType === 'curated' ? (
                  <CuratedExperienceSwipeCard
                    card={currentRec as unknown as CuratedExperienceCard}
                    travelMode={effectiveTravelMode}
                    measurementSystem={accountPreferences?.measurementSystem}
                    currencyCode={accountPreferences?.currency || 'USD'}
                    beenHere={<BeenHereControl userId={user?.id} card={currentRec} />}
                    onSharePress={handleShare}
                    shareLabel={t('cards:swipeable.share_card', { title: currentRec.title })}
                    // ORCH-1209: front-card render (curated cards carry no cover
                    // so this is a no-op today, kept for symmetry / future cover
                    // support). A behind-card render MUST pass isTopCard={false}.
                    isTopCard={true}
                  />
              ) : (
                <>
                  {/* #1609 — full-bleed hero. `heroFill` is StyleSheet.absoluteFillObject:
                      no flex-axis key, so it resolves to cardInner's box here AND in the
                      poster tree regardless of siblings. onLayout feeds the image DECODE
                      target only — it is never fed back as a layout input. */}
                  <View
                    style={styles.heroFill}
                    onLayout={({ nativeEvent }) => {
                      const { width, height } = nativeEvent.layout;
                      if (width !== heroLayout.width || height !== heroLayout.height) {
                        setHeroLayout({ width, height });
                      }
                    }}
                  >
                    {/* ORCH-1069: video-aware hero. isTopCard={true} → the top card
                        plays its `.mp4` cover (muted/looping) with the still as
                        poster; still-only venues render the unchanged image hero. */}
                    <CardHero
                      image={currentRec.image}
                      images={currentRec.images}
                      title={currentRec.title || t('cards:swipeable.experience')}
                      isTopCard={true}
                      style={styles.cardImage}
                      decodeTarget={heroDecodeTarget}
                    />
                  </View>

                  {/* #1609 Direction C — the scrim, BOTTOM-ANCHORED IN ABSOLUTE POINTS.
                      `height: '52%'` is deleted: a percentage makes the whole contrast
                      table valid only on the device it was computed on, and it also
                      carried the `isCurated` 52%/62% branch that let the place card and
                      the curated card drift apart. The height now comes from
                      scrimHeight() — 316pt at S1, giving alpha 0.7908 under the plate's
                      top edge and 0.481 at the title's top edge (3.73:1 against a
                      pure-white photo, floor 3.0 for 30/700 large text).
                      pointerEvents="none" — it must never take a touch off the pan. */}
                  <LinearGradient
                    colors={DECK_SCRIM_COLORS}
                    locations={DECK_SCRIM_LOCATIONS}
                    pointerEvents="none"
                    style={styles.heroScrim}
                  />

                  {/* #1609 amendment 4 — the top scrim. One LinearGradient per anchor,
                      NOT a third layered node: the top and bottom ramps never overlap
                      (200pt vs a band starting at 0.48 x cardHeight), so no pixel is ever
                      composited by both and the bottom ramp's WCAG numbers stay exact.
                      Alpha 0.45 is back-solved from the 3:1 SC 1.4.11 non-text floor
                      against a pure-white photo (minimum 0.416164) — the deck chrome sat
                      on bare photo at 1.02:1 to 1.26:1 in every delivered capture. */}
                  <LinearGradient
                    colors={DECK_TOP_SCRIM_COLORS}
                    locations={DECK_TOP_SCRIM_LOCATIONS}
                    pointerEvents="none"
                    style={styles.topScrim}
                  />

                  {/* ORCH-0991: image-count badge removed from cards. */}

                  {/* #1609 Direction C — the saved / scheduled state discs. They move
                      from a chip row at the card's foot to the TOP-RIGHT, on the top
                      scrim, because the foot is now the plate and the plate is not a
                      place for brand-coloured state. Same material as the plate, so the
                      card has exactly one glass vocabulary. */}
                  <CardStateDiscs
                    saved={isCurrentCardSaved}
                    scheduled={isCurrentCardScheduled}
                    savedLabel={t('cards:swipeable.saved')}
                    scheduledLabel={t('cards:swipeable.scheduled')}
                  />

                  {/* #1609 Direction C — the name, and NOTHING ELSE, on the photograph.
                      One animated node carries both the name and the plate, replacing
                      five per-badge `entryIndex`-staggered Animated.Views. That stagger
                      lived inside the promotion diff and is the exact shape that
                      produced #1576.

                      DELETED here, and each for a stated reason:
                        - the 5 GlassBadge chips  -> their content is the plate's meta line
                        - `oneLiner`              -> two lines of prose 9pt under the title
                                                     at identical colour is the single
                                                     largest contributor to register
                                                     flatness. It survives VERBATIM in
                                                     the expanded card.
                        - the action rail         -> moves onto the plate
                        - the "Details" text      -> replaced by the chevron in the
                                                     plate's divider */}
                  <Animated.View
                    style={[
                      styles.faceOverlay,
                      {
                        opacity: cardContentOpacity,
                        transform: [{ translateY: titleOverlaySlide }],
                      },
                    ]}
                    pointerEvents="box-none"
                  >
                    <Text
                      style={[styles.cardTitle, { bottom: currentPresentation.titleBottom }]}
                      numberOfLines={S1.titleLines}
                      maxFontSizeMultiplier={MAX_FONT_SCALE.title}
                    >
                      {currentRec.title || t('cards:swipeable.experience')}
                    </Text>

                    <DeckCardPlate
                      spans={currentSpans}
                      beenHere={<BeenHereControl userId={user?.id} card={currentRec} />}
                      onSharePress={handleShare}
                      shareLabel={t('cards:swipeable.share_card', { title: currentRec.title })}
                    />
                  </Animated.View>
                </>
              )}
            </TouchableOpacity>
            </View>
          </Reanimated.View>
          </GestureDetector>
          </>
          )}
          </DeckSwipeStage>
        </View>
      </View>
      {/* ORCH-1063: ExpandedCardModal / DismissedCardsSheet / CustomPaywallScreen
          are NO LONGER rendered here — they live in the single stable mount in
          the component's final return below. */}
    </View>
  );
  })();

  // ── Single stable overlay mount (ORCH-1063) ─────────────────────────────
  // ExpandedCardModal, DismissedCardsSheet, and CustomPaywallScreen are each
  // rendered EXACTLY ONCE here, as siblings of `deckBody`, OUTSIDE the
  // deck-state switch. No deck-state transition (AUTH_REQUIRED, PIPELINE_ERROR,
  // EMPTY↔EXHAUSTED↔LOADED, background refetch) can ever unmount/remount/swap
  // them now — only their `visible` prop changes — which fixes the production
  // freeze-after-close (a presented RN <Modal> being torn down mid-flight on a
  // real device left an invisible touch-capturing window). The ExpandedCardModal
  // prop set is the UNIFIED superset: the fuller main-deck props (onCardRemoved
  // + currentRec-matching onSave) PLUS the review-navigation props that drive the
  // EXHAUSTED "review dismissed → tap card" flow. The nav props auto-disable when
  // reviewCards is empty (reviewIndex 0, total 0 ⇒ both callbacks undefined), so
  // they are inert during normal deck expansion and active only while reviewing.
  return (
    <>
      {deckBody}
      <ExpandedCardModal
        visible={isExpandedModalVisible}
        // ORCH-0828: discriminated-union target. SwipeableCards surfaces Night
        // Out (place / TM) cards and — ORCH-1065 — brand experiences (which
        // route to the businessEvent branch → ExpandedBusinessEventSheet).
        target={
          expandedBrandExperience
            ? { kind: "businessEvent", data: expandedBrandExperience }
            : selectedCardForExpansion
            ? { kind: "nightOut", data: selectedCardForExpansion }
            : null
        }
        onClose={handleCloseExpandedModal}
        isSaved={
          selectedCardForExpansion
            ? savedCards.some(
                (savedCard) =>
                  savedCard?.id === selectedCardForExpansion.id ||
                  savedCard === selectedCardForExpansion.id
              )
            : false
        }
        currentMode={currentMode}
        onSave={async (card) => {
          try {
            // Save the card (same as swipe right)
            if (currentRec && card.id === currentRec.id) {
              // Add to removed cards
              setRemovedCards((prev) => {
                const newSet = new Set([...prev, card.id]);
                return newSet;
              });

              // Move to next card
              setCurrentCardIndex(0);

              // Handle swipe logic (tracking, saving, etc.) - await to catch errors.
              // ORCH-0532: handleSwipe now routes collab right-swipes through
              // collabSaveCard internally, so this path is quorum-safe.
              await handleSwipe("right", currentRec);
            } else {
              // ORCH-0532: fallback when expanded card doesn't match current deck card
              // (e.g., modal opened from a different list / the review-dismissed
              // sheet). In collab, route through shared helper to preserve quorum.
              // In solo, onCardLike = handleSaveCard.
              if (isBoardSession && resolvedSessionId && user?.id) {
                await collabSaveCard({
                  card: card as unknown as Recommendation,
                  sessionId: resolvedSessionId,
                  userId: user.id,
                  t,
                });
              } else {
                onCardLike?.(card);
              }
            }

            // Close the modal only on success
            handleCloseExpandedModal();
          } catch (error: any) {
            // Re-throw error so ActionButtons can handle it
            // If it's the "already saved" error (code 23505), we still want to close
            if (error?.code === "23505") {
              handleCloseExpandedModal();
            }
            throw error; // Re-throw so ActionButtons can show error message if needed
          }
        }}
        onPurchase={(card, bookingOption) => {
          onPurchaseComplete?.(card, bookingOption);
          handleCloseExpandedModal();
        }}
        onShare={(card) => {
          onShareCard?.(card);
        }}
        onCardRemoved={(cardId) => {
          // Remove card from deck when scheduled
          if (currentRec && cardId === currentRec.id) {
            setRemovedCards((prev) => {
              const newSet = new Set([...prev, cardId]);
              return newSet;
            });
            // Move to next card
            setCurrentCardIndex(0);
          }
        }}
        userPreferences={userPreferences}
        accountPreferences={accountPreferences}
        // ORCH-1064: review-navigation chrome shows ONLY when opened from swipe
        // history (isReviewMode). reviewCards is the whole session-swiped list, so
        // it is non-empty after any swipe — gating on it alone wrongly showed the
        // "X of Y" prev/next header on normal deck taps (the regression). All four
        // props are gated on isReviewMode (navigationIndex/Total too, because the
        // header also renders when those are non-null).
        onNavigateNext={isReviewMode && reviewIndex < reviewCards.length - 1 ? handleReviewNext : undefined}
        onNavigatePrevious={isReviewMode && reviewIndex > 0 ? handleReviewPrevious : undefined}
        navigationIndex={isReviewMode ? reviewIndex : undefined}
        navigationTotal={isReviewMode ? reviewCards.length : undefined}
        canAccessCurated={canAccess('curated_cards')}
        onPaywallRequired={() => {
          handleCloseExpandedModal();
          setPaywallFeature('curated_cards');
          setShowPaywall(true);
        }}
      />

      <DismissedCardsSheet
        visible={dismissedSheetVisible}
        onClose={() => setDismissedSheetVisible(false)}
        dismissedCards={dismissedCards}
        sessionSwipedCards={sessionSwipedCards}
        collabDismissedRows={collabDismissedRows}
        onSave={handleSaveDismissedCard}
        onCardPress={handleDismissedCardPress}
      />

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    width: "100%",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 2,
    paddingBottom: 8,
  },
  // ORCH-0589 v3 (R4) + v4 (V1): full-bleed horizontally; v4 adds paddingBottom 12
  // so there's a visible gap between the card's rounded bottom and the floating nav.
  cardContainer: {
    width: SCREEN_WIDTH,
    maxWidth: 500,
    position: "relative",
    flex: 1,
    paddingTop: 0,
    paddingBottom: 12,
    paddingHorizontal: 0,
  },
  // ORCH-0589 v4 (V1): iPhone-bezel-matched corner radius + subtle drop shadow
  // so the card reads as "living inside" the phone frame instead of a flat rectangle.
  // Radius token sourced from glass.card.bezelRadius (40pt). Shadow gives a gentle
  // lift against the dark safeArea backdrop.
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "white",
    borderRadius: glass.card.bezelRadius,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 2,
  },
  cardOverlay: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    zIndex: 3,
    elevation: 3,
  },
  behindCardOverlay: {
    zIndex: 1,
    elevation: 1,
  },
  // ORCH-0589 v4 (V1): borderRadius matches the outer card so overflow clips cleanly
  // against the bezel-matched corners. `overflow: hidden` needed so the hero photo +
  // cardDetails white strip both clip to the rounded silhouette.
  cardInner: {
    flex: 1,
    borderRadius: glass.card.bezelRadius,
    overflow: "hidden",
  },
  nextCard: {
    zIndex: 1,
  },
  transitionDelayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  // #1609 — the full-bleed hero box, used by BOTH the poster tree and the face tree.
  // absoluteFillObject has NO flex-axis key, so it resolves to cardInner's box in both
  // trees regardless of how many siblings each has. That is what makes the two layers
  // structurally incapable of disagreeing (#1593), with no measurement pass at all.
  heroFill: {
    ...StyleSheet.absoluteFillObject,
  },
  // Fallback canvas under a failed decode. Only the poster tree paints it; the face
  // tree's hero stays transparent so the poster shows through.
  posterHeroBackdrop: {
    backgroundColor: '#1a1a2e',
  },
  // ORCH-0589 v3 (R4): full-bleed image, no corner radii.
  cardImage: {
    width: "100%",
    height: "100%",
  },
  matchBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "white",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  matchText: {
    color: "#1f2937",
    fontSize: 13,
    fontWeight: "600",
  },
  // ORCH-0589 v2 (G4): more breathing room — premium rhythm.
  // paddingBottom 24 → 40, cardTitle marginBottom 12 → 16.
  // #1609 — 4pt grid. paddingHorizontal 20 / paddingBottom 28 (was a uniform 20 with
  // paddingBottom 40; the tray no longer eats the card's foot, so the overlay sits
  // lower and needs less bottom inset).
  // #1609 Direction C — the face overlay is an absolute FILL whose two children
  // (the name and the plate) are each bottom-anchored in absolute points. It has
  // no padding and no flow layout of its own, so nothing on the face can shift
  // because a sibling's content changed. `box-none` so it never takes a touch
  // off the pan — only the plate's own controls are pressable.
  faceOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  // 30/700, not 24/700. At 24 the title had no register separation from the 15pt
  // blurb below it — and the blurb is now deleted, so the name is the ONLY thing
  // on the photograph and carries the whole first-glance read. 2 lines is the
  // only multi-line element on the card face; `flexWrap` appears nowhere.
  // #1609 tester P1-1 — `bottom` IS DELIBERATELY ABSENT. It was
  // `S1.bottomInset + S1.plateH + S1.gap`, a module-load constant that is only
  // correct for the 96pt silhouette; in the short one it left the name stranded
  // above a plate it is supposed to sit 20pt above, with a band of dead
  // scrim between them. It is now applied at each render site from
  // `platePresentation(spans).titleBottom`. Do not put it back — StyleSheet.create
  // is evaluated once per module and this value is per render.
  cardTitle: {
    position: "absolute",
    left: S1.titleInset,
    right: S1.titleInset,
    color: "#FFFFFF",
    fontSize: S1.titleSize,
    fontWeight: S1.titleWeight as "700",
    lineHeight: S1.titleLH,
    zIndex: 2,
    // Perceptual reinforcement only — it does NOT count toward WCAG and none of
    // the scrim derivation relies on it.
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // #1609 Direction C — replaces `height: '52%'`. Bottom-anchored in ABSOLUTE
  // POINTS from the package's scrimHeight(): no percentage, no flex-axis key, so
  // the layer depends neither on a sibling nor on the parent's resolved height,
  // and the contrast table is device-invariant rather than valid only on the
  // device it was computed on. Deleting the percentage also deletes the
  // `isCurated` 52%/62% branch — curated is NOT a different composition.
  heroScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: DECK_BOTTOM_SCRIM_HEIGHT_PT,
    zIndex: 1,
  },
  // #1609 amendment 4 — the TOP scrim, the mirror of heroScrim. Sized in ABSOLUTE
  // POINTS because the chrome it protects (GlassTopBar's 44pt button row at
  // safeAreaTop + 2, and the "Swipe History" pill) is itself laid out in absolute
  // points. No flex-axis key and no percentage, so it depends neither on siblings nor
  // on the parent's resolved height. Alpha is back-solved from the 3:1 SC 1.4.11
  // non-text floor against a pure-white photo — see DECK_TOP_SCRIM_COLORS.
  topScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: DECK_TOP_SCRIM_HEIGHT_PT,
    zIndex: 1,
  },
  // #1609 Direction C — `oneLiner`, `detailsBadges` and `stateBadgesRow` are
  // DELETED from the card face (Constitution 8: subtract before adding).
  //   - `oneLiner` (the place pitch blurb) survives VERBATIM in the expanded
  //     card. Two lines of prose 9pt under the title at identical colour was the
  //     single largest contributor to the face's register-flatness.
  //   - `detailsBadges` was one of the two `flexWrap` containers on the face;
  //     `flexWrap` now appears NOWHERE on the card face, which is what makes the
  //     silhouette guarantee hold.
  //   - `stateBadgesRow`'s saved/scheduled chips become the top-right state
  //     discs (see CardStateDiscs), on the top scrim rather than at the foot.
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    marginTop: 4,
  },
  addressText: {
    color: "#6b7280",
    fontSize: 13,
    flex: 1,
  },
  actionButtons: {
    position: "absolute",
    bottom: 0,
    left: 5,
    right: 25,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  buyButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eb7825",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  buyButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  rightButtons: {
    flexDirection: "column",
    gap: 8,
  },
  actionButton: {
    width: 48,
    height: 48,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  // #1609 Direction C — `actionRail`, `railHint`, `railHintText` and `railActions`
  // are DELETED. The rail sat on bare scrim; its two controls move onto the
  // plate's control row, and its left-hand "Details" signifier is replaced by the
  // chevron that BREAKS THE PLATE'S DIVIDER — the affordance is now part of the
  // object's construction rather than a sticker on it. Zero gesture owners either
  // way; the whole card is the expand target and routes through requestTapExpand.
  //
  // #1609 Amendment 1 — the Been-here control. 44pt tall so the whole control
  // clears touchTargets.minimum without relying on hitSlop, and it sits INBOARD
  // OF BOTH card edges on the plate, so neither edge (where a swipe begins) is a
  // mis-tap surface. Its fill and border are per-STATE and come from
  // beenHereStateStyle() — see @mingla/card-identity BEEN_HERE.
  //
  // THE BORDER IS LOAD-BEARING. The control sits ON the plate and its fill is the
  // same family as the plate's, so the boundary is carried by the border alone:
  // the minimum white border alpha for a 3:1 boundary against the plate is 0.349,
  // which is why the shipped 0.46 is not negotiable down to the 0.30 the chips
  // used (that measures 2.46:1 and fails — NOT 2.54:1, which the spec's §3.2 and
  // this comment both carried. The shipped oracle in card_identity_single_source
  // T-4 and the tester's independent re-derivation agree on 2.4648. Below the 3.0
  // floor either way, so nothing downstream changes — but a negative control that
  // states the wrong number is a control nobody can check against).
  beenHere: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
  },
  highlightsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  highlightBadge: {
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  highlightText: {
    fontSize: 12,
    color: "#eb7825",
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#f9fafb",
  },
  loadingContent: {
    alignItems: "center",
    gap: 24,
    maxWidth: 320,
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff7ed",
    justifyContent: "center",
    alignItems: "center",
  },
  loaderTextGroup: {
    alignItems: "center",
    gap: 6,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  skeletonLoadingText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    marginTop: 12,
  },
  loaderSubtitle: {
    fontSize: 14,
    fontWeight: "400",
    color: "#6b7280",
    textAlign: "center",
  },
  batchTransitionText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#4b5563",
    textAlign: "center",
  },
  nextBatchOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 60,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.55)",
  },
  noCardsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  noCardsContent: {
    alignItems: "center",
    gap: 12,
  },
  emptyDeckContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  emptyDeckContent: {
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
    gap: 6,
  },
  emptyDeckIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fef3e2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  emptyDeckTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
  emptyDeckSubtitle: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 8,
  },
  // ORCH-1058: guidance line sits below the chip row with breathing room.
  emptyDeckGuidance: {
    marginTop: 8,
  },
  emptyDeckActions: {
    width: "100%",
    gap: 8,
  },
  emptyDeckButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#eb7825",
  },
  emptyDeckButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  emptyDeckOutlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eb7825",
  },
  emptyDeckOutlineButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  emptyDeckHint: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.55)",
    textAlign: "center",
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 4,
  },
  noCardsIcon: {
    width: 64,
    height: 64,
    backgroundColor: "#fef2f2",
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  noCardsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
  noCardsSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  emptyPoolButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#111827',
    borderRadius: 12,
  },
  emptyPoolButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  startOverButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  startOverButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  swipeOverlayRight: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  swipeOverlayLeft: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  likeIndicator: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.primary[700],
  },
  likeText: {
    ...typography.lg,
    fontWeight: fontWeights.bold,
    color: colors.primary[700],
    letterSpacing: 0,
    textAlign: 'center',
  },
  passIndicator: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.gray[600],
  },
  passText: {
    ...typography.lg,
    fontWeight: fontWeights.bold,
    color: colors.gray[600],
    letterSpacing: 0,
    textAlign: 'center',
  },
  swipeInstructions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  swipeInstruction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  swipeInstructionText: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
  },
  generateNextButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    marginTop: 20,
    width: "100%",
    justifyContent: "center",
  },
  generateNextButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 8,
  },
  reviewBatchButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#eb7825",
    marginTop: 10,
    width: "100%",
    justifyContent: "center",
  },
  reviewBatchButtonText: {
    color: "#eb7825",
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 6,
  },
  changePrefsLink: {
    marginTop: 16,
  },
  changePrefsLinkText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  batchHistorySection: {
    marginTop: 16,
    width: "100%",
  },
  batchHistoryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
    marginBottom: 8,
    textAlign: "center",
  },
  batchHistoryItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: 6,
  },
  batchHistoryItemActive: {
    backgroundColor: "#10B981",
  },
  batchHistoryItemText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
  },
  batchHistoryItemTextActive: {
    color: "#ffffff",
    fontWeight: "600",
  },
  batchChipWrap: {
    // ORCH-0991: full-width positioned wrapper so the content-sized chip centers
    // horizontally. `top` set at runtime via inline style using safeAreaInsets.top + 10
    // so the chip sits in the empty center slot of the glass top bar.
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 20,
    alignItems: "center",
  },
  batchChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  batchChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },
  // ORCH-0474: Pipeline-error toast overlay (shown above cards when stale
  // cards are still visible and server threw on refresh). Non-blocking —
  // user can keep swiping; tapping "Retry" re-fires the deck fetch.
  pipelineErrorToast: {
    position: "absolute",
    top: 56,
    left: 16,
    right: 16,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  pipelineErrorToastText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
  },
  pipelineErrorToastAction: {
    color: "#eb7825",
    fontSize: 13,
    fontWeight: "600",
  },
  savedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(235, 120, 37, 0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  savedBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
  scheduledBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(99, 102, 241, 0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  scheduledBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
});
