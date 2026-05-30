/**
 * DiscoverScreen — Tinder-Explore glass events surface (ORCH-0590 Phase 3).
 *
 * Dark-glass, single-purpose concerts & events browser. Large "Discover" title hugs
 * the status bar and collapses on scroll; a frosted sticky header capsule fades in
 * at threshold (44px). Below it, a pinned filter chip row (All / Tonight / This
 * Weekend / Next Week / This Month / More). Below that, a 2-col grid of full-bleed
 * photo cards with a glass info chip at the bottom of each.
 *
 * Zero white surfaces. Orange is accent-only (active chip, saved heart, primary CTA).
 * Every glass layer has a Reduce-Transparency / Android<31 solid-tile fallback.
 * Scroll-linked animation via Reanimated v4; discrete animation via RN Animated.
 *
 * Design: Mingla_Artifacts/outputs/DESIGN_ORCH-0590_PHASE2_DISCOVER_TINDER_EXPLORE_SPEC.md
 * Tokens: designSystem.ts → glass.discover.* (+ reused glass.chrome.active.*)
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCoachMark } from "../hooks/useCoachMark";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Pressable,
  AppState,
  Platform,
  AccessibilityInfo,
  RefreshControl,
  Dimensions,
  Animated as RNAnimated,
  Easing as RNEasing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
// META-ORCH-0991 Bug 3a (intermittent card tap): the Discover grid lives inside
// the screen-level RN <ScrollView>, which steals a child Pressable's tap on the
// slightest finger drift. An RNGH Tap gesture with a generous `maxDistance`
// keeps firing for small drift while a clear drag still scrolls. RNGH is already
// a dependency (v2.28.0).
import { Gesture, GestureDetector } from "react-native-gesture-handler";
// ORCH-0839-A F-4: AsyncStorage import removed — mobile cache deleted; server caches authoritatively.
import { Icon, type IconName } from "./ui/Icon";
import { formatPriceRange, parseAndFormatDistance } from "./utils/formatters";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
// ORCH-0828: discriminated-union expansion target
import type { ExpansionTarget } from "../types/expansion";
import { NightOutExperiencesService, NightOutVenue } from "../services/nightOutExperiencesService";
// ORCH-0824: merged Discover types + business-event card.
import type {
  BusinessEventCard as BusinessEventCardData,
  MergedDiscoverItem,
} from "../types/mergedDiscover";
import { BusinessEventCard } from "./discover/BusinessEventCard";
import { useAppStore } from "../store/appStore";
// ORCH-1016 — Events/Trips pill + Trips feed content.
import { mixpanelService } from "../services/mixpanelService";
import { TripsContent } from "./discover/TripsContent";
import type { DiscoverTripRow } from "../services/tripsDiscoveryService";
import { useTabScrollRegistry } from "../hooks/useTabScrollRegistry";
import { useUserLocation } from "../hooks/useUserLocation";
import { enhancedLocationService } from "../services/enhancedLocationService";
import { useFeatureGate, GatedFeature } from "../hooks/useFeatureGate";
import { CustomPaywallScreen } from "./CustomPaywallScreen";
import { useSavedCards } from "../hooks/useSavedCards";
import { savedCardsService } from "../services/savedCardsService";
import { savedCardKeys } from "../hooks/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../constants/designSystem";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";

// META-ORCH-0991 Wave B Batch 5: fixed snap translated from the old filter
// modal's `maxHeight: "85%"`.
const FILTER_SNAP_POINTS = ["85%"] as const;
// ORCH-0809 M2: city picker + segment switcher
import { CityPickerSheet } from "./discover/CityPickerSheet";
import {
  type DiscoverSegmentSlug,
  type DiscoverGenreSlug,
  type DiscoverCity,
  GENRES_BY_SEGMENT,
} from "../types/discoverFilters";
import { geocodingService } from "../services/geocodingService";
import { PreferencesService } from "../services/preferencesService";
// ORCH-0996: paint-first, full-signature in-memory cache (NOT the ORCH-0839-A
// AsyncStorage cache — see discoverEventsCache.ts header for why C-1 can't recur).
import {
  buildDiscoverCacheKey,
  readDiscoverCache,
  isDiscoverCacheFresh,
  writeDiscoverCache,
  decideDiscoverFetchMode,
  writeResolvedDiscoverCity,
  readResolvedDiscoverCity,
  readLastResolvedDiscoverCity,
  type DiscoverCacheSignature,
} from "../utils/discoverEventsCache";

// ORCH-0839-A F-4: cache-key prefix const removed — mobile cache deleted.
const SCREEN_WIDTH = Dimensions.get("window").width;
const d = glass.discover;
const GRID_CARD_WIDTH = (SCREEN_WIDTH - d.grid.horizontalPadding * 2 - d.grid.columnGap) / 2;
const GRID_CARD_HEIGHT = GRID_CARD_WIDTH / d.card.aspectRatio;
// META-ORCH-1002 Sub-1 (S2): shared Android-opaque-fallback gate (was the per-component Android-11 version gate).
const isAndroidPreBlur = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
// META-ORCH-0991 Bug 3b: neutral dark blurhash shown under a Ticketmaster card
// image while it decodes (expo-image placeholder) so the cell is never an empty
// flash on Android. A flat charcoal hash matches the cards' dark hero treatment.
const TM_CARD_BLURHASH = "L02rs;fQfQfQfQfQfQfQfQfQfQfQ";

interface NightOutCardData {
  id: string;
  eventName: string;
  artistName: string;
  venueName: string;
  image: string;
  images?: string[];
  price: string;
  priceMin: number | null;
  priceMax: number | null;
  date: string;
  time: string;
  localDate: string;
  location: string;
  tags: string[];
  genre?: string;
  subGenre?: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  ticketUrl: string;
  ticketStatus: string;
  distance?: number;
}

type DateFilter = "any" | "today" | "tomorrow" | "weekend" | "next-week" | "month";
// ORCH-0809 M2: Price filter deleted from Discover (TM has no price query param;
// reintroduction is a separate ORCH when Mingla Business native events land in Discover).
// Genre slugs sourced from the shared DiscoverGenreSlug union (server-owned classification).
type GenreFilter = DiscoverGenreSlug;
type SegmentFilter = DiscoverSegmentSlug;

interface NightOutFilters {
  date: DateFilter;
  segment: SegmentFilter;
  genre: GenreFilter;
  // ORCH-0824: Mingla-native facets. When non-empty, the merged endpoint
  // applies array-overlap filtering on business events; when partyTypes
  // OR vibeTags has any selection, Ticketmaster is suppressed entirely
  // (I-PROPOSED-DISCOVER-TM-SUPPRESSION).
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
}

// ORCH-0809 M2: GENRE_TO_KEYWORDS map removed. Genre filtering now uses real Ticketmaster
// `genreId` classification IDs resolved server-side by `resolveTmClassification` in
// `supabase/functions/_shared/ticketmasterClassifications.ts`. Slugs cross the wire as
// `segmentSlug` + `genreSlugs[]`. Genre IDs ship as the operator runs the TM
// `/classifications` verification curl (see SPEC §5.3 + M1 implementation report).

/**
 * ORCH-0809 M2: returns the Ticketmaster `localStartEndDateTime` query value for
 * the active date chip, computed in the user's device-local timezone. Format is
 * TM's local-time pair `"YYYY-MM-DDTHH:mm:ss,YYYY-MM-DDTHH:mm:ss"` (no trailing
 * `Z`, no timezone offset suffix). Returns null for the "any" chip.
 *
 * Local-time math means "Tonight" at 11:55 PM local still includes 11:56 PM
 * events; "This Weekend" on Sat 11:00 PM still includes Sat late shows even
 * though UTC has already rolled to Sunday. Replaces the prior UTC `toISOString`
 * helper.
 */
/**
 * ORCH-0828: empty-state headline that matches the active date filter.
 * Pre-0828 the title was hard-wired to "No events near you tonight"
 * regardless of filter, which lied when the user had "All" selected.
 *
 * English-only override. Non-English locales fall back to the canonical
 * `discover:empty.no_events_title` until translations catch up.
 */
function getEmptyStateHeadline(
  filter: DateFilter,
  t: (key: string) => string,
): string {
  const fallback = t("discover:empty.no_events_title");
  // Heuristic: only override when the canonical English string is what
  // the runtime returned (i.e. user is on en-* locale). Other locales
  // keep the existing translation until a future pass.
  if (!fallback.toLowerCase().includes("no events near you")) {
    return fallback;
  }
  switch (filter) {
    case "any":
      return "No events near you";
    case "today":
      return "No events near you tonight";
    case "tomorrow":
      return "No events near you tomorrow";
    case "weekend":
      return "No events near you this weekend";
    case "next-week":
      return "No events near you next week";
    case "month":
      return "No events near you this month";
    default: {
      // Exhaustiveness check — compile-time error if a new DateFilter
      // variant is added without updating this switch.
      const _exhaustive: never = filter;
      void _exhaustive;
      return fallback;
    }
  }
}

function getDateRange(filter: DateFilter): { localStartEndDateTime: string | null } {
  const now = new Date();
  const toLocalISO = (d: Date): string => {
    const pad = (n: number): string => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const startOfDay = (d: Date): Date => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (d: Date): Date => {
    const copy = new Date(d);
    copy.setHours(23, 59, 59, 0);
    return copy;
  };
  const pair = (start: Date, end: Date): string =>
    `${toLocalISO(start)},${toLocalISO(end)}`;

  switch (filter) {
    case "any":
      return { localStartEndDateTime: null };
    case "today":
      return { localStartEndDateTime: pair(now, endOfDay(now)) };
    case "tomorrow": {
      const tmrw = new Date(now);
      tmrw.setDate(tmrw.getDate() + 1);
      return { localStartEndDateTime: pair(startOfDay(tmrw), endOfDay(tmrw)) };
    }
    case "weekend": {
      // ORCH-0839-A F-3.a: the `(5 - dow + 7) % 7 || 7` math was correct
      // for dow ∈ {1,2,3,4,6} but broke on dow=5 (Friday) where
      // `(5-5+7)%7 = 0` is falsy and the `|| 7` clause advances `friday`
      // to NEXT Friday, sending "This Weekend" to next weekend on every
      // Friday morning. Explicit `dow === 5 ? 0 : …` fixes it. dow=0 and
      // dow=6 are short-circuited below (now-through-Sunday window).
      const dayOfWeek = now.getDay();
      const daysUntilFri = dayOfWeek === 5 ? 0 : (5 - dayOfWeek + 7) % 7;
      const friday = new Date(now);
      friday.setDate(friday.getDate() + (dayOfWeek <= 5 && dayOfWeek > 0 ? daysUntilFri : 0));
      friday.setHours(18, 0, 0, 0);
      const sunday = new Date(friday);
      sunday.setDate(sunday.getDate() + 2);
      sunday.setHours(23, 59, 59, 0);
      if (dayOfWeek === 0 || dayOfWeek === 6 || (dayOfWeek === 5 && now.getHours() >= 18)) {
        return { localStartEndDateTime: pair(now, sunday) };
      }
      return { localStartEndDateTime: pair(friday, sunday) };
    }
    case "next-week": {
      // ORCH-0839-A F-3.b: `(8 - dow) % 7` on dow=1 (Monday) returns 0,
      // no advance, current week instead of next week. Explicit
      // `dow === 1 ? 7 : …` fixes it. dow=0 (Sunday) `(8-0)%7 = 1` → +1
      // day = Monday, correct. dow=2..6 also correct via the modulo.
      const dayOfWeek = now.getDay();
      const daysUntilNextMon = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
      const monday = new Date(now);
      monday.setDate(monday.getDate() + daysUntilNextMon);
      monday.setHours(0, 0, 0, 0);
      const nextSunday = new Date(monday);
      nextSunday.setDate(nextSunday.getDate() + 6);
      nextSunday.setHours(23, 59, 59, 0);
      return { localStartEndDateTime: pair(monday, nextSunday) };
    }
    case "month":
    default: {
      const monthLater = new Date(now);
      monthLater.setDate(monthLater.getDate() + 30);
      monthLater.setHours(23, 59, 59, 0);
      return { localStartEndDateTime: pair(now, monthLater) };
    }
  }
}

// Shortens card.localDate (YYYY-MM-DD) to a human-friendly tag. Returns "" if input falsy.
function formatShortDate(localDate: string | undefined, time: string | undefined): string {
  if (!localDate) return time || "";
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tmrw = new Date(today);
    tmrw.setDate(tmrw.getDate() + 1);
    const parts = localDate.split("-");
    if (parts.length !== 3) return localDate;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return localDate;
    const target = new Date(year, month, day);
    target.setHours(0, 0, 0, 0);
    if (target.getTime() === today.getTime()) return "Tonight";
    if (target.getTime() === tmrw.getTime()) return "Tomorrow";
    const weekday = target.toLocaleDateString(undefined, { weekday: "short" });
    const monthLabel = target.toLocaleDateString(undefined, { month: "short" });
    return `${weekday} · ${monthLabel} ${day}`;
  } catch {
    return localDate;
  }
}

