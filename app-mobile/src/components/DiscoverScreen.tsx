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
  Modal,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Icon, type IconName } from "./ui/Icon";
import { formatPriceRange, parseAndFormatDistance } from "./utils/formatters";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { NightOutExperiencesService, NightOutVenue } from "../services/nightOutExperiencesService";
import { useAppStore } from "../store/appStore";
import { useUserLocation } from "../hooks/useUserLocation";
import { enhancedLocationService } from "../services/enhancedLocationService";
import { useFeatureGate, GatedFeature } from "../hooks/useFeatureGate";
import { CustomPaywallScreen } from "./CustomPaywallScreen";
import { useSavedCards } from "../hooks/useSavedCards";
import { savedCardsService } from "../services/savedCardsService";
import { savedCardKeys } from "../hooks/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { PRICE_TIERS } from "../constants/priceTiers";
import { glass } from "../constants/designSystem";

const NIGHT_OUT_CACHE_KEY = "mingla_night_out_cache";
const SCREEN_WIDTH = Dimensions.get("window").width;
const d = glass.discover;
const GRID_CARD_WIDTH = (SCREEN_WIDTH - d.grid.horizontalPadding * 2 - d.grid.columnGap) / 2;
const GRID_CARD_HEIGHT = GRID_CARD_WIDTH / d.card.aspectRatio;
const isAndroidPreBlur = Platform.OS === "android" && Platform.Version < 31;

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
type PriceFilter = "any" | "chill" | "comfy" | "bougie" | "lavish" | "free" | "under-25" | "25-50" | "50-100" | "over-100";
type GenreFilter = "all" | "afrobeats" | "dancehall" | "hiphop-rnb" | "house" | "techno" | "jazz-blues" | "latin-salsa" | "reggae" | "kpop" | "acoustic-indie";

interface NightOutFilters {
  date: DateFilter;
  price: PriceFilter;
  genre: GenreFilter;
}

const GENRE_TO_KEYWORDS: Record<GenreFilter, string[]> = {
  "all":             [],
  "afrobeats":       ["afrobeats", "amapiano"],
  "dancehall":       ["dancehall", "soca"],
  "hiphop-rnb":      ["hip hop", "r&b", "rnb", "hip-hop"],
  "house":           ["house", "deep house", "afro house"],
  "techno":          ["techno", "electronic"],
  "jazz-blues":      ["jazz", "blues"],
  "latin-salsa":     ["latin", "salsa", "reggaeton"],
  "reggae":          ["reggae", "dub"],
  "kpop":            ["kpop", "k-pop"],
  "acoustic-indie":  ["acoustic", "indie"],
};