interface DiscoverScreenProps {
  isTabVisible?: boolean;
  onOpenChatWithUser?: (userId: string) => void;
  onViewFriendProfile?: (userId: string) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  preferencesRefreshKey?: number;
  deepLinkParams?: Record<string, string> | null;
  onDeepLinkHandled?: () => void;
  onOpenPreferences?: () => void;
  onOpenSession?: (sessionId: string) => void;
  // ORCH-1016 — open a trip's in-app detail overlay (host owns the viewingTrip slot).
  onOpenTrip?: (seed: import("../services/tripsDiscoveryService").DiscoverTripRow) => void;
}

// ============================================================================
// Sub-components (module-local)
// ============================================================================

interface EventGridCardProps {
  card: NightOutCardData;
  currency?: string;
  isSaved: boolean;
  onPress: () => void;
  onSaveToggle: () => void;
  reduceTransparency: boolean;
  reduceMotion: boolean;
}

const EventGridCard: React.FC<EventGridCardProps> = ({
  card,
  currency = "USD",
  isSaved,
  onPress,
  onSaveToggle,
  reduceTransparency,
  reduceMotion,
}) => {
  const useGlass = !reduceTransparency && !isAndroidPreBlur;
  const pressScale = useRef(new RNAnimated.Value(1)).current;
  const heartScale = useRef(new RNAnimated.Value(1)).current;
  // META-ORCH-0991 Bug 3b: expo-image on Android silently shows nothing on a
  // failed decode and never retries. Track an error so the card falls back to a
  // dark band (the gradient + chip stay legible) instead of a blank cell. Reset
  // when the image URL changes (recycled card cell).
  const [hasImageError, setHasImageError] = useState(false);
  useEffect(() => {
    setHasImageError(false);
  }, [card.image]);

  // META-ORCH-0991 Bug 3a: wrapped in useCallback so the RNGH tap gestures below
  // memoize stably (a gesture rebuilt every render can drop an in-flight tap).
  const handlePressIn = useCallback((): void => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    if (reduceMotion) return;
    RNAnimated.timing(pressScale, {
      toValue: d.card.pressScale,
      duration: d.card.pressDurationMs,
      easing: RNEasing.out(RNEasing.quad),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, pressScale]);
  const handlePressOut = useCallback((): void => {
    if (reduceMotion) return;
    RNAnimated.timing(pressScale, {
      toValue: 1,
      duration: d.card.pressDurationMs,
      easing: RNEasing.out(RNEasing.quad),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, pressScale]);

  const handleSavePress = useCallback((): void => {
    if (Platform.OS === "ios") {
      if (!isSaved) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    }
    onSaveToggle();
    if (reduceMotion) return;
    RNAnimated.sequence([
      RNAnimated.spring(heartScale, {
        toValue: d.motion.saveBounce.maxScale,
        damping: d.motion.saveBounce.damping,
        stiffness: d.motion.saveBounce.stiffness,
        useNativeDriver: true,
      }),
      RNAnimated.spring(heartScale, {
        toValue: 1,
        damping: d.motion.saveBounce.damping,
        stiffness: d.motion.saveBounce.stiffness,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isSaved, onSaveToggle, reduceMotion, heartScale]);

  const formattedPrice = formatPriceRange(card.price, currency);
  const displayPrice = formattedPrice || card.price || "";
  const dateTag = formatShortDate(card.localDate, card.time);
  const isSoldOut = card.ticketStatus === "offsale";
  const topBadgeLabel: string | null = isSoldOut
    ? "SOLD OUT"
    : card.ticketStatus === "presale"
    ? "SOON"
    : card.genre
    ? card.genre.toUpperCase()
    : null;

  const accLabel = `${card.eventName}, ${dateTag}, ${card.venueName}${displayPrice ? `, ${displayPrice}` : ""}`;

  // META-ORCH-0991 Bug 3a: the save-heart tap (a small top-right region) must win
  // in its area; the rest of the card opens the event. Both are RNGH Tap gestures
  // tolerant of ~16px drift (the parent ScrollView no longer steals a near-static
  // tap). `cardTapGesture.requireExternalGestureToFail(saveTapGesture)` makes the
  // open-tap defer to the save-tap so a tap on the heart never ALSO opens the card.
  const saveTapGesture = useMemo(
    () => Gesture.Tap().maxDistance(16).maxDuration(500).runOnJS(true).onEnd(handleSavePress),
    [handleSavePress],
  );
  const cardTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(16)
        .maxDuration(500)
        .runOnJS(true)
        .onBegin(handlePressIn)
        .onFinalize(handlePressOut)
        .onEnd(onPress)
        .requireExternalGestureToFail(saveTapGesture),
    [onPress, handlePressIn, handlePressOut, saveTapGesture],
  );

  return (
    <RNAnimated.View style={[styles.cardOuter, { transform: [{ scale: pressScale }] }]}>
      <GestureDetector gesture={cardTapGesture}>
      <View
        style={styles.cardPressable}
        accessibilityRole="button"
        accessibilityLabel={accLabel}
        accessibilityHint="Double tap to view details"
      >
        {/* L0/L1 — photo — META-ORCH-0991 Bug 3b: placeholder while loading,
            onError → dark-band fallback (never a blank cell), and a stable
            recyclingKey so a recycled cell never shows the previous card's
            image. cachePolicy already memory-disk. */}
        {hasImageError ? (
          <View style={[StyleSheet.absoluteFill, styles.cardImageFallback]} />
        ) : (
          <ExpoImage
            source={{ uri: card.image }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            recyclingKey={card.id}
            placeholder={{ blurhash: TM_CARD_BLURHASH }}
            placeholderContentFit="cover"
            onError={() => setHasImageError(true)}
          />
        )}

        {/* L2 — bottom gradient overlay */}
        <LinearGradient
          colors={[d.card.gradient.from, d.card.gradient.to]}
          start={{ x: 0.5, y: d.card.gradient.startY }}
          end={{ x: 0.5, y: d.card.gradient.endY }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* L3 — top-left badge */}
        {topBadgeLabel ? (
          <View
            style={[
              styles.cardTopBadge,
              isSoldOut ? { borderColor: d.card.topBadge.soldOutBorder } : null,
            ]}
          >
            {useGlass ? (
              <BlurView
                intensity={d.card.topBadge.blurIntensity}
                tint="dark"
                experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: useGlass
                    ? d.card.topBadge.tint
                    : d.card.topBadge.fallbackSolid,
                },
              ]}
            />
            <Text style={styles.cardTopBadgeLabel} allowFontScaling={false}>
              {topBadgeLabel}
            </Text>
          </View>
        ) : null}

        {/* L4 — save heart (top-right) — META-ORCH-0991 Bug 3a: RNGH tap so it
            coordinates with the card-open tap (the card-open gesture defers to
            this via requireExternalGestureToFail) and the parent ScrollView. */}
        <GestureDetector gesture={saveTapGesture}>
        <View
          style={styles.cardSaveButtonWrap}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? `Saved ${card.eventName}` : `Save ${card.eventName}`}
          accessibilityState={{ selected: isSaved }}
        >
          <RNAnimated.View
            style={[
              styles.cardSaveButton,
              { transform: [{ scale: heartScale }] },
              isSaved
                ? {
                    backgroundColor: useGlass
                      ? glass.chrome.active.tint
                      : d.card.saveButton.active.fallbackSolid,
                    borderColor: glass.chrome.active.border,
                    shadowColor: glass.chrome.active.glowColor,
                    shadowOpacity: 0.35,
                    shadowRadius: 10,
                    elevation: 4,
                  }
                : {
                    backgroundColor: useGlass
                      ? "transparent"
                      : d.card.saveButton.inactive.fallbackSolid,
                    borderColor: d.card.saveButton.inactive.border,
                  },
            ]}
          >
            {useGlass && !isSaved ? (
              <>
                <BlurView
                  intensity={d.card.saveButton.blurIntensity}
                  tint="dark"
                  experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
                  style={StyleSheet.absoluteFill}
                />
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: d.card.saveButton.inactive.tint, borderRadius: d.card.saveButton.radius },
                  ]}
                />
              </>
            ) : null}
            <Icon
              name={isSaved ? "heart" : "heart-outline"}
              size={d.card.saveButton.iconSize}
              color={
                isSaved
                  ? (useGlass
                      ? d.card.saveButton.active.iconColor
                      : d.card.saveButton.active.fallbackIconColor)
                  : d.card.saveButton.inactive.iconColor
              }
            />
          </RNAnimated.View>
        </View>
        </GestureDetector>

        {/* L5 — bottom info chip */}
        <View style={styles.cardBottomChip}>
          {useGlass ? (
            <BlurView
              intensity={d.card.bottomChip.blurIntensity}
              tint="dark"
              experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: useGlass
                  ? d.card.bottomChip.tint
                  : d.card.bottomChip.fallbackSolid,
                borderRadius: d.card.bottomChip.radius,
              },
            ]}
          />
          <Text
            style={styles.cardTitle}
            numberOfLines={d.card.bottomChip.titleNumberOfLines}
            allowFontScaling
          >
            {card.eventName}
          </Text>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardMetaText} numberOfLines={1} allowFontScaling>
              {dateTag}
              {dateTag && card.venueName ? " · " : ""}
              {card.venueName}
            </Text>
            {displayPrice ? (
              <Text style={styles.cardPriceText} numberOfLines={1} allowFontScaling>
                {displayPrice}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      </GestureDetector>
    </RNAnimated.View>
  );
};

interface FilterChipProps {
  label: string;
  icon?: IconName;
  active?: boolean;
  badgeCount?: number;
  onPress: () => void;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  chipRef?: React.Ref<any>;
}

const FilterChip: React.FC<FilterChipProps> = ({
  label,
  icon,
  active = false,
  badgeCount = 0,
  onPress,
  reduceMotion,
  reduceTransparency,
  chipRef,
}) => {
  const scale = useRef(new RNAnimated.Value(1)).current;

  const handlePressIn = (): void => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    if (reduceMotion) return;
    RNAnimated.timing(scale, {
      toValue: d.chip.pressScale,
      duration: d.chip.pressDurationMs,
      easing: RNEasing.inOut(RNEasing.quad),
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = (): void => {
    if (reduceMotion) return;
    RNAnimated.timing(scale, {
      toValue: 1,
      duration: d.chip.pressDurationMs,
      easing: RNEasing.inOut(RNEasing.quad),
      useNativeDriver: true,
    }).start();
  };
  const handlePress = (): void => {
    if (Platform.OS === "ios" && !active) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    onPress();
  };

  const useOrangeFallback = reduceTransparency || isAndroidPreBlur;

  const bg = active
    ? useOrangeFallback
      ? d.chip.active.fallbackSolid
      : glass.chrome.active.tint
    : useOrangeFallback
    ? d.chip.inactive.fallbackSolid
    : d.chip.inactive.bg;
  const border = active ? glass.chrome.active.border : d.chip.inactive.border;
  const labelColor = active ? glass.chrome.active.labelColor : d.chip.inactive.labelColor;

  return (
    <Pressable
      ref={chipRef as any}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel={badgeCount > 0 ? `${label}, ${badgeCount} active` : label}
      accessibilityState={{ selected: active }}
    >
      <RNAnimated.View
        style={[
          styles.chip,
          {
            backgroundColor: bg,
            borderColor: border,
            transform: [{ scale }],
            shadowColor: active ? glass.chrome.active.glowColor : "transparent",
            shadowOpacity: active ? d.chip.active.glowOpacity : 0,
            shadowRadius: active ? d.chip.active.glowRadius : 0,
            elevation: active ? 4 : 0,
          },
        ]}
      >
        {icon ? <Icon name={icon} size={16} color={labelColor} /> : null}
        <Text style={[styles.chipLabel, { color: labelColor }]} numberOfLines={1} allowFontScaling>
          {label}
        </Text>
        {badgeCount > 0 ? (
          <View style={styles.chipCountBadge}>
            <Text style={styles.chipCountBadgeText} allowFontScaling={false}>
              {badgeCount}
            </Text>
          </View>
        ) : null}
      </RNAnimated.View>
    </Pressable>
  );
};

interface LoadingGridSkeletonProps {
  count?: number;
}

const LoadingGridSkeleton: React.FC<LoadingGridSkeletonProps> = ({ count = 6 }) => {
  const pulse = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    // ORCH-0675 Wave 1 RC-3 — useNativeDriver: true mandatory for opacity-only animation.
    // (I-ANIMATIONS-NATIVE-DRIVER-DEFAULT) opacity is GPU-eligible; JS-driven loop
    // would starve gesture input during Discover loading state on mid-tier Android.
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, {
          toValue: 1,
          duration: d.motion.skeletonPulseMs / 2,
          easing: RNEasing.inOut(RNEasing.quad),
          useNativeDriver: true,
        }),
        RNAnimated.timing(pulse, {
          toValue: 0,
          duration: d.motion.skeletonPulseMs / 2,
          easing: RNEasing.inOut(RNEasing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.08] });

  return (
    <View style={styles.gridWrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skeletonCard}>
          <RNAnimated.View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(255,255,255,0.04)`, opacity, borderRadius: d.card.radius }]} />
          <View style={styles.skeletonBottomChip}>
            <RNAnimated.View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(255,255,255,0.06)`, opacity, borderRadius: d.card.bottomChip.radius }]} />
          </View>
        </View>
      ))}
    </View>
  );
};