function getDateRange(filter: DateFilter): { startDate: string; endDate: string } {
  const now = new Date();
  // Ticketmaster requires ISO 8601 WITHOUT milliseconds: YYYY-MM-DDTHH:mm:ssZ
  const toISONoMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");
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

  switch (filter) {
    case "today":
      return { startDate: toISONoMs(now), endDate: toISONoMs(endOfDay(now)) };
    case "tomorrow": {
      const tmrw = new Date(now);
      tmrw.setDate(tmrw.getDate() + 1);
      return { startDate: toISONoMs(startOfDay(tmrw)), endDate: toISONoMs(endOfDay(tmrw)) };
    }
    case "weekend": {
      const dayOfWeek = now.getDay();
      const daysUntilFri = (5 - dayOfWeek + 7) % 7 || 7;
      const friday = new Date(now);
      friday.setDate(friday.getDate() + (dayOfWeek <= 5 && dayOfWeek > 0 ? daysUntilFri : 0));
      friday.setHours(18, 0, 0, 0);
      const sunday = new Date(friday);
      sunday.setDate(sunday.getDate() + 2);
      sunday.setHours(23, 59, 59, 0);
      if (dayOfWeek === 0 || dayOfWeek === 6 || (dayOfWeek === 5 && now.getHours() >= 18)) {
        return { startDate: toISONoMs(now), endDate: toISONoMs(sunday) };
      }
      return { startDate: toISONoMs(friday), endDate: toISONoMs(sunday) };
    }
    case "next-week": {
      const monday = new Date(now);
      monday.setDate(monday.getDate() + (8 - now.getDay()) % 7);
      monday.setHours(0, 0, 0, 0);
      const nextSunday = new Date(monday);
      nextSunday.setDate(nextSunday.getDate() + 6);
      nextSunday.setHours(23, 59, 59, 0);
      return { startDate: toISONoMs(monday), endDate: toISONoMs(nextSunday) };
    }
    case "month":
    case "any":
    default: {
      const monthLater = new Date(now);
      monthLater.setDate(monthLater.getDate() + 30);
      return { startDate: toISONoMs(now), endDate: toISONoMs(monthLater) };
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

  const handlePressIn = (): void => {
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
  };
  const handlePressOut = (): void => {
    if (reduceMotion) return;
    RNAnimated.timing(pressScale, {
      toValue: 1,
      duration: d.card.pressDurationMs,
      easing: RNEasing.out(RNEasing.quad),
      useNativeDriver: true,
    }).start();
  };

  const handleSavePress = (): void => {
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
  };

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

  return (
    <RNAnimated.View style={[styles.cardOuter, { transform: [{ scale: pressScale }] }]}>
      <Pressable
        style={styles.cardPressable}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={accLabel}
        accessibilityHint="Double tap to view details"
      >
        {/* L0/L1 — photo */}
        <ExpoImage
          source={{ uri: card.image }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />

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

        {/* L4 — save heart (top-right) */}
        <Pressable
          style={styles.cardSaveButtonWrap}
          hitSlop={d.card.saveButton.hitSlop}
          onPress={handleSavePress}
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
        </Pressable>

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
      </Pressable>
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

  // Expanded-card state
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] = useState<ExpandedCardData | null>(null);
  const expandedCardListRef = useRef<ExpandedCardData[]>([]);
  const [expandedCardIndex, setExpandedCardIndex] = useState<number | null>(null);

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
  const [deviceGpsLat, setDeviceGpsLat] = useState<number | null>(null);
  const [deviceGpsLng, setDeviceGpsLng] = useState<number | null>(null);
  const deviceGpsFetchedRef = useRef(false);

  useEffect(() => {
    if (deviceGpsFetchedRef.current) return;
    deviceGpsFetchedRef.current = true;
    const resolveLocation = async (): Promise<void> => {
      try {
        const loc = await enhancedLocationService.getCurrentLocation();
        if (loc?.latitude && loc?.longitude) {
          setDeviceGpsLat(loc.latitude);
          setDeviceGpsLng(loc.longitude);
          return;
        }
      } catch {
        // fall through
      }
      if (fallbackLat && fallbackLng) {
        setDeviceGpsLat(fallbackLat);
        setDeviceGpsLng(fallbackLng);
      }
    };
    resolveLocation();
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
  const [selectedFilters, setSelectedFilters] = useState<NightOutFilters>({
    date: "any",
    price: "any",
    genre: "all",
  });

  // Events fetch state
  const [nightOutCards, setNightOutCards] = useState<NightOutCardData[]>([]);
  const [nightOutLoading, setNightOutLoading] = useState(true);
  const [nightOutError, setNightOutError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const nightOutGpsLat = deviceGpsLat;
  const nightOutGpsLng = deviceGpsLng;

  const getTodayDateString = (): string => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  };

  interface NightOutCache {
    date: string;
    venues: NightOutCardData[];
    genre: string;
  }

  const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_${user?.id}_${nightOutGpsLat?.toFixed(2)}_${nightOutGpsLng?.toFixed(2)}_${selectedFilters.genre}`;

  const saveNightOutCache = async (venues: NightOutCardData[]): Promise<void> => {
    if (!user?.id) return;
    try {
      const cacheData: NightOutCache = { date: getTodayDateString(), venues, genre: selectedFilters.genre };
      await AsyncStorage.setItem(nightOutCacheKey, JSON.stringify(cacheData));
    } catch (err) {
      console.error("[Discover] Error saving cache:", err);
    }
  };

  const clearNightOutCache = async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem(nightOutCacheKey);
    } catch (err) {
      console.error("[Discover] Error clearing cache:", err);
    }
  };

  const loadNightOutCache = async (): Promise<NightOutCache | null> => {
    if (!user?.id) return null;
    try {
      const raw = await AsyncStorage.getItem(nightOutCacheKey);
      if (raw) return JSON.parse(raw) as NightOutCache;
    } catch (err) {
      console.error("[Discover] Error loading cache:", err);
    }
    return null;
  };

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
    distance: venue.distance,
  });

  const nightOutFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNightOutEvents = useCallback(
    async (skipCache: boolean = false): Promise<void> => {
      if (!nightOutGpsLat || !nightOutGpsLng) return;
      setNightOutLoading(true);
      setNightOutError(null);
      try {
        if (!skipCache) {
          const cached = await loadNightOutCache();
          if (
            cached &&
            cached.date === getTodayDateString() &&
            cached.venues.length > 0 &&
            cached.genre === selectedFilters.genre
          ) {
            setNightOutCards(cached.venues);
            setNightOutLoading(false);
            return;
          }
        }
        const { startDate, endDate } = getDateRange(selectedFilters.date);
        const { events } = await NightOutExperiencesService.getEvents(
          { lat: nightOutGpsLat, lng: nightOutGpsLng },
          {
            radius: 50,
            keywords: GENRE_TO_KEYWORDS[selectedFilters.genre],
            startDate,
            endDate,
            sort: "date,asc",
          }
        );
        const cards = events.map(transformNightOutVenue);
        setNightOutCards(cards);
        saveNightOutCache(cards);
      } catch (err) {
        console.error("[Discover] Error fetching events:", err);
        setNightOutError(t("discover:errors.failed_events"));
      } finally {
        setNightOutLoading(false);
      }
    },
    // loadNightOutCache + saveNightOutCache change with user/gps/genre — captured via
    // the primitives below; excluded from deps so this callback is stable within a
    // filter combination (the effect below re-runs on primitive changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nightOutGpsLat, nightOutGpsLng, selectedFilters.date, selectedFilters.genre, t]
  );

  useEffect(() => {
    if (nightOutFetchTimeoutRef.current) {
      clearTimeout(nightOutFetchTimeoutRef.current);
    }
    nightOutFetchTimeoutRef.current = setTimeout(() => {
      fetchNightOutEvents();
    }, 300);
    return () => {
      if (nightOutFetchTimeoutRef.current) {
        clearTimeout(nightOutFetchTimeoutRef.current);
      }
    };
  }, [fetchNightOutEvents]);

  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    await clearNightOutCache();
    await fetchNightOutEvents(true);
    setIsRefreshing(false);
  };

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
    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  const handleCloseExpandedModal = (): void => {
    setIsExpandedModalVisible(false);
    setSelectedCardForExpansion(null);
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
    setSelectedFilters({ date: "any", price: "any", genre: "all" });
  };

  // Client-side price filter + sort by nearest date
  const filteredNightOutCards = useMemo(() => {
    let filtered = nightOutCards;
    if (selectedFilters.price !== "any") {
      filtered = filtered.filter((card) => {
        if (card.priceMin === null && card.priceMax === null) return false;
        const min = card.priceMin || 0;
        const max = card.priceMax || min;
        switch (selectedFilters.price) {
          case "free":
            return max === 0;
          case "under-25":
            return min < 25;
          case "25-50":
            return min <= 50 && max >= 25;
          case "50-100":
            return min <= 100 && max >= 50;
          case "over-100":
            return max > 100;
          default:
            return true;
        }
      });
    }
    filtered = [...filtered].sort((a, b) => {
      const dateA = a.localDate || "9999-12-31";
      const dateB = b.localDate || "9999-12-31";
      return dateA.localeCompare(dateB);
    });
    return filtered;
  }, [nightOutCards, selectedFilters.price]);

  const moreChipBadgeCount =
    (selectedFilters.price !== "any" ? 1 : 0) + (selectedFilters.genre !== "all" ? 1 : 0);

  // Filter modal option lists
  const dateFilterOptions: { id: DateFilter; label: string }[] = [
    { id: "any", label: t("discover:filters.any_date") },
    { id: "today", label: t("discover:filters.today") },
    { id: "tomorrow", label: t("discover:filters.tomorrow") },
    { id: "weekend", label: t("discover:filters.this_weekend") },
    { id: "next-week", label: t("discover:filters.next_week") },
    { id: "month", label: t("discover:filters.this_month") },
  ];
  const priceFilterOptions: { id: PriceFilter; label: string }[] = [
    { id: "any", label: t("discover:filters.any_price") },
    ...PRICE_TIERS.filter((tier) => tier.slug !== "any").map((tier) => ({
      id: tier.slug as PriceFilter,
      label: `${t(`common:tier_${tier.slug}`)} · ${t(`common:tier_range_${tier.slug}`)}`,
    })),
  ];
  const genreFilterOptions: { id: GenreFilter; label: string }[] = [
    { id: "all", label: t("discover:filters.all_genres") },
    { id: "afrobeats", label: t("discover:filters.afrobeats") },
    { id: "dancehall", label: t("discover:filters.dancehall") },
    { id: "hiphop-rnb", label: t("discover:filters.hiphop_rnb") },
    { id: "house", label: t("discover:filters.house") },
    { id: "techno", label: t("discover:filters.techno") },
    { id: "jazz-blues", label: t("discover:filters.jazz_blues") },
    { id: "latin-salsa", label: t("discover:filters.latin_salsa") },
    { id: "reggae", label: t("discover:filters.reggae") },
    { id: "kpop", label: t("discover:filters.kpop") },
    { id: "acoustic-indie", label: t("discover:filters.acoustic_indie") },
  ];

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
  const FILTER_BAR_TOP = TITLE_TOP + TITLE_BAND_HEIGHT;
  const HEADER_PANEL_HEIGHT = FILTER_BAR_TOP + FILTER_BAR_HEIGHT;
  const HEADER_PANEL_RADIUS = 28;

  // Grid content branching
  const hasCache = nightOutCards.length > 0;
  const showLoadingSkeleton = nightOutLoading && nightOutCards.length === 0;
  const showError = !nightOutLoading && nightOutError !== null && !hasCache;
  const showEmpty =
    !nightOutLoading && !nightOutError && nightOutCards.length === 0;
  const showFilterNoMatch =
    !nightOutLoading &&
    !nightOutError &&
    nightOutCards.length > 0 &&
    filteredNightOutCards.length === 0;
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
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            accessibilityRole="header"
            allowFontScaling
          >
            Concerts & Events
          </Text>
        </View>

        {/* Filter bar — scrolling chips on the left, pinned Filters button on the right */}
        <View style={[styles.filterBarAbsolute, { top: FILTER_BAR_TOP, height: FILTER_BAR_HEIGHT }]}>
          <View style={styles.filterBarScrollWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <FilterChip
                label="All"
                active={isFilterActive("any")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "any" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label="Tonight"
                active={isFilterActive("today")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "today" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label="This Weekend"
                active={isFilterActive("weekend")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "weekend" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label="Next Week"
                active={isFilterActive("next-week")}
                onPress={() => setSelectedFilters((p) => ({ ...p, date: "next-week" }))}
                reduceMotion={reduceMotion}
                reduceTransparency={reduceTransparency}
              />
              <FilterChip
                label="This Month"
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
              label="Filters"
              icon="options-outline"
              badgeCount={moreChipBadgeCount}
              onPress={handleOpenFilterModal}
              reduceMotion={reduceMotion}
              reduceTransparency={reduceTransparency}
            />
          </View>
        </View>
      </View>

      {/* Scrollable content — grid only; header stays fixed above */}
      <ScrollView
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
            title={t("discover:empty.no_events_title")}
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
          <View style={styles.gridWrap}>
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
        ) : null}
      </ScrollView>

      {/* Expanded Card Modal */}
      <ExpandedCardModal
        visible={isExpandedModalVisible}
        card={selectedCardForExpansion}
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
                setSelectedCardForExpansion(expandedCardListRef.current[next]);
              }
            : undefined
        }
        onNavigatePrevious={
          expandedCardIndex != null && expandedCardIndex > 0
            ? () => {
                const prev = expandedCardIndex - 1;
                setExpandedCardIndex(prev);
                setSelectedCardForExpansion(expandedCardListRef.current[prev]);
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

      {/* Night Out Filter Modal (content unchanged from Phase 1 — trigger moved to More chip) */}
      <Modal
        visible={isFilterModalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseFilterModal}
      >
        <View style={styles.filterModalOverlay}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={handleCloseFilterModal}
          />
          <View style={styles.filterModalContent}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>{t("discover:filters.title")}</Text>
              <TouchableOpacity onPress={handleCloseFilterModal} style={styles.modalCloseButton}>
                <Icon name="x" size={24} color="rgba(255,255,255,0.65)" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.filterModalScrollView} showsVerticalScrollIndicator={false}>
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

              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="tag" size={20} color={glass.chrome.active.glowColor} />
                  <Text style={styles.filterSectionTitle}>{t("discover:filters.price_range")}</Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {priceFilterOptions.map((option) => {
                    const selected = selectedFilters.price === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[
                          styles.filterOptionBadge,
                          selected && styles.filterOptionBadgeSelected,
                        ]}
                        onPress={() => setSelectedFilters({ ...selectedFilters, price: option.id })}
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
              </View>
            </ScrollView>

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
          </View>
        </View>
      </Modal>
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
    fontSize: d.title.fontSize,
    fontWeight: d.title.fontWeight,
    lineHeight: 32,
    color: d.title.color,
    // Counter iOS font leading so the glyphs sit tight to the top of the band.
    marginTop: Platform.OS === "ios" ? -4 : 0,
    includeFontPadding: false,
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
  filterModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  filterModalContent: {
    backgroundColor: "rgba(22,24,28,1)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 28,
    maxHeight: "85%",
  },
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