interface EmptyStateProps {
  icon: IconName;
  title: string;
  subtitle: string;
  actionLabel?: string;
  actionOnPress?: () => void;
  actionVariant?: "primary" | "secondary";
  iconColor?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  subtitle,
  actionLabel,
  actionOnPress,
  actionVariant = "primary",
  iconColor,
}) => {
  return (
    <View style={styles.emptyStateContainer}>
      <Icon name={icon} size={d.emptyState.iconSize} color={iconColor || glass.chrome.active.glowColor} />
      <Text style={styles.emptyStateTitle} allowFontScaling>
        {title}
      </Text>
      <Text style={styles.emptyStateSubtitle} allowFontScaling>
        {subtitle}
      </Text>
      {actionLabel && actionOnPress ? (
        <Pressable
          style={[
            styles.emptyStateAction,
            actionVariant === "primary"
              ? {
                  backgroundColor: glass.chrome.active.tint,
                  borderColor: glass.chrome.active.border,
                  shadowColor: glass.chrome.active.glowColor,
                  shadowOpacity: 0.3,
                  shadowRadius: 10,
                  elevation: 4,
                }
              : {
                  backgroundColor: "transparent",
                  borderColor: "rgba(235, 120, 37, 0.5)",
                },
          ]}
          onPress={() => {
            if (Platform.OS === "ios") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
            actionOnPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text
            style={[
              styles.emptyStateActionLabel,
              { color: actionVariant === "primary" ? "#FFFFFF" : glass.chrome.active.glowColor },
            ]}
            allowFontScaling
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

// ============================================================================
// Main screen
// ============================================================================

function DiscoverScreen({
  accountPreferences,
  onOpenTrip,
}: DiscoverScreenProps): React.ReactElement {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] DiscoverScreen: ${renderCountRef.current}`);
  }

  const { t } = useTranslation(["discover", "common"]);
  const insets = useSafeAreaInsets();
  // ORCH-0635 (rework): step 6 target is the header panel (title + filter bar).
  // targetRadius 24 → cutout radius 28 matches HEADER_PANEL_RADIUS for a neat fit.
  const coachDiscoverFeed = useCoachMark(6, 24);

  // Accessibility state (mirrors home chrome pattern)
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async (): Promise<void> => {
      try {
        const [rt, rm] = await Promise.all([
          AccessibilityInfo.isReduceTransparencyEnabled(),
          AccessibilityInfo.isReduceMotionEnabled(),
        ]);
        if (mounted) {
          setReduceTransparency(rt);
          setReduceMotion(rm);
        }
      } catch {
        if (mounted) {
          setReduceTransparency(true);
          setReduceMotion(true);
        }
      }
    })();
    const rtSub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency);
    const rmSub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      rtSub.remove();
      rmSub.remove();
    };
  }, []);

  const useGlass = !reduceTransparency && !isAndroidPreBlur;

  // ── ORCH-1016: Events/Trips spotlight-pill switcher (Likes pattern, exact) ──
  const discoverActiveTabSnapshot = useAppStore.getState().discoverActiveTab;
  const setDiscoverActiveTabRegistry = useAppStore((s) => s.setDiscoverActiveTab);
  const [activeTab, setActiveTab] = useState<"events" | "trips">(
    discoverActiveTabSnapshot,
  );
  useEffect(() => {
    setDiscoverActiveTabRegistry(activeTab);
  }, [activeTab, setDiscoverActiveTabRegistry]);

  const cc = glass.chrome;
  const TAB_PILL_HEIGHT = 52;
  const TABS_1016: Array<{ id: "events" | "trips"; label: string; icon: IconName }> = [
    { id: "events", label: t("discover:events_tab", "Events"), icon: "sparkles-outline" },
    { id: "trips", label: t("discover:trips_tab", "Trips"), icon: "compass-outline" },
  ];
  const tab1016LayoutsRef = useRef<
    Record<"events" | "trips", { x: number; width: number } | undefined>
  >({ events: undefined, trips: undefined });
  const [tab1016LayoutTick, setTab1016LayoutTick] = useState(0);
  const spotlight1016X = useRef(new RNAnimated.Value(0)).current;
  const spotlight1016Width = useRef(new RNAnimated.Value(0)).current;
  const handleTab1016Layout = (id: "events" | "trips", x: number, width: number): void => {
    tab1016LayoutsRef.current[id] = { x, width };
    setTab1016LayoutTick((v) => v + 1);
  };
  useEffect(() => {
    const layout = tab1016LayoutsRef.current[activeTab];
    if (!layout) return;
    const targetX = layout.x + cc.nav.spotlightInset;
    const targetWidth = layout.width - cc.nav.spotlightInset * 2;
    if (reduceMotion) {
      spotlight1016X.setValue(targetX);
      spotlight1016Width.setValue(targetWidth);
      return;
    }
    RNAnimated.parallel([
      RNAnimated.spring(spotlight1016X, {
        toValue: targetX,
        damping: cc.motion.springDamping,
        stiffness: cc.motion.springStiffness,
        mass: cc.motion.springMass,
        useNativeDriver: false,
      }),
      RNAnimated.spring(spotlight1016Width, {
        toValue: targetWidth,
        damping: cc.motion.springDamping,
        stiffness: cc.motion.springStiffness,
        mass: cc.motion.springMass,
        useNativeDriver: false,
      }),
    ]).start();
  }, [
    activeTab,
    tab1016LayoutTick,
    reduceMotion,
    spotlight1016X,
    spotlight1016Width,
    cc.motion.springDamping,
    cc.motion.springStiffness,
    cc.motion.springMass,
    cc.nav.spotlightInset,
  ]);
  const handleTab1016Change = (tab: "events" | "trips"): void => {
    if (tab === activeTab) return;
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setActiveTab(tab);
    mixpanelService.trackTabViewed({ screen: "discover", tab });
  };
  const handleOpenTripDetail = useCallback(
    (seed: DiscoverTripRow): void => {
      onOpenTrip?.(seed);
    },
    [onOpenTrip],
  );

  // Expanded-card state
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  // ORCH-0828: replaced the prior dual-state pattern (`selectedCardForExpansion`
  // + `selectedBusinessEventForExpansion`) with a single discriminated-union
  // state. The two parallel hooks let one branch's setter forget to clear the
  // other branch, poisoning the modal so subsequent taps no-op'd (Bug B). The
  // union makes that bug class unrepresentable.
  const [expansionTarget, setExpansionTarget] = useState<ExpansionTarget | null>(null);
  const expandedCardListRef = useRef<ExpandedCardData[]>([]);
  const [expandedCardIndex, setExpandedCardIndex] = useState<number | null>(null);
  // Derived helper for the rest of this file's consumers that still read
  // the legacy `selectedCardForExpansion` shape (saved-card detection,
  // navigation indexing, etc.). Pure projection; no parallel state.
  const selectedCardForExpansion: ExpandedCardData | null =
    expansionTarget?.kind === "nightOut" ? expansionTarget.data : null;

  // Auth / feature gate / saved cards
  const user = useAppStore((s) => s.user);
  const { canAccess } = useFeatureGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>("curated_cards");
  const queryClient = useQueryClient();
  const { data: mapSavedCards } = useSavedCards(user?.id);
  const savedCardIds = useMemo(
    () => new Set((mapSavedCards ?? []).map((c) => c.id)),
    [mapSavedCards]
  );

  // Location (GPS → preference fallback)
  const { data: userLocationData } = useUserLocation(user?.id, "solo");
  const fallbackLat = userLocationData?.lat;
  const fallbackLng = userLocationData?.lng;
  // ORCH-0996 REWORK 1: seed device coords SYNCHRONOUSLY from the last
  // resolved-city snapshot (process-lifetime, in-memory) so the events-cache
  // key reproduces the prior entry's gps facets on the very first
  // post-remount render. The location effect below still seeds from
  // last-known and refines with precise GPS, always overwriting — this is a
  // paint-first hint only.
  const seededResolvedCity = readLastResolvedDiscoverCity();
  const [deviceGpsLat, setDeviceGpsLat] = useState<number | null>(
    seededResolvedCity?.lat ?? null,
  );
  const [deviceGpsLng, setDeviceGpsLng] = useState<number | null>(
    seededResolvedCity?.lng ?? null,
  );
  const deviceGpsFetchedRef = useRef(false);

  // ORCH-0996: parallelize the location chain so a slow precise-GPS lock
  // never blocks first paint. Previously this effect AWAITED the precise
  // `getCurrentLocation()` (2-5s on first open) before any coordinate was
  // set, which gated the whole events fetch. Now:
  //   1. Seed `deviceGps*` IMMEDIATELY from the best already-available
  //      coordinate (saved/last-known location from `useUserLocation`), so
  //      the events fetch can kick off on the next render with no GPS wait.
  //   2. Resolve precise GPS in parallel; only REPLACE the seeded coordinate
  //      if precise GPS lands AND is meaningfully different (> ~500m), which
  //      mints a refetch. A near-identical lock is ignored (no churn).
  // `MEANINGFUL_MOVE_DEG ≈ 0.005°` is roughly 500m of latitude — far below
  // the 50km search radius, so a tiny GPS drift never triggers a refetch.
  const MEANINGFUL_MOVE_DEG = 0.005;
  useEffect(() => {
    if (deviceGpsFetchedRef.current) return;
    deviceGpsFetchedRef.current = true;

    // (1) Immediate seed from last-known/saved location (no await).
    let seededLat: number | null = null;
    let seededLng: number | null = null;
    if (typeof fallbackLat === "number" && typeof fallbackLng === "number") {
      seededLat = fallbackLat;
      seededLng = fallbackLng;
      setDeviceGpsLat(fallbackLat);
      setDeviceGpsLng(fallbackLng);
    }

    // (2) Refine with precise GPS in parallel; replace only if meaningfully different.
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const loc = await enhancedLocationService.getCurrentLocation();
        if (cancelled) return;
        if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
          const movedMeaningfully =
            seededLat === null ||
            seededLng === null ||
            Math.abs(loc.latitude - seededLat) > MEANINGFUL_MOVE_DEG ||
            Math.abs(loc.longitude - seededLng) > MEANINGFUL_MOVE_DEG;
          if (movedMeaningfully) {
            setDeviceGpsLat(loc.latitude);
            setDeviceGpsLng(loc.longitude);
          }
        }
      } catch {
        // precise GPS failed — keep the seeded last-known coordinate.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fallbackLat, fallbackLng]);

  useEffect(() => {
    let lastState = AppState.currentState;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (lastState === "background" && nextState === "active") {
        deviceGpsFetchedRef.current = false;
      }
      lastState = nextState;
    });
    return () => sub.remove();
  }, []);

  // Filter state
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  // ORCH-0679 Wave 2.8.1: filter preservation across tab unmount/remount.
  // Snapshot at mount (Zustand registry holds loose strings to avoid circular
  // import — narrow back to the typed unions here, where the shape is owned).
  const discoverFiltersSnapshot = useMemo(() => useAppStore.getState().discoverFilters, []);
  const setDiscoverFiltersRegistry = useAppStore((s) => s.setDiscoverFilters);
  // ORCH-0809 M2: filter shape now { date, segment, genre } — price field removed.
  const [selectedFilters, setSelectedFilters] = useState<NightOutFilters>(
    discoverFiltersSnapshot
      ? {
          date: discoverFiltersSnapshot.date as DateFilter,
          segment: (discoverFiltersSnapshot.segment as SegmentFilter) ?? "music",
          genre: discoverFiltersSnapshot.genre as GenreFilter,
          // ORCH-0824: defensive — older snapshots won't have these fields.
          partyTypes: [],
          vibeTags: [],
          musicGenres: [],
        }
      : { date: "any", segment: "music", genre: "all", partyTypes: [], vibeTags: [], musicGenres: [] }
  );
  // ORCH-0996 REWORK 1: synchronously read the events cache at MOUNT TIME using
  // the seeds available now (the resolved-city seed → effectiveCity, its coords
  // → gps facets, and the snapshotted filters). selectedCity (preferences) is
  // still null this early, so effectiveCity-at-mount == the GPS-seeded city —
  // exactly the signature under which the prior session cached. This lets the
  // card arrays + loading flag initialize from the cache, so a fresh remount
  // paints the prior cards on the FIRST render with no skeleton flash. The
  // network fetch still runs immediately underneath and overwrites.
  const initialEventsCacheSeed = useMemo(() => {
    if (!seededResolvedCity) return null;
    const key = buildDiscoverCacheKey({
      cityName: seededResolvedCity.name,
      cityLat: seededResolvedCity.lat,
      cityLng: seededResolvedCity.lng,
      gpsLat: seededResolvedCity.lat,
      gpsLng: seededResolvedCity.lng,
      date: selectedFilters.date,
      segment: selectedFilters.segment,
      genre: selectedFilters.genre,
      partyTypes: selectedFilters.partyTypes,
      vibeTags: selectedFilters.vibeTags,
      musicGenres: selectedFilters.musicGenres,
    });
    const hit = readDiscoverCache<NightOutCardData, BusinessEventCardData>(key);
    return hit && isDiscoverCacheFresh(hit) ? hit : null;
    // Mount-time seed only — intentionally not reactive to later filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ORCH-0824: business events that came back from the merged endpoint,
  // rendered above the Ticketmaster grid. Empty when no business events
  // match the active city + filters.
  const [businessEvents, setBusinessEvents] = useState<BusinessEventCardData[]>(
    initialEventsCacheSeed?.businessEvents ?? [],
  );

  // ORCH-0809 M2: city picker state. selectedCity comes from preferences;
  // gpsDefaultCity comes from reverse-geocoding the device GPS on first paint.
  // effectiveCity = selectedCity ?? gpsDefaultCity.
  const [selectedCity, setSelectedCity] = useState<DiscoverCity | null>(null);
  // ORCH-0996 REWORK 1: seed the GPS-derived city SYNCHRONOUSLY from the last
  // resolved-city snapshot so `effectiveCity` is non-null on the FIRST
  // post-remount render → the events-cache signature reproduces the prior
  // "Raleigh"-keyed entry → instant paint, instead of waiting ~2-3s for the
  // async reverseGeocode chain to re-run (which was leaving `effectiveCity`
  // null and forcing a cache MISS + the skeleton + "Set city"). selectedCity
  // (user-set, from preferences) still wins via `effectiveCity` below; the
  // async reverseGeocode still runs and overwrites this seed authoritatively.
  const [gpsDefaultCity, setGpsDefaultCity] = useState<DiscoverCity | null>(
    () => {
      const seed = readLastResolvedDiscoverCity();
      return seed
        ? {
            name: seed.name,
            stateCode: seed.stateCode,
            countryCode: seed.countryCode,
            lat: seed.lat,
            lng: seed.lng,
          }
        : null;
    },
  );
  const [isCityPickerVisible, setIsCityPickerVisible] = useState(false);
  const [fallbackActive, setFallbackActive] = useState(
    initialEventsCacheSeed?.fallbackActive ?? false,
  );
  const effectiveCity: DiscoverCity | null = selectedCity ?? gpsDefaultCity;

  // Sync local filter state back to the Zustand registry on every change so
  // the values survive tab unmount under Path B (ORCH-0679 Wave 2.8).
  useEffect(() => {
    setDiscoverFiltersRegistry(selectedFilters);
  }, [selectedFilters, setDiscoverFiltersRegistry]);

  // ORCH-0679 Wave 2.8.1: scroll position registry.
  const { scrollRef: discoverScrollRef, handleScroll: handleDiscoverScroll } =
    useTabScrollRegistry('discover_main');

  // Events fetch state. ORCH-0996 REWORK 1: seed from the mount-time events
  // cache read so a remount paints prior cards immediately (no skeleton flash)
  // while the network revalidates underneath.
  const [nightOutCards, setNightOutCards] = useState<NightOutCardData[]>(
    initialEventsCacheSeed?.nightOutCards ?? [],
  );
  const [nightOutLoading, setNightOutLoading] = useState(
    initialEventsCacheSeed === null,
  );
  const [nightOutError, setNightOutError] = useState<string | null>(null);
  // ORCH-0839-A F-6: surface a non-fatal banner when the merged endpoint
  // returns a non-null meta.tmError (Ticketmaster upstream returned events=[]
  // with non-zero totalResults, or the TM call threw, or was rate-limited).
  // Lives separately from nightOutError (which is the hard fetch failure).
  // Banner is non-blocking; Mingla business events continue to render. The
  // string value is currently informational only — render is just on
  // null-vs-non-null.
  const [tmError, setTmError] = useState<string | null>(
    initialEventsCacheSeed?.tmError ?? null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const nightOutGpsLat = deviceGpsLat;
  const nightOutGpsLng = deviceGpsLng;

  // ORCH-0996: stabilize the i18n `t` reference out of the fetch dep array.
  // Previously `t` lived in `fetchNightOutEvents`'s deps (only used for the
  // catch-block error string). If `t`'s identity churned, the fetch callback
  // was recreated → the debounce effect re-fired → a latent extra refetch.
  // We mirror the (only) translated string the fetch needs into a ref that
  // stays current, and read the ref inside the fetch, so `t` can leave deps.
  const fetchErrorTextRef = useRef<string>("");
  useEffect(() => {
    fetchErrorTextRef.current = t("discover:errors.failed_events");
  }, [t]);

  // ORCH-0809 M2: load persisted Discover city from preferences on mount.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const prefs = await PreferencesService.getUserPreferences(user.id);
      if (cancelled || !prefs) return;
      if (
        prefs.discover_city_name &&
        typeof prefs.discover_city_lat === "number" &&
        typeof prefs.discover_city_lng === "number"
      ) {
        setSelectedCity({
          name: prefs.discover_city_name,
          stateCode: prefs.discover_city_state_code ?? null,
          countryCode: prefs.discover_city_country_code ?? null,
          lat: prefs.discover_city_lat,
          lng: prefs.discover_city_lng,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // ORCH-0809 M2 / ORCH-0996 REWORK 1: reverse-geocode GPS to derive the
  // default city chip value when the user hasn't picked one.
  //
  // The chip may already be SEEDED synchronously from the resolved-city cache
  // (see useState above) so a remount paints instantly. This effect still runs
  // the authoritative reverseGeocode and overwrites the seed — paint-first
  // hint, never a short-circuit. Two guards keep it correct + churn-free:
  //   • `geocodedCoordsRef` ensures we geocode each distinct coord at most once
  //     per mount (a remount resets it, so the authoritative call re-runs).
  //   • If the seed's coords no longer match the now-known device coords
  //     (user moved cities), the coords-matched read returns null and the
  //     reverseGeocode below corrects the chip.
  const geocodedCoordsRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCity) return; // user override wins
    if (typeof nightOutGpsLat !== "number" || typeof nightOutGpsLng !== "number") return;
    const coordKey = `${nightOutGpsLat},${nightOutGpsLng}`;
    if (geocodedCoordsRef.current === coordKey) return; // already geocoded these coords this mount
    geocodedCoordsRef.current = coordKey;

    // If the synchronously-seeded chip does NOT match the now-known coords
    // (the device has moved beyond the ~110m bucket), drop the stale seed so
    // the user isn't shown the previous city while the authoritative call runs.
    const coordsMatchSeed = readResolvedDiscoverCity(nightOutGpsLat, nightOutGpsLng);
    if (gpsDefaultCity && !coordsMatchSeed) {
      setGpsDefaultCity(null);
    }

    let cancelled = false;
    (async () => {
      const result = await geocodingService.reverseGeocode(nightOutGpsLat, nightOutGpsLng);
      if (cancelled || !result.city) return;
      // state/country come from the reverseGeocode result strings; we coerce
      // common forms to ISO codes. Best-effort only — TM tolerates city-name-only.
      const countryStr = result.country ?? "";
      const stateStr = result.state ?? "";
      const countryCode =
        countryStr === "United States" || countryStr === "USA" || countryStr === "US"
          ? "US"
          : countryStr.length === 2
          ? countryStr.toUpperCase()
          : null;
      const stateCode = stateStr.length === 2 ? stateStr.toUpperCase() : null;
      const resolved: DiscoverCity = {
        name: result.city,
        stateCode,
        countryCode,
        lat: nightOutGpsLat,
        lng: nightOutGpsLng,
      };
      setGpsDefaultCity(resolved);
      // Persist for the NEXT remount's synchronous seed.
      writeResolvedDiscoverCity(nightOutGpsLat, nightOutGpsLng, resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [nightOutGpsLat, nightOutGpsLng, selectedCity, gpsDefaultCity]);

  // ORCH-0839-A F-4: the prior mobile-cache surface (TTL date helper +
  // local cache interface + loader/saver/clearer + cache-hit short-circuit
  // + the prior symmetry guard) was removed in this ORCH. Server-side
  // caches authoritatively (TM cache table + edge-function in-memory
  // cache). The mobile cache was duplicative AND was the source of the
  // cross-filter leakage that surfaced in ORCH-0839 (C-1). Constitution #8:
  // subtract before adding. Future re-introduction requires a spec that
  // addresses cross-filter and remount symmetry from the start.
  // Invariant: I-PROPOSED-DISCOVER-NO-MOBILE-CACHE.
  // CI gate: app-mobile/scripts/ci/orch-0839-a-mobile-cache-removed.mjs.

  const transformNightOutVenue = (venue: NightOutVenue): NightOutCardData => ({
    id: venue.id,
    eventName: venue.eventName,
    artistName: venue.artistName,
    venueName: venue.venueName,
    image: venue.image,
    images: venue.images,
    price: venue.price,
    priceMin: venue.priceMin,
    priceMax: venue.priceMax,
    date: venue.date,
    time: venue.time,
    localDate: venue.localDate,
    location: venue.location,
    tags: venue.tags,
    genre: venue.genre || undefined,
    subGenre: venue.subGenre || undefined,
    address: venue.address,
    coordinates: venue.coordinates,
    ticketUrl: venue.ticketUrl,
    ticketStatus: venue.ticketStatus,
    // ORCH-0809 M1: venue.distance is `number | null` (null when city-mode active).
    // NightOutCardData expects `number | undefined`; coerce null → undefined.
    distance: venue.distance ?? undefined,
  });

  const nightOutFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ORCH-0996: the exact full-signature key for the current query. Drives
  // the paint-first in-memory cache. MUST include every facet the server
  // reads (see discoverEventsCache.ts) so two distinct filter sets can never
  // collide — this is what makes the ORCH-0839-A C-1 cross-filter leakage
  // structurally impossible to recur here.
  const cacheSignature: DiscoverCacheSignature = useMemo(
    () => ({
      cityName: effectiveCity?.name ?? null,
      cityLat: effectiveCity?.lat ?? null,
      cityLng: effectiveCity?.lng ?? null,
      gpsLat: nightOutGpsLat ?? null,
      gpsLng: nightOutGpsLng ?? null,
      date: selectedFilters.date,
      segment: selectedFilters.segment,
      genre: selectedFilters.genre,
      partyTypes: selectedFilters.partyTypes,
      vibeTags: selectedFilters.vibeTags,
      musicGenres: selectedFilters.musicGenres,
    }),
    [
      effectiveCity?.name,
      effectiveCity?.lat,
      effectiveCity?.lng,
      nightOutGpsLat,
      nightOutGpsLng,
      selectedFilters.date,
      selectedFilters.segment,
      selectedFilters.genre,
      selectedFilters.partyTypes,
      selectedFilters.vibeTags,
      selectedFilters.musicGenres,
    ],
  );
  const cacheKey = useMemo(
    () => buildDiscoverCacheKey(cacheSignature),
    [cacheSignature],
  );
  // Keep the live key in a ref so the (signature-stable) fetch callback can
  // write to the correct cache slot without taking the key as a dependency.
  const cacheKeyRef = useRef(cacheKey);
  useEffect(() => {
    cacheKeyRef.current = cacheKey;
  }, [cacheKey]);

  const fetchNightOutEvents = useCallback(
    async (skipCache: boolean = false): Promise<void> => {
      // ORCH-0839-A F-4: prior on-device cache removed in this ORCH.
      // Server-side caches authoritatively (TM cache table + edge-function
      // in-memory cache). The `skipCache` parameter is preserved for API
      // compatibility but is now a no-op.
      // ORCH-0996: an in-memory paint-first cache exists again, but it NEVER
      // short-circuits this fetch — the network ALWAYS runs and overwrites,
      // so `skipCache` remains a no-op and the server stays authoritative.
      // ORCH-0809 M2: require EITHER an effective city OR GPS to fetch.
      void skipCache;
      const writeKey = cacheKeyRef.current;
      if (!effectiveCity && (!nightOutGpsLat || !nightOutGpsLng)) return;
      setNightOutLoading(true);
      setNightOutError(null);
      try {
        const { localStartEndDateTime } = getDateRange(selectedFilters.date);
        const genreSlugs: DiscoverGenreSlug[] =
          selectedFilters.genre === "all" ? [] : [selectedFilters.genre];
        // ORCH-0824: merged endpoint when we have a city; falls back to
        // TM-only `search()` when only GPS is available (the merged
        // endpoint requires a structured city). The merged endpoint
        // handles TM suppression and business-first ranking server-side.
        if (effectiveCity) {
          const merged = await NightOutExperiencesService.searchMerged({
            city: {
              name: effectiveCity.name,
              stateCode: effectiveCity.stateCode,
              countryCode: effectiveCity.countryCode,
              fallbackLat: effectiveCity.lat,
              fallbackLng: effectiveCity.lng,
              fallbackRadiusKm: 50,
            },
            segmentSlug: selectedFilters.segment,
            genreSlugs,
            localStartEndDateTime: localStartEndDateTime ?? undefined,
            sort: "date,asc",
            partyTypeSlugs: selectedFilters.partyTypes,
            vibeTagSlugs: selectedFilters.vibeTags,
            musicGenreSlugs: selectedFilters.musicGenres,
          });
          // ORCH-0839-A F-6: surface tmError to the inline non-fatal banner.
          // Reads `merged.meta?.tmError` defensively because older clients
          // pinned to the prior response shape might receive undefined.
          setTmError(
            (merged.meta as { tmError?: string | null } | undefined)?.tmError ??
              null,
          );
          // Partition the merged items: business events first, TM second.
          const bizItems: BusinessEventCardData[] = [];
          const tmVenues: NightOutVenue[] = [];
          for (const it of merged.items as MergedDiscoverItem[]) {
            if (it.source === "business_event") bizItems.push(it.item);
            else tmVenues.push(it.item);
          }
          setBusinessEvents(bizItems);
          setFallbackActive(false);
          const cards = tmVenues.map(transformNightOutVenue);
          setNightOutCards(cards);
          // ORCH-0996: store this exact-signature result so a re-open paints
          // instantly. Full-signature key ⇒ no cross-filter leakage (C-1).
          writeDiscoverCache<NightOutCardData, BusinessEventCardData>(writeKey, {
            nightOutCards: cards,
            businessEvents: bizItems,
            tmError:
              (merged.meta as { tmError?: string | null } | undefined)
                ?.tmError ?? null,
            fallbackActive: false,
          });
        } else {
          // GPS-only path keeps the legacy TM-only call. No business events
          // until the user picks a city via CityPickerSheet.
          setBusinessEvents([]);
          setTmError(null);
          const { events, meta } = await NightOutExperiencesService.search({
            location: nightOutGpsLat && nightOutGpsLng
              ? { lat: nightOutGpsLat, lng: nightOutGpsLng }
              : undefined,
            radius: 50,
            segmentSlug: selectedFilters.segment,
            genreSlugs,
            localStartEndDateTime: localStartEndDateTime ?? undefined,
            sort: "date,asc",
          });
          const usedFallbackNow = meta?.usedFallback === true;
          setFallbackActive(usedFallbackNow);
          const cards = events.map(transformNightOutVenue);
          setNightOutCards(cards);
          // ORCH-0996: cache the GPS-only result under its exact signature too.
          writeDiscoverCache<NightOutCardData, BusinessEventCardData>(writeKey, {
            nightOutCards: cards,
            businessEvents: [],
            tmError: null,
            fallbackActive: usedFallbackNow,
          });
        }
      } catch (err) {
        console.error("[Discover] Error fetching events:", err);
        // ORCH-0996: read the translated error from a ref so `t` stays out
        // of this callback's dependency array (latent-refetch fix).
        setNightOutError(fetchErrorTextRef.current);
        // ORCH-0809 M2.1 (P2-1 audit fix): reset fallbackActive on error so the
        // banner doesn't stay stuck on after a failed retry / city switch.
        setFallbackActive(false);
        setTmError(null);
      } finally {
        setNightOutLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      effectiveCity?.name,
      effectiveCity?.lat,
      effectiveCity?.lng,
      nightOutGpsLat,
      nightOutGpsLng,
      selectedFilters.date,
      selectedFilters.segment,
      selectedFilters.genre,
      // ORCH-0824 (QA F-1 fix): the merged endpoint reads these three
      // facets from the fetch closure. Without them in the deps array,
      // toggling a Party Type / Vibe / Music Genre pill (once the
      // deferred filter UI lands per ORCH-0824-A) would NOT trigger a
      // refetch — stale closure bug.
      selectedFilters.partyTypes,
      selectedFilters.vibeTags,
      selectedFilters.musicGenres,
      // ORCH-0839-A F-4: businessEvents.length dep removed — the
      // cache-hit predicate it fed is gone with the mobile cache.
      // ORCH-0996: `t` removed from deps — the only translated string it fed
      // (the catch-block error) is now read from `fetchErrorTextRef`, kept
      // current by a separate effect. Stabilizing the callback identity stops
      // an i18n re-render from re-firing the fetch effect (latent refetch).
    ],
  );

  // ORCH-0996: separate the INITIAL load path from the FILTER-CHANGE path.
  //
  // Before, a single effect always wrapped the fetch in `setTimeout(…, 300)`,
  // so even the very first cold-open paid the 300ms debounce on top of the
  // GPS + prefs + geocode + edge-fn waterfall. Now:
  //   • The FIRST time a usable query becomes available, we (a) synchronously
  //     paint from the in-memory cache if a same-signature entry exists, and
  //     (b) fire the fetch IMMEDIATELY (no 300ms wait).
  //   • Every SUBSEQUENT change (filter pills, city switch, GPS refine) keeps
  //     the 300ms debounce to coalesce rapid taps.
  const initialFetchFiredRef = useRef(false);
  useEffect(() => {
    const hasUsableQuery = Boolean(
      effectiveCity || (nightOutGpsLat && nightOutGpsLng),
    );
    const mode = decideDiscoverFetchMode({
      hasUsableQuery,
      hasFiredInitial: initialFetchFiredRef.current,
    });
    if (mode === "skip") return;

    if (mode === "immediate") {
      // ── INITIAL load ──────────────────────────────────────────────────
      initialFetchFiredRef.current = true;
      // (a) Paint-first from cache (synchronous) so a re-open shows cards
      //     instantly while the network revalidates underneath.
      const cached = readDiscoverCache<NightOutCardData, BusinessEventCardData>(
        cacheKeyRef.current,
      );
      if (cached) {
        setNightOutCards(cached.nightOutCards);
        setBusinessEvents(cached.businessEvents);
        setTmError(cached.tmError);
        setFallbackActive(cached.fallbackActive);
        // Only suppress the blocking skeleton when the cached paint is fresh;
        // a stale cache still shows content but keeps the loading affordance.
        if (isDiscoverCacheFresh(cached)) {
          setNightOutLoading(false);
        }
      }
      // (b) Fire the real fetch immediately — NO 300ms debounce on first load.
      void fetchNightOutEvents();
      return;
    }

    // ── FILTER-CHANGE / refine ───────────────────────────────────────────
    if (nightOutFetchTimeoutRef.current) {
      clearTimeout(nightOutFetchTimeoutRef.current);
    }
    // Paint-first for the NEW signature too, if we already have it cached.
    const cachedForNew = readDiscoverCache<
      NightOutCardData,
      BusinessEventCardData
    >(cacheKeyRef.current);
    if (cachedForNew && isDiscoverCacheFresh(cachedForNew)) {
      setNightOutCards(cachedForNew.nightOutCards);
      setBusinessEvents(cachedForNew.businessEvents);
      setTmError(cachedForNew.tmError);
      setFallbackActive(cachedForNew.fallbackActive);
    }
    nightOutFetchTimeoutRef.current = setTimeout(() => {
      void fetchNightOutEvents();
    }, 300);
    return () => {
      if (nightOutFetchTimeoutRef.current) {
        clearTimeout(nightOutFetchTimeoutRef.current);
      }
    };
  }, [fetchNightOutEvents, effectiveCity, nightOutGpsLat, nightOutGpsLng]);


  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    // ORCH-0839-A F-4: no cache-clear call here — prior on-device cache
    // removed. Refresh just re-fetches; the server-side TTL handles
    // its own freshness (TM events cache: 2h TTL).
    await fetchNightOutEvents(true);
    setIsRefreshing(false);
  };

  // ORCH-0828: business-event card tap → set discriminated-union target.
  // Mutual exclusion is enforced by the type system; no parallel state to
  // clear. Replaces the ORCH-0824 dual-setter pattern that caused Bug B.
  const handleBusinessEventCardPress = useCallback(
    (data: BusinessEventCardData): void => {
      setExpansionTarget({ kind: "businessEvent", data });
      setIsExpandedModalVisible(true);
    },
    [],
  );

  const handleNightOutCardPress = (card: NightOutCardData): void => {
    const expandedCardData: ExpandedCardData = {
      id: card.id,
      title: card.eventName,
      category: "Night Out",
      categoryIcon: "moon-outline",
      description: `${card.artistName} at ${card.venueName}`,
      fullDescription: `${card.artistName} at ${card.venueName} — ${card.date} at ${card.time}`,
      image: card.image,
      images: card.images?.length ? card.images : [card.image].filter(Boolean),
      rating: 0,
      reviewCount: 0,
      priceRange: card.price,
      distance: card.distance
        ? parseAndFormatDistance(`${card.distance.toFixed(1)} km`, accountPreferences?.measurementSystem)
        : "",
      travelTime: "",
      address: card.address || card.location,
      highlights: [card.venueName, card.artistName, card.price].filter(Boolean),
      tags: card.tags,
      matchScore: 0,
      matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
      location: card.coordinates,
      nightOutData: {
        eventName: card.eventName,
        venueName: card.venueName,
        artistName: card.artistName,
        date: card.date,
        time: card.time,
        price: card.price,
        genre: card.genre,
        subGenre: card.subGenre,
        tags: card.tags,
        coordinates: card.coordinates,
        ticketUrl: card.ticketUrl,
        ticketStatus: card.ticketStatus,
      },
    };
    // ORCH-0828: discriminated-union target. Replaces the prior
    // setSelectedCardForExpansion(expandedCardData) which left the
    // sibling business-event state alive and poisoned the modal.
    setExpansionTarget({ kind: "nightOut", data: expandedCardData });
    setIsExpandedModalVisible(true);
  };

  const handleCloseExpandedModal = (): void => {
    setIsExpandedModalVisible(false);
    // ORCH-0828: clear the entire target (both kinds at once via union).
    setExpansionTarget(null);
    expandedCardListRef.current = [];
    setExpandedCardIndex(null);
  };

  const handleToggleSave = async (card: NightOutCardData): Promise<void> => {
    if (!user?.id) return;
    const isSaved = savedCardIds.has(card.id);
    try {
      if (isSaved) {
        await savedCardsService.removeCard(user.id, card.id, "solo");
      } else {
        const transformed = {
          id: card.id,
          title: card.eventName,
          category: "Night Out",
          image: card.image,
          images: card.images || [card.image].filter(Boolean),
          nightOutData: {
            eventName: card.eventName,
            venueName: card.venueName,
            artistName: card.artistName,
            date: card.date,
            time: card.time,
            price: card.price,
            genre: card.genre,
            subGenre: card.subGenre,
            tags: card.tags,
            coordinates: card.coordinates,
            ticketUrl: card.ticketUrl,
            ticketStatus: card.ticketStatus,
          },
        };
        await savedCardsService.saveCard(user.id, transformed, "solo");
      }
      queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });
    } catch (err: any) {
      if (err?.code !== "23505") {
        console.error("[Discover] Save toggle failed:", err);
      }
    }
  };

  const handleOpenFilterModal = (): void => {
    setIsFilterModalVisible(true);
  };
  const handleCloseFilterModal = (): void => {
    setIsFilterModalVisible(false);
  };
  const handleApplyFilters = (): void => {
    handleCloseFilterModal();
  };
  const handleResetFilters = (): void => {
    // ORCH-0809 M2: reset uses { date, segment, genre } — price field gone.
    // ORCH-0828: reset must include all NightOutFilters fields, including
    // the taxonomy arrays (kept empty so a wide-open reset doesn't narrow
    // the next fetch).
    setSelectedFilters({
      date: "any",
      segment: "music",
      genre: "all",
      partyTypes: [],
      vibeTags: [],
      musicGenres: [],
    });
  };

  // ORCH-0809 M2: city picker handlers
  const handleOpenCityPicker = (): void => setIsCityPickerVisible(true);
  const handleCloseCityPicker = (): void => setIsCityPickerVisible(false);
  const handleCityPicked = (city: DiscoverCity): void => {
    setSelectedCity(city);
    setIsCityPickerVisible(false);
    // Fetch refreshes via the useEffect dependency on effectiveCity.name/lat/lng
  };

  // ORCH-0809 M2: price filter REMOVED. The prior client-side tier overlap-check
  // silently hid Ticketmaster events because TM has no price query param —
  // Constitution #3 violation. Reintroduction is a separate ORCH when Mingla
  // Business native events (with structured ticket_types.unit_price_cents
  // pricing) are integrated into Discover. Filtered list is now sort-only.
  const filteredNightOutCards = useMemo(() => {
    return [...nightOutCards].sort((a, b) => {
      const dateA = a.localDate || "9999-12-31";
      const dateB = b.localDate || "9999-12-31";
      return dateA.localeCompare(dateB);
    });
  }, [nightOutCards]);

  // ORCH-0996: prefetch the first row of event-cover images as soon as
  // results land so the 2-col grid doesn't fade in cold. We prefetch the
  // first 4 cover URIs (≈ first two rows of the 2-col grid), business events
  // first (they render above the TM grid) then Ticketmaster cards. Only
  // image-type business covers are prefetched here (video/gif covers have
  // their own render pipeline in EventCoverMedia).
  useEffect(() => {
    const firstRowUris = [
      ...businessEvents
        .filter((b) => b.coverMediaType === "image" || b.coverMediaType === null)
        .map((b) => b.coverMediaUrl),
      ...filteredNightOutCards.map((c) => c.image),
    ]
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .slice(0, 4);
    if (firstRowUris.length === 0) return;
    void ExpoImage.prefetch(firstRowUris);
  }, [businessEvents, filteredNightOutCards]);

  // ORCH-0809 M2: badge counts non-default segment and non-"all" genre.
  // Price counter removed.
  const moreChipBadgeCount =
    (selectedFilters.segment !== "music" ? 1 : 0) +
    (selectedFilters.genre !== "all" ? 1 : 0);

  // Filter modal option lists
  const dateFilterOptions: { id: DateFilter; label: string }[] = [
    { id: "any", label: t("discover:filters.any_date") },
    { id: "today", label: t("discover:filters.today") },
    { id: "tomorrow", label: t("discover:filters.tomorrow") },
    { id: "weekend", label: t("discover:filters.this_weekend") },
    { id: "next-week", label: t("discover:filters.next_week") },
    { id: "month", label: t("discover:filters.this_month") },
  ];
  // ORCH-0809 M2: priceFilterOptions REMOVED with the price filter.
  // genreFilterOptions is now context-aware: chips depend on the active segment.
  // ORCH-0809-D: 4 segments (Music / Sports / Arts & Theatre / Film) per real
  // TM classification structure. Comedy and Family are NOT separate segments
  // in TM — they live as genres inside Arts & Theatre and Film respectively.
  const SEGMENT_OPTIONS: { id: SegmentFilter; labelKey: string; fallback: string }[] = [
    { id: "music", labelKey: "discover:filters.segment_music", fallback: "Music" },
    { id: "sports", labelKey: "discover:filters.segment_sports", fallback: "Sports" },
    { id: "arts-theatre", labelKey: "discover:filters.segment_arts_theatre", fallback: "Arts & Theatre" },
    { id: "film", labelKey: "discover:filters.segment_film", fallback: "Film" },
  ];
  // i18n fallback labels for every renderable genre slug across all 4 segments.
  // Source slugs + IDs verified against TM /discovery/v2/classifications.json
  // on 2026-05-12. Lockstep with DISCOVER_GENRE_ID + GENRES_BY_SEGMENT.
  const GENRE_LABEL_FALLBACK: Record<DiscoverGenreSlug, string> = {
    all: "All genres",
    // Music — curated unions (ORCH-0809-E)
    afro: "Afro",
    // Music — top-level
    rock: "Rock",
    pop: "Pop",
    "hiphop-rap": "Hip-Hop / Rap",
    rnb: "R&B",
    country: "Country",
    latin: "Latin",
    "dance-electronic": "Dance / Electronic",
    jazz: "Jazz",
    blues: "Blues",
    reggae: "Reggae",
    classical: "Classical",
    folk: "Folk",
    alternative: "Alternative",
    metal: "Metal",
    world: "World",
    // Sports
    basketball: "Basketball",
    football: "Football",
    baseball: "Baseball",
    soccer: "Soccer",
    hockey: "Hockey",
    tennis: "Tennis",
    boxing: "Boxing",
    wrestling: "Wrestling",
    golf: "Golf",
    motorsports: "Motorsports",
    // Arts & Theatre
    theatre: "Theatre",
    comedy: "Comedy",
    dance: "Dance",
    opera: "Opera",
    "childrens-theatre": "Children's Theatre",
    "magic-illusion": "Magic & Illusion",
    // Film
    "action-adventure": "Action & Adventure",
    "film-comedy": "Comedy",
    drama: "Drama",
    documentary: "Documentary",
    family: "Family",
    horror: "Horror",
    animation: "Animation",
    "science-fiction": "Science Fiction",
  };
  // ORCH-0996: memoize so the per-slug `.map()` + `t()` only recomputes when
  // the active segment or the i18n `t` reference changes — not on every
  // render of this large screen.
  const genreFilterOptions: { id: GenreFilter; label: string }[] = useMemo(
    () =>
      GENRES_BY_SEGMENT[selectedFilters.segment].map((slug) => {
        const i18nKey =
          slug === "all"
            ? "discover:filters.all_genres"
            : `discover:filters.${slug.replace(/-/g, "_")}`;
        const translated = t(i18nKey, {
          defaultValue: GENRE_LABEL_FALLBACK[slug],
        });
        return { id: slug, label: translated };
      }),
    // GENRE_LABEL_FALLBACK is a stable in-render literal; `t` + segment are
    // the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedFilters.segment, t],
  );

  const isFilterActive = (chip: DateFilter): boolean =>
    selectedFilters.date === chip;

  // Header panel geometry — one blurred glass panel covering status bar +
  // title region + filter bar. Rounded bottom corners trace the screen edges.
  // Title sits just beneath the OS status bar, matching the home chrome
  // pattern (glass.chrome.row.topInset = 2). marginTop: -4 on the text
  // counters iOS font leading so the glyphs sit tight to the status bar.
  const TITLE_TOP = insets.top + glass.chrome.row.topInset;
  const TITLE_BAND_HEIGHT = 36;
  const FILTER_BAR_HEIGHT = d.filterBar.height; // 52
  // ORCH-1016 — pill bar sits between the title and the (Events-only) filter bar.
  const PILL_BAR_TOP = TITLE_TOP + TITLE_BAND_HEIGHT;
  const FILTER_BAR_TOP = PILL_BAR_TOP + TAB_PILL_HEIGHT;
  // On the Trips tab the Events filter bar is hidden, so the glass header ends at
  // the pill (title → pill); on Events it includes the filter bar (title → pill →
  // filterBar). The Events grid + its filter bar are byte-for-byte unchanged (SC-12).
  const HEADER_PANEL_HEIGHT =
    activeTab === "events"
      ? FILTER_BAR_TOP + FILTER_BAR_HEIGHT
      : PILL_BAR_TOP + TAB_PILL_HEIGHT + 4;
  const HEADER_PANEL_RADIUS = 28;

  // Grid content branching
  // ORCH-0828 REWORK: every guard considers BOTH content arrays
  // (`nightOutCards` for Ticketmaster, `businessEvents` for Mingla
  // business events). The pre-rework version only checked Ticketmaster,
  // so Tonight/Weekend/Next Week filters hid Big Party whenever TM
  // returned zero — a P0 bug for any market+date combination where TM
  // is empty but business events exist. See INVESTIGATION_ORCH-0828_BRUTAL_RETEST_REPORT.md R1.
  // Invariant: I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS.
  const hasCache = nightOutCards.length > 0 || businessEvents.length > 0;
  const showLoadingSkeleton =
    nightOutLoading && nightOutCards.length === 0 && businessEvents.length === 0;
  const showError = !nightOutLoading && nightOutError !== null && !hasCache;
  const showEmpty =
    !nightOutLoading &&
    !nightOutError &&
    nightOutCards.length === 0 &&
    businessEvents.length === 0;
  const showFilterNoMatch =
    !nightOutLoading &&
    !nightOutError &&
    (nightOutCards.length > 0 || businessEvents.length > 0) &&
    filteredNightOutCards.length === 0 &&
    businessEvents.length === 0;
  const showGrid =
    !showLoadingSkeleton && !showError && !showEmpty && !showFilterNoMatch;

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      {/* ORCH-0635 (rework): coach-mark step 6 target — the header panel itself
          (title + filter bar). Bubble renders centered via bubblePosition='center'. */}
      <View
        ref={coachDiscoverFeed.targetRef}
        collapsable={false}
        pointerEvents="box-none"
        style={[
          styles.headerPanel,
          { height: HEADER_PANEL_HEIGHT, borderBottomLeftRadius: HEADER_PANEL_RADIUS, borderBottomRightRadius: HEADER_PANEL_RADIUS },
        ]}
      >
        {useGlass ? (
          <BlurView
            intensity={d.stickyHeader.blurIntensity}
            tint="dark"
            experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: useGlass ? d.stickyHeader.tint : d.stickyHeader.fallbackSolid },
          ]}
        />
        <View
          pointerEvents="none"
          style={[styles.headerPanelHairline, { borderBottomLeftRadius: HEADER_PANEL_RADIUS, borderBottomRightRadius: HEADER_PANEL_RADIUS }]}
        />

        {/* Large title — static; stays full size on scroll */}
        <View
          pointerEvents="none"
          style={[
            styles.titleOverlay,
            { top: TITLE_TOP, height: TITLE_BAND_HEIGHT },
          ]}
        >
          <Text
            style={styles.titleText}
            numberOfLines={1}
            accessibilityRole="header"
            allowFontScaling
          >
            {t("discover:title")}
          </Text>
        </View>

        {/* ORCH-1016 — Events/Trips spotlight pill (Likes pattern, exact). */}
        <View style={[styles.pillBar1016Absolute, { top: PILL_BAR_TOP, height: TAB_PILL_HEIGHT }]}>
          <View style={styles.pillBar1016Capsule}>
            <RNAnimated.View
              pointerEvents="none"
              style={[
                styles.spotlight1016,
                { left: spotlight1016X, width: spotlight1016Width },
              ]}
            />
            <View style={styles.tabs1016Row}>
              {TABS_1016.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => handleTab1016Change(tab.id)}
                    onLayout={(e) => {
                      const { x, width } = e.nativeEvent.layout;
                      handleTab1016Layout(tab.id, x, width);
                    }}
                    style={styles.tab1016}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: active }}
                  >
                    <Icon
                      name={tab.icon}
                      size={16}
                      color={active ? cc.active.iconColor : cc.inactive.iconColor}
                    />
                    <Text
                      style={[
                        styles.tabLabel1016,
                        active ? styles.tabLabel1016Active : styles.tabLabel1016Inactive,
                      ]}
                      numberOfLines={1}
                      allowFontScaling
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* Filter bar — Events tab only (SC-12: unchanged). Hidden on Trips. */}
        {activeTab === "events" ? (
        <View style={[styles.filterBarAbsolute, { top: FILTER_BAR_TOP, height: FILTER_BAR_HEIGHT }]}>
          <View style={styles.filterBarScrollWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {/* ORCH-0809 M2: city chip — first slot in the chip row. Tap opens
                  CityPickerSheet. Label = effectiveCity name (selectedCity ?? gpsDefaultCity)
                  or "Set city" placeholder when neither resolves. Inline city styling
                  rather than FilterChip so the icon + caret render properly. */}
              <TouchableOpacity
                onPress={handleOpenCityPicker}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={
                  effectiveCity
                    ? `Discover events in ${effectiveCity.name}. Tap to change city.`
                    : "Set your city for Discover"
                }
                style={styles.cityChipDiscover}
              >
                <Icon name="location-outline" size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.cityChipDiscoverText} numberOfLines={1}>
                  {effectiveCity ? effectiveCity.name : "Set city"}
                </Text>
                <Icon name="chevron-down" size={14} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>

              <FilterChip
                label={t("discover:filters.all_dates_short")}
                active={isFilterActive("any")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "any" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label={t("discover:filters.tonight")}
                active={isFilterActive("today")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "today" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label={t("discover:filters.this_weekend")}
                active={isFilterActive("weekend")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "weekend" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label={t("discover:filters.next_week")}
                active={isFilterActive("next-week")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "next-week" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label={t("discover:filters.this_month")}
                active={isFilterActive("month")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "month" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
            </ScrollView>
            {/* LinearGradient fades the chip row into the pinned Filters button on the right */}
            <LinearGradient
              colors={[d.filterBar.backdropTint, "rgba(12,14,18,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.chipRowFade, { left: 0, width: d.filterBar.fadeEdgeWidth }]}
              pointerEvents="none"
            />
            <LinearGradient
              colors={["rgba(12,14,18,0)", d.filterBar.backdropTint]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.chipRowFade, { right: 0, width: d.filterBar.fadeEdgeWidth }]}
              pointerEvents="none"
            />
          </View>
          <View style={styles.filterBarDivider} />
          <View style={styles.filterBarPinned}>
            <FilterChip
              label={t("discover:filters.button")}
              icon="options-outline"
              badgeCount={moreChipBadgeCount}
              onPress={handleOpenFilterModal}
              reduceMotion={reduceMotion}
              reduceTransparency={reduceTransparency}
            />
          </View>
        </View>
        ) : null}
      </View>

      {/* ORCH-1016 — Trips tab content (own filter row + feed). Mounts in place of
          the Events grid; the Events pipeline below is byte-for-byte unchanged. */}
      {activeTab === "trips" ? (
        <TripsContent
          headerHeight={HEADER_PANEL_HEIGHT}
          onOpenTrip={handleOpenTripDetail}
          onBrowseEvents={() => setActiveTab("events")}
          reduceMotion={reduceMotion}
        />
      ) : (
      /* Scrollable content — grid only; header stays fixed above */
      <ScrollView
        ref={discoverScrollRef as React.RefObject<ScrollView>}
        onScroll={handleDiscoverScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: HEADER_PANEL_HEIGHT + 12,
          paddingBottom: d.grid.bottomClearance,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={glass.chrome.active.glowColor}
            colors={[glass.chrome.active.glowColor]}
            progressViewOffset={HEADER_PANEL_HEIGHT}
          />
        }
      >
        {showLoadingSkeleton ? (
          <LoadingGridSkeleton count={6} />
        ) : showError ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t("discover:error.title")}
            subtitle={t("discover:error.subtitle")}
            actionLabel={t("discover:error.retry")}
            actionOnPress={() => fetchNightOutEvents(true)}
            actionVariant="primary"
            iconColor="rgba(255,255,255,0.65)"
          />
        ) : showEmpty ? (
          <EmptyState
            icon="moon-outline"
            // ORCH-0828: vary the headline by active date filter so "All"
            // doesn't read "tonight". Falls back to the i18n string when
            // not English (locales catch up incrementally).
            title={getEmptyStateHeadline(selectedFilters.date, t)}
            subtitle={t("discover:empty.no_events_subtitle")}
            actionLabel={t("discover:empty.expand_radius")}
            actionOnPress={handleRefresh}
            actionVariant="secondary"
          />
        ) : showFilterNoMatch ? (
          <EmptyState
            icon="options-outline"
            title={t("discover:empty.no_match_title")}
            subtitle={t("discover:empty.no_match_subtitle")}
            actionLabel={t("discover:empty.reset_filters")}
            actionOnPress={handleResetFilters}
            actionVariant="primary"
          />
        ) : showGrid ? (
          <View>
            {/* ORCH-0809 M2: fallback banner — visible when the edge function
                widened the query from city to lat/lng because the city had <5 results. */}
            {fallbackActive && effectiveCity ? (
              <View style={styles.fallbackBanner}>
                <Icon name="information-circle-outline" size={16} color="rgba(255,255,255,0.65)" />
                <Text style={styles.fallbackBannerText}>
                  Showing events near you — {effectiveCity.name} has no Ticketmaster events right now.
                </Text>
              </View>
            ) : null}
            {/* ORCH-0839-A F-6: non-fatal banner when merged response carries
                meta.tmError (Ticketmaster upstream had a hiccup but Mingla
                business events still render). Banner clears automatically on
                the next successful fetch via setTmError(null) in the success
                branch. */}
            {tmError !== null ? (
              <View style={styles.tmErrorBanner}>
                <Text style={styles.tmErrorText}>
                  Live events temporarily unavailable. Showing what we have.
                </Text>
              </View>
            ) : null}
            <View style={styles.gridWrap}>
              {/* ORCH-0824: business events render above the Ticketmaster
                  grid. Their tap handler opens the same ExpandedCardModal
                  (Step 20) with a business_event discriminator (Step 19). */}
              {businessEvents.map((be) => (
                <BusinessEventCard
                  key={be.eventId}
                  data={be}
                  width={GRID_CARD_WIDTH}
                  height={GRID_CARD_HEIGHT}
                  onPress={handleBusinessEventCardPress}
                />
              ))}
              {filteredNightOutCards.map((card) => (
                <EventGridCard
                  key={card.id}
                  card={card}
                  currency={accountPreferences?.currency}
                  isSaved={savedCardIds.has(card.id)}
                  onPress={() => handleNightOutCardPress(card)}
                  onSaveToggle={() => {
                    handleToggleSave(card);
                  }}
                  reduceTransparency={reduceTransparency}
                  reduceMotion={reduceMotion}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
      )}

      {/* Expanded Card Modal */}
      <ExpandedCardModal
        visible={isExpandedModalVisible}
        // ORCH-0828: single discriminated-union target. Type system enforces
        // mutual exclusion between place/TM cards and business events.
        target={expansionTarget}
        onClose={handleCloseExpandedModal}
        onSave={async (card) => {
          if (!user) return;
          try {
            await savedCardsService.saveCard(user.id, card, "solo");
            queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            handleCloseExpandedModal();
          } catch (error: any) {
            if (error?.code === "23505") {
              handleCloseExpandedModal();
            }
            throw error;
          }
        }}
        onShare={() => {
          // Share not implemented for Discover events yet
        }}
        isSaved={savedCardIds.has(selectedCardForExpansion?.id ?? "")}
        currentMode="solo"
        accountPreferences={accountPreferences}
        navigationIndex={expandedCardIndex ?? undefined}
        navigationTotal={expandedCardListRef.current.length > 1 ? expandedCardListRef.current.length : undefined}
        onNavigateNext={
          expandedCardIndex != null && expandedCardIndex < expandedCardListRef.current.length - 1
            ? () => {
                const next = expandedCardIndex + 1;
                setExpandedCardIndex(next);
                // ORCH-0828: navigate via the union state.
                setExpansionTarget({
                  kind: "nightOut",
                  data: expandedCardListRef.current[next],
                });
              }
            : undefined
        }
        onNavigatePrevious={
          expandedCardIndex != null && expandedCardIndex > 0
            ? () => {
                const prev = expandedCardIndex - 1;
                setExpandedCardIndex(prev);
                setExpansionTarget({
                  kind: "nightOut",
                  data: expandedCardListRef.current[prev],
                });
              }
            : undefined
        }
        canAccessCurated={canAccess("curated_cards")}
        onPaywallRequired={() => {
          handleCloseExpandedModal();
          setPaywallFeature("curated_cards");
          setShowPaywall(true);
        }}
      />

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ""}
        feature={paywallFeature}
      />

      {/* ORCH-0809 M2: City picker bottom sheet */}
      <CityPickerSheet
        visible={isCityPickerVisible}
        userId={user?.id ?? null}
        currentCity={effectiveCity}
        onClose={handleCloseCityPicker}
        onCityPicked={handleCityPicked}
      />

      {/* Night Out Filter sheet (content unchanged from Phase 1 — trigger moved to More chip).
          META-ORCH-0991 Wave B Batch 5: was an RN <Modal> flex-end card (maxHeight 85%,
          dark rgba(22,24,28,1) canvas, topRadius 24) → BaseBottomSheet dark surface,
          fixed ['85%'] snap, wrapInRNModal (Discover tab mounts it before the floating
          GlassBottomNav sibling, so an unwrapped sheet would render under the nav).
          Header + scroll body + sticky Reset/Apply footer. Bespoke dark canvas + radius
          preserved via backgroundStyle. */}
      <BaseBottomSheet
        visible={isFilterModalVisible}
        onClose={handleCloseFilterModal}
        snapPoints={FILTER_SNAP_POINTS as unknown as string[]}
        wrapInRNModal
        theme="dark"
        backgroundStyle={{
          backgroundColor: "rgba(22,24,28,1)",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
        accessibilityLabel={t("discover:filters.title")}
        scrollProps={{ style: styles.filterModalScrollView, showsVerticalScrollIndicator: false }}
        header={
          <View style={styles.filterModalHeader}>
            <Text style={styles.filterModalTitle}>{t("discover:filters.title")}</Text>
            <TouchableOpacity onPress={handleCloseFilterModal} style={styles.modalCloseButton}>
              <Icon name="x" size={24} color="rgba(255,255,255,0.65)" />
            </TouchableOpacity>
          </View>
        }
        stickyFooter={
          <View style={styles.filterButtonsContainer}>
            <TouchableOpacity
              style={styles.resetFilterButton}
              onPress={handleResetFilters}
              activeOpacity={0.7}
            >
              <Text style={styles.resetFilterButtonText}>{t("discover:filters.reset")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.applyFilterButton}
              onPress={handleApplyFilters}
              activeOpacity={0.7}
            >
              <Text style={styles.applyFilterButtonText}>{t("discover:filters.apply")}</Text>
            </TouchableOpacity>
          </View>
        }
      >
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="calendar" size={20} color={glass.chrome.active.glowColor} />
                  <Text style={styles.filterSectionTitle}>{t("discover:filters.date")}</Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {dateFilterOptions.map((option) => {
                    const selected = selectedFilters.date === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[
                          styles.filterOptionBadge,
                          selected && styles.filterOptionBadgeSelected,
                        ]}
                        onPress={() => setSelectedFilters({ ...selectedFilters, date: option.id })}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.filterOptionText,
                            selected && styles.filterOptionTextSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* ORCH-0809 M2: Price filter section REMOVED — Ticketmaster has no
                  price query param; the prior client-side post-filter silently hid
                  results (Constitution #3 violation). Reintroduction is a separate
                  ORCH when Mingla Business native events land in Discover. */}

              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="tag" size={20} color={glass.chrome.active.glowColor} />
                  <Text style={styles.filterSectionTitle}>
                    {t("discover:filters.segment", { defaultValue: "Category" })}
                  </Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {SEGMENT_OPTIONS.map((option) => {
                    const selected = selectedFilters.segment === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[
                          styles.filterOptionBadge,
                          selected && styles.filterOptionBadgeSelected,
                        ]}
                        onPress={() => {
                          // Reset genre to "all" when segment changes — genre map
                          // is context-aware and the prior selection may not exist
                          // under the new segment.
                          setSelectedFilters({
                            ...selectedFilters,
                            segment: option.id,
                            genre: "all",
                          });
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose ${option.fallback} category`}
                      >
                        <Text
                          style={[
                            styles.filterOptionText,
                            selected && styles.filterOptionTextSelected,
                          ]}
                        >
                          {t(option.labelKey, { defaultValue: option.fallback })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="music" size={20} color={glass.chrome.active.glowColor} />
                  <Text style={styles.filterSectionTitle}>{t("discover:filters.music_genre")}</Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {genreFilterOptions.map((option) => {
                    const selected = selectedFilters.genre === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[
                          styles.filterOptionBadge,
                          selected && styles.filterOptionBadgeSelected,
                        ]}
                        onPress={() => setSelectedFilters({ ...selectedFilters, genre: option.id })}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.filterOptionText,
                            selected && styles.filterOptionTextSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* ORCH-0809 M3 hotfix: when only "All" is renderable (genre IDs
                    pending TM /classifications curl + ORCH-0809-D), surface a
                    subtle hint so the user isn't confused by the empty filter. */}
                {genreFilterOptions.length <= 1 ? (
                  <Text style={styles.filterSectionHint}>
                    More genre filters coming soon.
                  </Text>
                ) : null}
              </View>
      </BaseBottomSheet>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: d.screenBg,
  },

  // ORCH-0809 M2: city chip in the filter row
  cityChipDiscover: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    marginRight: 8,
    gap: 6,
    maxWidth: 180,
  },
  cityChipDiscoverText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: "500",
    maxWidth: 110,
  },
  // ORCH-0809 M2: fallback banner shown when edge function returned meta.usedFallback
  fallbackBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fallbackBannerText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    flex: 1,
  },
  // ORCH-0839-A F-6: tmError banner (yellow tint) shown when the merged
  // endpoint carries a non-null meta.tmError. Non-blocking — Mingla events
  // continue to render normally.
  tmErrorBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255, 200, 0, 0.12)",
    borderColor: "rgba(255, 200, 0, 0.30)",
    borderWidth: 1,
    borderRadius: 12,
  },
  tmErrorText: {
    color: "rgba(255, 230, 150, 0.95)",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── ORCH-1016 — Events/Trips pill (mirrors LikesPage geometry) ──
  pillBar1016Absolute: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: glass.discover.filterBar.paddingHorizontal,
    justifyContent: "center",
  },
  pillBar1016Capsule: {
    height: 44,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    overflow: "hidden",
  },
  tabs1016Row: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  tab1016: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  spotlight1016: {
    position: "absolute",
    top: 4,
    bottom: 4,
    borderRadius: 20,
    backgroundColor: glass.chrome.active.tint,
    borderWidth: 1,
    borderColor: glass.chrome.active.border,
    shadowColor: glass.chrome.active.glowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: glass.chrome.active.glowOpacity,
    shadowRadius: glass.chrome.active.glowRadius,
    elevation: 4,
  },
  tabLabel1016: {
    fontSize: 14,
    fontWeight: "500",
  },
  tabLabel1016Active: {
    color: glass.chrome.active.labelColor,
    fontWeight: "600",
  },
  tabLabel1016Inactive: {
    color: glass.chrome.inactive.labelColor,
  },

  // Floating blurred header panel (status bar + title + filter bar in one glass surface)
  headerPanel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    overflow: "hidden",
  },
  headerPanelHairline: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: d.stickyHeader.bottomHairline,
  },

  // Title overlay (inside header panel — fades on scroll)
  titleOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: d.title.horizontalPadding,
    justifyContent: "center",
  },
  titleText: {
    // [ORCH-0670 Slice A S-6] Do NOT add adjustsFontSizeToFit OR minimumFontScale to
    // the parent <Text>. Android font rendering produces inconsistent autoshrink
    // behavior with iOS, leading to cross-platform header size divergence (operator
    // field-test 2026-04-28). Title MUST fit at full 32pt OR ellipsize via numberOfLines:1.
    // Friends-screen baseline at ConnectionsPage.tsx:3021-3028 is the canonical pattern.
    fontSize: d.title.fontSize,
    fontWeight: d.title.fontWeight,
    lineHeight: 36,
    color: d.title.color,
    // Counter iOS font leading so the glyphs sit tight to the top of the band.
    marginTop: Platform.OS === "ios" ? -4 : 0,
    includeFontPadding: false,
    textAlignVertical: "center",
  },

  // Filter bar (absolute inside header panel)
  filterBarAbsolute: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  filterBarScrollWrap: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
  },
  filterBarDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    marginHorizontal: 8,
  },
  filterBarPinned: {
    paddingRight: d.filterBar.paddingHorizontal,
    paddingLeft: 4,
    height: "100%",
    justifyContent: "center",
  },
  chipRow: {
    paddingHorizontal: d.filterBar.paddingHorizontal,
    gap: d.filterBar.chipGap,
    alignItems: "center",
  },
  chipRowFade: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },

  // Chip
  chip: {
    height: d.chip.height,
    borderRadius: d.chip.radius,
    paddingHorizontal: d.chip.paddingHorizontal,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: d.chip.iconLabelGap,
    shadowOffset: { width: 0, height: 0 },
    overflow: "visible",
  },
  chipLabel: {
    fontSize: d.chip.labelFontSize,
    fontWeight: d.chip.labelFontWeight,
  },
  chipCountBadge: {
    position: "absolute",
    top: d.chip.countBadge.top,
    right: d.chip.countBadge.right,
    width: d.chip.countBadge.size,
    height: d.chip.countBadge.size,
    borderRadius: d.chip.countBadge.size / 2,
    backgroundColor: d.chip.countBadge.bg,
    borderWidth: d.chip.countBadge.borderWidth,
    borderColor: d.chip.countBadge.borderColor,
    alignItems: "center",
    justifyContent: "center",
  },
  chipCountBadgeText: {
    color: d.chip.countBadge.color,
    fontSize: d.chip.countBadge.fontSize,
    fontWeight: d.chip.countBadge.fontWeight,
    lineHeight: 12,
  },

  // Grid
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: d.grid.columnGap,
    rowGap: d.grid.rowGap,
    paddingHorizontal: d.grid.horizontalPadding,
    paddingTop: d.grid.rowGap,
  },

  // Event card
  cardOuter: {
    width: GRID_CARD_WIDTH,
    height: GRID_CARD_HEIGHT,
    borderRadius: d.card.radius,
    shadowColor: d.card.shadow.color,
    shadowOffset: d.card.shadow.offset,
    shadowOpacity: d.card.shadow.opacity,
    shadowRadius: d.card.shadow.radius,
    elevation: d.card.shadow.elevation,
  },
  cardPressable: {
    flex: 1,
    borderRadius: d.card.radius,
    overflow: "hidden",
    backgroundColor: "rgba(22,24,28,1)", // guard against white flash while expo-image decodes
  },
  // META-ORCH-0991 Bug 3b: dark band shown when the Ticketmaster image fails to
  // load (expo-image onError) so the card is never a blank/empty cell.
  cardImageFallback: {
    backgroundColor: "rgba(22,24,28,1)",
  },
  cardTopBadge: {
    position: "absolute",
    top: d.card.topBadge.topInset,
    left: d.card.topBadge.leftInset,
    height: d.card.topBadge.height,
    paddingHorizontal: d.card.topBadge.paddingHorizontal,
    paddingVertical: d.card.topBadge.paddingVertical,
    borderRadius: d.card.topBadge.radius,
    borderWidth: 1,
    borderColor: d.card.topBadge.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardTopBadgeLabel: {
    color: d.card.topBadge.labelColor,
    fontSize: d.card.topBadge.labelFontSize,
    fontWeight: d.card.topBadge.labelFontWeight,
    letterSpacing: d.card.topBadge.labelLetterSpacing,
    lineHeight: 12,
  },
  cardSaveButtonWrap: {
    position: "absolute",
    top: d.card.saveButton.topInset,
    right: d.card.saveButton.rightInset,
  },
  cardSaveButton: {
    width: d.card.saveButton.size,
    height: d.card.saveButton.size,
    borderRadius: d.card.saveButton.radius,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowOffset: { width: 0, height: 0 },
  },
  cardBottomChip: {
    position: "absolute",
    left: d.card.bottomChip.leftInset,
    right: d.card.bottomChip.rightInset,
    bottom: d.card.bottomChip.bottomInset,
    paddingHorizontal: d.card.bottomChip.paddingHorizontal,
    paddingVertical: d.card.bottomChip.paddingVertical,
    borderRadius: d.card.bottomChip.radius,
    borderWidth: 1,
    borderColor: d.card.bottomChip.border,
    overflow: "hidden",
  },
  cardTitle: {
    color: d.card.bottomChip.titleColor,
    fontSize: d.card.bottomChip.titleFontSize,
    fontWeight: d.card.bottomChip.titleFontWeight,
    lineHeight: d.card.bottomChip.titleLineHeight,
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: d.card.bottomChip.metaRowGap,
  },
  cardMetaText: {
    flex: 1,
    color: d.card.bottomChip.metaColor,
    fontSize: d.card.bottomChip.metaFontSize,
    fontWeight: d.card.bottomChip.metaFontWeight,
    lineHeight: d.card.bottomChip.metaLineHeight,
  },
  cardPriceText: {
    color: d.card.bottomChip.priceColor,
    fontSize: d.card.bottomChip.metaFontSize,
    fontWeight: "600",
    lineHeight: d.card.bottomChip.metaLineHeight,
  },

  // Skeleton
  skeletonCard: {
    width: GRID_CARD_WIDTH,
    height: GRID_CARD_HEIGHT,
    borderRadius: d.card.radius,
    backgroundColor: "rgba(255,255,255,0.02)",
    overflow: "hidden",
  },
  skeletonBottomChip: {
    position: "absolute",
    left: d.card.bottomChip.leftInset,
    right: d.card.bottomChip.rightInset,
    bottom: d.card.bottomChip.bottomInset,
    height: 52,
    borderRadius: d.card.bottomChip.radius,
    overflow: "hidden",
  },

  // Empty / error state
  emptyStateContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 64,
    paddingBottom: 32,
  },
  emptyStateTitle: {
    marginTop: 16,
    color: d.emptyState.titleColor,
    fontSize: d.emptyState.titleFontSize,
    fontWeight: d.emptyState.titleFontWeight,
    textAlign: "center",
  },
  emptyStateSubtitle: {
    marginTop: 8,
    color: d.emptyState.subtitleColor,
    fontSize: d.emptyState.subtitleFontSize,
    fontWeight: d.emptyState.subtitleFontWeight,
    textAlign: "center",
  },
  emptyStateAction: {
    marginTop: 20,
    height: d.emptyState.actionHeight,
    borderRadius: d.emptyState.actionRadius,
    paddingHorizontal: d.emptyState.actionPaddingHorizontal,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateActionLabel: {
    fontSize: 15,
    fontWeight: "600",
  },

  // Filter modal (dark-glass restyle; structure preserved from Phase 1)
  filterModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  filterModalTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  modalCloseButton: {
    padding: 4,
  },
  filterModalScrollView: {
    paddingHorizontal: 20,
  },
  filterSection: {
    paddingVertical: 16,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  filterSectionTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  filterSectionHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 8,
    marginLeft: 2,
  },
  filterOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterOptionBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  filterOptionBadgeSelected: {
    backgroundColor: glass.chrome.active.tint,
    borderColor: glass.chrome.active.border,
  },
  filterOptionText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontWeight: "500",
  },
  filterOptionTextSelected: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  filterButtonsContainer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  resetFilterButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  resetFilterButtonText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "600",
  },
  applyFilterButton: {
    flex: 2,
    height: 48,
    borderRadius: 24,
    backgroundColor: glass.chrome.active.glowColor,
    alignItems: "center",
    justifyContent: "center",
  },
  applyFilterButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED.
export default React.memo(DiscoverScreen);
