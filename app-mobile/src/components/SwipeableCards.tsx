import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Pressable,
  Image,
  StyleSheet,
  Animated,
  Easing,
  PanResponder,
  StatusBar,
  Platform,
} from "react-native";
import { useTranslation } from 'react-i18next';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HapticFeedback } from "../utils/hapticFeedback";
import { Icon } from "./ui/Icon";
import { throttledReverseGeocode } from '../utils/throttledGeocode';

import { ImageWithFallback } from "./figma/ImageWithFallback";
import { formatCurrency, formatDistance, parseAndFormatDistance, formatPriceRange, getCurrencySymbol, getCurrencyRate } from "./utils/formatters";
import { PriceTierSlug, tierLabel, tierRangeLabel, googleLevelToTierSlug, TIER_BY_SLUG, formatTierLabel } from "../constants/priceTiers";
import {
  ExperiencesService,
  Experience,
  UserPreferences,
} from "../services/experiencesService";
import {
  ExperienceGenerationService,
  GeneratedExperience,
} from "../services/experienceGenerationService";
import { useAppStore } from "../store/appStore";
import { useUserPreferences } from "../hooks/useUserPreferences";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { CuratedExperienceSwipeCard } from "./CuratedExperienceSwipeCard";
import type { CuratedExperienceCard } from "../types/curatedExperience";
import { mixpanelService } from "../services/mixpanelService";
import { logAppsFlyerEvent } from "../services/appsFlyerService";
import { BoardCardService } from "../services/boardCardService";
import { notifyMatch } from "../services/boardNotificationService";
import { inAppNotificationService } from "../services/inAppNotificationService";
import { recordCardSwipe, recordCardExpand } from "../services/cardEngagementService";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useRecommendations,
  Recommendation,
  DeckUIState,
} from "../contexts/RecommendationsContext";
import { DismissedCardsSheet } from "./DismissedCardsSheet";
import { getReadableCategoryName } from "../utils/categoryUtils";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { SkeletonCard } from './SkeletonCard';
import { useFeatureGate } from '../hooks/useFeatureGate';
import { getTierLimits } from '../constants/tierLimits';
import { useCreatorTier } from '../hooks/useCreatorTier';
import { CustomPaywallScreen } from './CustomPaywallScreen';
import type { GatedFeature } from '../hooks/useFeatureGate';

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
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

const IMAGE_SECTION_RATIO = 0.88;
const DETAILS_SECTION_RATIO = 1 - IMAGE_SECTION_RATIO;
const CARD_ANIMATION_DURATION = 400;

const CARD_FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

/** Card hero image with automatic fallback on load failure */
function CardHeroImage({ uri, style }: { uri: string; style: any }) {
  const [src, setSrc] = React.useState(uri && uri.length > 0 ? uri : CARD_FALLBACK_IMAGE);
  React.useEffect(() => {
    setSrc(uri && uri.length > 0 ? uri : CARD_FALLBACK_IMAGE);
  }, [uri]);
  return (
    <Image
      source={{ uri: src }}
      style={style}
      resizeMode="cover"
      onError={() => {
        if (src !== CARD_FALLBACK_IMAGE) setSrc(CARD_FALLBACK_IMAGE);
      }}
    />
  );
}

/** Map travel mode preference to an icon name */
function getTravelModeIcon(mode?: string): string {
  switch (mode) {
    case 'driving': return 'car';
    case 'transit': return 'bus-outline';
    case 'bicycling':
    case 'biking': return 'bicycle-outline';
    case 'walking':
    default: return 'walk-outline';
  }
}

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
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string; // Key that changes to trigger refresh
  savedCards?: any[]; // Array of saved card IDs or card objects
}

// Real data will be fetched from Supabase

const getIconComponent = (iconName: string) => {
  // If iconName is already an Ionicons name (from getCategoryIcon), return it directly
  const ioniconsNames = [
    "walk-outline",
    "cafe",
    "restaurant",
    "film",
    "brush",
    "basketball",
    "wine",
    "sparkles",
    "basket",
    "location",
    "leaf",
    "fitness",
    "eye",
    "heart",
    "calendar",
    "time",
    "star",
    "navigate",
    "color-palette",
    "bookmark",
  ];

  if (ioniconsNames.includes(iconName)) {
    return iconName;
  }

  // Map component names to Ionicons names (for backward compatibility)
  const iconMap: { [key: string]: string } = {
    Coffee: "cafe",
    TreePine: "leaf",
    Sparkles: "sparkles",
    Dumbbell: "fitness",
    Utensils: "restaurant",
    Eye: "eye",
    Heart: "heart",
    Calendar: "calendar",
    MapPin: "location",
    Clock: "time",
    Star: "star",
    Navigation: "navigate",
    Palette: "color-palette",
    Bookmark: "bookmark",
  };

  return iconMap[iconName] || iconName || "heart";
};

/** Shared pulsing-dots loading indicator */
function PulseDots({ size = 8, speed = 600 }: { size?: number; speed?: number }) {
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
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
  }, [speed]);

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
  onCardLike,
  accountPreferences,
  onAddToCalendar,
  onShareCard,
  onPurchaseComplete,
  removedCardIds = [],
  onResetCards,
  onOpenPreferences,
  onOpenCollabPreferences,
  generateNewMockCard,
  onboardingData,
  refreshKey,
  savedCards = [],
}: SwipeableCardsProps) {
  const { t } = useTranslation(['cards', 'common']);
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
    addSwipedCard,
    sessionSwipedCards,
    isExhausted,
    deckUIState,
    collabTravelMode,
  } = useRecommendations();

  const isAnyLoading = loading || isModeTransitioning || isWaitingForSessionResolution;

  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());
  const [currentCardIndex, setCurrentCardIndex] = useState(0);

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
  const [showNextBatchLoader, setShowNextBatchLoader] = useState(false);
  const [dismissedSheetVisible, setDismissedSheetVisible] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  const previousBatchRefreshKeyRef = useRef<number | string | undefined>(
    refreshKey
  );

  // Get current session for board saving
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();
  const user = useAppStore((state) => state.user);
  const { data: cachedPreferences } = useUserPreferences(user?.id);
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
  // Refs for PanResponder (created once) to read fresh values
  const canAccessRef = useRef(canAccess);
  useEffect(() => { canAccessRef.current = canAccess; });

  // Storage keys for persisting card state
  const getStorageKeys = () => {
    const baseKey = `mingla_card_state_${currentMode}_${refreshKey || 0}`;
    return {
      index: `${baseKey}_index`,
      removedCards: `${baseKey}_removed`,
    };
  };

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

  // Resolve session ID from currentMode if currentSession is not available
  // currentMode can be either "solo", a session name, or a session ID
  const resolvedSessionId = React.useMemo(() => {
    if (currentMode === "solo") return null;

    // If we have currentSession, use its ID
    if (currentSession?.id) return currentSession.id;

    // Otherwise, try to find session by name or ID from availableSessions
    const session = availableSessions.find(
      (s) => s.id === currentMode || s.name === currentMode
    );
    return session?.id || null;
  }, [currentMode, currentSession, availableSessions]);

  // isWaitingForSessionResolution is now provided by RecommendationsContext

  // Check if we're in a board/collab session.
  // ORCH-0395: Use resolvedSessionId (derived from currentMode + availableSessions).
  // NOT currentSession?.id — useSessionManagement.currentSession is always null because
  // switchToCollaborative() is never called from the session selection flow.
  const isBoardSession =
    currentMode !== "solo" && !!resolvedSessionId;

  // Load board preferences if in board session
  // Use hook unconditionally (React rules) but pass undefined when not in board session
  const boardSessionResult = useBoardSession(
    isBoardSession && resolvedSessionId ? resolvedSessionId : undefined
  );
  const boardPreferences = boardSessionResult?.preferences || null;

  // Use ref to store current recommendations for PanResponder
  const recommendationsRef = useRef<Recommendation[]>([]);
  const removedCardsRef = useRef<Set<string>>(new Set());
  const currentCardIndexRef = useRef(0);
  const previousBatchIdsRef = useRef<string>('');
  const handleSwipeRef = useRef<((direction: "left" | "right", card: Recommendation) => Promise<void>) | null>(null);
  const handleCardExpandRef = useRef<(() => Promise<void>) | null>(null);
  const removedCardIdsRef = useRef<string[]>(removedCardIds);

  // Update refs when state changes
  useEffect(() => {
    recommendationsRef.current = recommendations;
    removedCardsRef.current = removedCards;
    currentCardIndexRef.current = currentCardIndex;
    removedCardIdsRef.current = removedCardIds;
  }, [recommendations, removedCards, currentCardIndex, removedCardIds]);

  // Swipe animation values
  const position = useRef(new Animated.ValueXY()).current;
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ["-30deg", "0deg", "30deg"],
  });
  const likeOpacity = position.x.interpolate({
    inputRange: [0, SCREEN_WIDTH / 4],
    outputRange: [0, 1],
  });
  const nopeOpacity = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 4, 0],
    outputRange: [1, 0],
  });
  const nextCardOpacity = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [1, 0, 1],
  });

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
      if (isExhausted) return { type: 'EXHAUSTED' };
      return { type: 'EMPTY' };
    }
    return deckUIState;
  }, [deckUIState, availableRecommendations.length, isExhausted]);

  // ── Prefetch next 2 card images for instant swipe transitions ──
  // When the current card changes, prefetch the images for the next 2 cards.
  // Image.prefetch downloads to the native image cache (OkHttp on Android,
  // NSURLCache on iOS). Failures are silently ignored — the image will load
  // normally when the card becomes visible.
  const currentCardId = availableRecommendations[0]?.id;
  useEffect(() => {
    const nextCard = availableRecommendations[1];
    if (nextCard?.image) {
      Image.prefetch(nextCard.image).catch(() => {});
    }
    const cardAfterNext = availableRecommendations[2];
    if (cardAfterNext?.image) {
      Image.prefetch(cardAfterNext.image).catch(() => {});
    }
  }, [currentCardId]);

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
  const isCurrentCardSaved = currentRec ? savedCards.some(
    (s: any) => s?.id === currentRec.id || s === currentRec.id
  ) : false;

  // Track card viewed when the current card changes
  const lastViewedCardIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentRec && currentRec.id !== lastViewedCardIdRef.current) {
      lastViewedCardIdRef.current = currentRec.id;
      mixpanelService.trackCardViewed({
        card_id: currentRec.id,
        card_title: currentRec.title,
        category: currentRec.category,
        position_in_deck: currentCardIndex,
        is_curated: (currentRec as any).cardType === 'curated',
      });
    }
  }, [currentRec?.id, currentCardIndex]);

  // Trigger card content entrance animations when current card changes
  useEffect(() => {
    if (currentRec) {
      // Reset animation values
      cardContentOpacity.setValue(0);
      matchBadgeSlide.setValue(-20);
      titleOverlaySlide.setValue(30);

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
  }, [currentRec?.id]);

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

      if (preferencesChanged || modeChanged) {
        // Preferences or mode changed - full state reset
        console.log(
          "🔄 State reset - Preferences changed:",
          preferencesChanged,
          "Mode changed:",
          modeChanged
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
        position.setValue({ x: 0, y: 0 });

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
  }, [recommendations.length, refreshKey, currentMode, removedCardIds]);

  // Save state to AsyncStorage whenever it changes
  useEffect(() => {
    // Don't save until we've restored (to avoid saving default values)
    if (!hasRestoredStateRef.current || !recommendations.length) {
      return;
    }

    const saveState = async () => {
      try {
        const keys = getStorageKeys();
        await AsyncStorage.multiSet([
          [keys.index, currentCardIndex.toString()],
          [keys.removedCards, JSON.stringify(Array.from(removedCards))],
        ]);
      } catch (error) {
        console.error("Error saving state to AsyncStorage:", error);
      }
    };

    saveState();
  }, [
    currentCardIndex,
    removedCards,
    recommendations.length,
    currentMode,
    refreshKey,
  ]);

  // Detect full deck replacement vs batch append.
  // Only clear removedCards when the FIRST 5 card IDs change (full replacement).
  // When new cards are appended to the end (batch 2+), the first 5 IDs stay the
  // same — the user keeps their swipe progress.
  // Preference/mode change resets are already handled at line ~798.
  useEffect(() => {
    if (!recommendations || recommendations.length === 0) return;

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
  }, [recommendations]);

  // PanResponder for swipe gestures
  // CLOSURE INVARIANT: This PanResponder is created once and never recreated.
  // All external values (functions, props, state) MUST be accessed via refs inside
  // these handlers. Direct variable access will be stale (captured from initial render).
  // Current refs: recommendationsRef, removedCardsRef, currentCardIndexRef,
  // removedCardIdsRef, handleSwipeRef, handleCardExpandRef.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        position.setOffset({
          x: (position.x as any)._value,
          y: (position.y as any)._value,
        });
      },
      onPanResponderMove: (_, gestureState) => {
        position.setValue({ x: gestureState.dx, y: gestureState.dy });
      },
      onPanResponderRelease: (_, gestureState) => {
        position.flattenOffset();

        // Get current card from refs (always fresh)
        const availableCards = recommendationsRef.current.filter(
          (rec) =>
            !removedCardsRef.current.has(rec.id) &&
            !removedCardIdsRef.current.includes(rec.id)
        );
        const cardToRemove = availableCards[currentCardIndexRef.current];

        // Check for swipe up (expand card)
        if (gestureState.dy < -50 && Math.abs(gestureState.dx) < 50) {
          if (cardToRemove) {
            HapticFeedback.medium();
            handleCardExpandRef.current?.();
          }
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
          return;
        }

        // Check for horizontal swipe
        if (Math.abs(gestureState.dx) > 120) {
          const direction = gestureState.dx > 0 ? "right" : "left";

          // Haptic feedback — immediate tactile response before animation
          if (direction === "right") {
            HapticFeedback.cardLike();
          } else {
            HapticFeedback.cardDislike();
          }

          // Check if card exists
          if (!cardToRemove) {
            console.warn("No card to swipe");
            Animated.spring(position, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: false,
            }).start();
            return;
          }

          // Gate: curated card right-swipe (save) requires Mingla+
          if (
            direction === 'right' &&
            (cardToRemove as any).cardType === 'curated' &&
            !canAccessRef.current('curated_cards')
          ) {
            HapticFeedback.medium();
            setPaywallFeature('curated_cards');
            setShowPaywall(true);
            Animated.spring(position, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: false,
            }).start();
            return;
          }

          // Animate card off the screen edge
          Animated.timing(position, {
            toValue: {
              x: direction === "right" ? SCREEN_WIDTH : -SCREEN_WIDTH,
              y: gestureState.dy,
            },
            duration: 250,
            useNativeDriver: false,
          }).start(() => {
            // After animation completes, remove the card and advance to next
            setRemovedCards((prev) => {
              const newSet = new Set([...prev, cardToRemove.id]);
              return newSet;
            });

            // Move to next card
            setCurrentCardIndex(0);

            // RELIABILITY: .catch() on fire-and-forget handleSwipe. Without this,
            // any error becomes an unhandled promise rejection.
            handleSwipeRef.current?.(direction, cardToRemove)?.catch((err) => {
              console.error('[SwipeableCards] Swipe handler error:', err);
            });

            // Wait for React to render the next card before resetting position
            // This prevents the flash/flicker
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                position.setValue({ x: 0, y: 0 });
              });
            });
          });
        } else {
          // Snap back to center
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const handleCardTap = () => {
    // Only handle tap if card is not being dragged
    const currentX = (position.x as any)._value || 0;
    const currentY = (position.y as any)._value || 0;
    if (Math.abs(currentX) < 10 && Math.abs(currentY) < 10 && currentRec) {
      handleCardExpand();
    }
  };

  const handleCardExpand = async () => {
    if (!currentRec) return;
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

    // Transform Recommendation to ExpandedCardData
    const expandedCardData: ExpandedCardData = {
      id: currentRec.id,
      placeId: currentRec.placeId ?? currentRec.id,
      title: currentRec.title,
      category: currentRec.category,
      categoryIcon: currentRec.categoryIcon,
      description: currentRec.description,
      fullDescription: currentRec.fullDescription || currentRec.description,
      image: currentRec.image,
      images: currentRec.images?.length ? currentRec.images : [currentRec.image].filter(Boolean),
      rating: currentRec.rating ?? 0,
      reviewCount: currentRec.reviewCount ?? 0,
      priceRange: currentRec.priceRange || 'Free',
      distance: currentRec.distance || '',
      travelTime: currentRec.travelTime || '',
      address: currentRec.address,
      openingHours: currentRec.openingHours,
      highlights: currentRec.highlights || [],
      tags: currentRec.tags || [],
      matchScore: currentRec.matchScore,
      matchFactors: currentRec.matchFactors,
      socialStats: currentRec.socialStats,
      location:
        currentRec.lat != null && currentRec.lng != null
          ? { lat: currentRec.lat, lng: currentRec.lng }
          : userLocation
          ? { lat: userLocation.lat, lng: userLocation.lng }
          : undefined,
      selectedDateTime: userPreferences?.datetime_pref
        ? new Date(userPreferences.datetime_pref)
        : new Date(),
      tip: currentRec.tip ?? undefined,
      // Include strollData if it already exists on the card
      strollData: currentRec.strollData,
      // Pass through website/phone for Policies & Reservations button
      website: currentRec.website ?? undefined,
      phone: currentRec.phone ?? undefined,
      priceTier: currentRec.priceTier as ExpandedCardData['priceTier'],
    };

    setSelectedCardForExpansion(expandedCardData);
  };

  const handleCloseExpandedModal = () => {
    setIsExpandedModalVisible(false);
    setSelectedCardForExpansion(null);
  };

  const handleSwipe = async (
    direction: "left" | "right",
    card: Recommendation
  ) => {
    if (!card) return;

    // Track swiped card in session history
    addSwipedCard(card);

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
    }

    try {
      // Track interaction in Supabase (only if user is authenticated)
      if (user?.id) {
        // Curated cards don't have a single place_id — skip Supabase operations
        if ((card as any).cardType === 'curated') {
          // ORCH-0408 Phase 4: ExperiencesService.trackInteraction removed — consolidated into record_card_interaction RPC

          if (direction === 'right') {
            // ORCH-0395: In collab mode, skip onCardLike (direct save). The DB trigger
            // check_mutual_like handles saving after 2+ right-swipes.
            // Solo mode: save immediately via onCardLike as before.
            if (!isBoardSession) {
              const saveResult = await onCardLike(card);
              if (saveResult === false) {
                setRemovedCards((prev) => {
                  const newSet = new Set(prev);
                  newSet.delete(card.id);
                  return newSet;
                });
                return;
              }
            }
          }
          // Left-swipe dismissal tracking handled in the shared block below
        } else {

        // ORCH-0408 Phase 4: ExperiencesService.trackInteraction removed — consolidated into record_card_interaction RPC

        // Save to Supabase if swiped right (liked)
        if (direction === "right") {
          try {
            await ExperiencesService.saveExperience(user.id, card.id, "liked", {
              title: card.title,
              category: card.category,
              place_id: card.id,
              lat: card.lat,
              lng: card.lng,
              image_url: card.image || card.images?.[0],
              opening_hours: card.openingHours,
              meta: {
                matchScore: card.matchScore,
                reviewCount: card.reviewCount,
              },
            });
          } catch (saveError: any) {
            if (saveError?.code === "23505") {
              console.warn(
                "Experience already saved for this user, skipping duplicate save"
              );
              // Don't throw - consider this a success (already saved)
            } else {
              console.error("Error saving experience:", saveError);
              // Re-throw other errors so they can be handled by the caller
              throw saveError;
            }
          }

          // ORCH-0395: In collab mode, skip onCardLike (direct save). The DB trigger
          // check_mutual_like handles saving after 2+ right-swipes.
          // Solo mode: save immediately via onCardLike as before.
          if (!isBoardSession) {
            const saveResult = await onCardLike(card);
            if (saveResult === false) {
              setRemovedCards((prev) => {
                const newSet = new Set(prev);
                newSet.delete(card.id);
                return newSet;
              });
              return;
            }
          }
        } else {
          // Track dislike
          try {
            await ExperiencesService.saveExperience(
              user.id,
              card.id,
              "disliked",
              {
                title: card.title,
                category: card.category,
                place_id: card.id,
                lat: card.lat,
                lng: card.lng,
                image_url: card.image || card.images?.[0],
                opening_hours: card.openingHours,
                meta: {
                  matchScore: card.matchScore,
                  reviewCount: card.reviewCount,
                },
              }
            );
          } catch (dislikeError) {
            console.error("Error tracking dislike:", dislikeError);
            // Continue without tracking dislike
          }
        }

        // Track swipe state for board sessions
        if (isBoardSession && resolvedSessionId) {
          try {
            await BoardCardService.trackSwipeState({
              sessionId: resolvedSessionId,
              experienceId: card.id,
              userId: user.id,
              swipeDirection: direction,
            });

            // ORCH-0395: After tracking swipe, check if the DB trigger created a match.
            // Only check on right-swipe — left-swipes can't trigger a match.
            if (direction === 'right') {
              const matchResult = await BoardCardService.checkForMatch(
                resolvedSessionId,
                card.id
              );
              if (matchResult.matched && matchResult.savedCardId && matchResult.matchedUserIds) {
                // Fire-and-forget: send push + in-app notification to all participants
                notifyMatch({
                  sessionId: resolvedSessionId,
                  savedCardId: matchResult.savedCardId,
                  experienceId: card.id,
                  cardTitle: matchResult.cardTitle || card.title || 'a spot',
                  matchedUserIds: matchResult.matchedUserIds,
                });

                // Local in-app notification for the current user
                inAppNotificationService.add(
                  'board_card_matched',
                  "It's a match! 🎉",
                  `You and others liked ${matchResult.cardTitle || card.title || 'a spot'}`,
                  { page: 'home', sessionId: resolvedSessionId }
                );
              }
            }
          } catch (swipeStateError) {
            console.error("Error tracking swipe state:", swipeStateError);
            // Continue even if swipe state tracking fails
          }
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

  // Sync function refs for PanResponder (must be after function definitions)
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

  const handleSaveDismissedCard = useCallback((card: Recommendation) => {
    onCardLike(card);
  }, [onCardLike]);

  const recommendationToExpanded = useCallback((card: Recommendation): ExpandedCardData => {
    if ((card as any).cardType === 'curated') {
      return card as unknown as ExpandedCardData;
    }
    return {
      id: card.id,
      placeId: card.placeId ?? card.id,
      title: card.title,
      category: card.category,
      categoryIcon: card.categoryIcon,
      description: card.description,
      fullDescription: card.fullDescription || card.description,
      image: card.image,
      images: card.images?.length ? card.images : [card.image].filter(Boolean),
      rating: card.rating ?? 0,
      reviewCount: card.reviewCount ?? 0,
      priceRange: card.priceRange || 'Free',
      distance: card.distance || '',
      travelTime: card.travelTime || '',
      address: card.address,
      openingHours: card.openingHours,
      highlights: card.highlights || [],
      tags: card.tags || [],
      matchScore: card.matchScore,
      matchFactors: card.matchFactors,
      socialStats: card.socialStats,
      location:
        card.lat != null && card.lng != null
          ? { lat: card.lat, lng: card.lng }
          : userLocation
          ? { lat: userLocation.lat, lng: userLocation.lng }
          : undefined,
      selectedDateTime: userPreferences?.datetime_pref
        ? new Date(userPreferences.datetime_pref)
        : new Date(),
      tip: card.tip ?? undefined,
      strollData: card.strollData,
      website: card.website ?? undefined,
      phone: card.phone ?? undefined,
    };
  }, [userLocation, userPreferences]);

  const handleDismissedCardPress = useCallback((card: Recommendation) => {
    // Find this card's index in the reversed session list (most recent first)
    const reversedCards = [...sessionSwipedCards].reverse();
    const idx = reversedCards.findIndex(c => c.id === card.id);
    setReviewIndex(idx >= 0 ? idx : 0);

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
    position.setValue({ x: 0, y: 0 });

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
    case 'EXHAUSTED':
      // Fire deck exhausted once per deck load
      if (lastViewedCardIdRef.current !== '__deck_exhausted__') {
        mixpanelService.trackDeckExhausted({
          cards_seen: currentCardIndex,
          cards_saved: savedCards.length,
          cards_dismissed: Math.max(0, currentCardIndex - savedCards.length),
          session_mode: 'solo',
        });
        lastViewedCardIdRef.current = '__deck_exhausted__';
      }
      return (
        <>
          <View style={styles.emptyDeckContainer}>
            <View style={styles.emptyDeckContent}>
              <View style={styles.emptyDeckIconCircle}>
                <Icon name="earth-outline" size={24} color="#eb7825" />
              </View>
              <Text style={styles.emptyDeckTitle}>
                {t('cards:swipeable.seen_everything')}
              </Text>
              <Text style={styles.emptyDeckSubtitle}>
                {t('cards:swipeable.shift_vibe')}
              </Text>

              <View style={styles.emptyDeckActions}>
                <TouchableOpacity
                  style={styles.emptyDeckButton}
                  onPress={handleOpenPreferences}
                  activeOpacity={0.7}
                >
                  <Icon name="options-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.emptyDeckButtonText}>{t('cards:swipeable.shift_preferences')}</Text>
                </TouchableOpacity>

                {sessionSwipedCards.length > 0 && (
                  <TouchableOpacity
                    style={styles.emptyDeckOutlineButton}
                    onPress={() => setDismissedSheetVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Icon name="time-outline" size={16} color="#eb7825" />
                    <Text style={styles.emptyDeckOutlineButtonText}>
                      {t('cards:swipeable.review_all_cards')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
          <DismissedCardsSheet
            visible={dismissedSheetVisible}
            onClose={() => setDismissedSheetVisible(false)}
            dismissedCards={dismissedCards}
            sessionSwipedCards={sessionSwipedCards}
            onSave={handleSaveDismissedCard}
            onCardPress={handleDismissedCardPress}
          />
          <ExpandedCardModal
            visible={isExpandedModalVisible}
            card={selectedCardForExpansion}
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
                onCardLike?.(card);
                mixpanelService.trackCardSaved({
                  card_id: card.id,
                  card_title: card.title,
                  category: card.category,
                  is_curated: (card as any).cardType === 'curated',
                  source: 'dismissed_sheet',
                });
                handleCloseExpandedModal();
              } catch (error: any) {
                if (error?.code === "23505") {
                  handleCloseExpandedModal();
                }
                throw error;
              }
            }}
            onPurchase={(card, bookingOption) => {
              onPurchaseComplete?.(card, bookingOption);
              handleCloseExpandedModal();
            }}
            onShare={(card) => {
              onShareCard?.(card);
            }}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            onNavigateNext={reviewIndex < reviewCards.length - 1 ? handleReviewNext : undefined}
            onNavigatePrevious={reviewIndex > 0 ? handleReviewPrevious : undefined}
            navigationIndex={reviewIndex}
            navigationTotal={reviewCards.length}
            canAccessCurated={canAccess('curated_cards')}
            onPaywallRequired={() => {
              handleCloseExpandedModal();
              setPaywallFeature('curated_cards');
              setShowPaywall(true);
            }}
          />
        </>
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

  const CategoryIcon = getIconComponent(currentRec.categoryIcon);

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        <View style={styles.cardContainer}>
          {/* View Previous overlay — appears after first swipe */}
          {sessionSwipedCards.length > 0 && (
            <TouchableOpacity
              style={styles.batchChip}
              onPress={() => setDismissedSheetVisible(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="time-outline" size={14} color="#6b7280" />
              <Text style={styles.batchChipText}>
                {t('cards:swipeable.viewed', { count: sessionSwipedCards.length })}
              </Text>
            </TouchableOpacity>
          )}
          {showNextBatchLoader && (
            <View style={styles.nextBatchOverlay} pointerEvents="none">
              <PulseDots size={8} speed={400} />
            </View>
          )}

          {/* Next Card (behind current) - fully rendered with all details */}
          {availableRecommendations.length > 1 &&
            (() => {
              const nextCard = availableRecommendations[1];
              const NextCategoryIcon = getIconComponent(nextCard.categoryIcon);

              return (
                <Animated.View
                  style={[
                    styles.card,
                    styles.nextCard,
                    {
                      opacity: nextCardOpacity,
                      transform: [{ scale: 0.95 }],
                    },
                  ]}
                >
                  <View style={styles.cardInner}>
                  {/* Hero Image Section */}
                  <View style={[styles.imageContainer, { backgroundColor: '#1a1a2e' }]}>
                    <CardHeroImage uri={nextCard.image} style={styles.cardImage} />

                    {/* Gallery Indicator if multiple images */}
                    {nextCard.images && nextCard.images.length > 1 && (
                      <View style={styles.galleryIndicator}>
                        <Icon name="images" size={16} color="white" />
                        <Text style={styles.galleryText}>
                          {nextCard.images.length}
                        </Text>
                      </View>
                    )}

                    {/* Title and Details Overlay */}
                    <View style={styles.titleOverlay}>
                      <Text style={styles.cardTitle}>{nextCard.title}</Text>

                      {/* Info badges: distance, travel time, rating, price */}
                      <View style={styles.detailsBadges}>
                        <View style={styles.detailBadge}>
                          <Icon name="location" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {parseAndFormatDistance(nextCard.distance, accountPreferences?.measurementSystem) || t('cards:swipeable.nearby')}
                          </Text>
                        </View>
                        {nextCard.travelTime && nextCard.travelTime !== '0 min' ? (
                          <View style={styles.detailBadge}>
                            <Icon name={getTravelModeIcon(nextCard.travelMode ?? effectiveTravelMode)} size={12} color="white" />
                            <Text style={styles.detailBadgeText}>
                              {nextCard.travelTime}
                            </Text>
                          </View>
                        ) : null}
                        {nextCard.rating != null && nextCard.rating > 0 && (
                          <View style={styles.detailBadge}>
                            <Icon name="star" size={12} color="white" />
                            <Text style={styles.detailBadgeText}>
                              {nextCard.rating.toFixed(1)}
                            </Text>
                          </View>
                        )}
                        <View style={styles.detailBadge}>
                          <Icon name="pricetag" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {nextCard.priceTier && TIER_BY_SLUG[nextCard.priceTier as PriceTierSlug]
                              ? formatTierLabel(nextCard.priceTier as PriceTierSlug, getCurrencySymbol(accountPreferences?.currency), getCurrencyRate(accountPreferences?.currency))
                              : formatPriceRange(nextCard.priceRange || t('cards:swipeable.free'), accountPreferences?.currency) || t('cards:swipeable.free')}
                          </Text>
                        </View>
                        <View style={styles.detailBadge}>
                          <Icon name={NextCategoryIcon} size={12} color="white" />
                          <Text style={styles.detailBadgeText}>{getReadableCategoryName(nextCard.category)}</Text>
                        </View>
                      </View>

                      {/* View more badge */}
                      <View style={styles.viewMoreRow}>
                        <View style={styles.viewMoreBadge}>
                          <Icon name="eye" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>{t('cards:swipeable.view_more')}</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* White Details Section */}
                  <View style={styles.cardDetails}>
                    {/* Share Button */}
                    <TouchableOpacity
                      style={styles.shareButton}
                      onPress={() => {
                        if (onShareCard) {
                          onShareCard(nextCard);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Icon
                        name="share-outline"
                        size={18}
                        color="#6b7280"
                      />
                      <Text style={styles.shareButtonText}>{t('cards:swipeable.share')}</Text>
                    </TouchableOpacity>
                  </View>
                  </View>
                </Animated.View>
              );
            })()}

          {/* Current Card */}
          <Animated.View
            style={[
              styles.card,
              {
                transform: [
                  { translateX: position.x },
                  { translateY: position.y },
                  { rotate: rotate },
                ],
              },
            ]}
            {...panResponder.panHandlers}
            pointerEvents="auto"
          >
            <View style={styles.cardInner}>
            {/* Swipe Direction Overlays */}
            <Animated.View
              style={[styles.swipeOverlayRight, { opacity: likeOpacity }]}
              pointerEvents="none"
            >
              <View style={styles.likeIndicator}>
                <Text style={styles.likeText}>{t('cards:swipeable.like')}</Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[styles.swipeOverlayLeft, { opacity: nopeOpacity }]}
              pointerEvents="none"
            >
              <View style={styles.passIndicator}>
                <Text style={styles.passText}>{t('cards:swipeable.pass')}</Text>
              </View>
            </Animated.View>

            <TouchableOpacity
              activeOpacity={1}
              onPress={handleCardTap}
              style={StyleSheet.absoluteFill}
            >
              {(currentRec as any).cardType === 'curated' ? (
                  <CuratedExperienceSwipeCard
                    card={currentRec as unknown as CuratedExperienceCard}
                    onSeePlan={handleCardExpand}
                    travelMode={effectiveTravelMode}
                    measurementSystem={accountPreferences?.measurementSystem}
                    currencyCode={accountPreferences?.currency || 'USD'}
                  />
              ) : (
                <>
                  {/* Hero Image Section - 60-65% of card */}
                  <View style={[styles.imageContainer, { backgroundColor: '#1a1a2e' }]}>
                    <CardHeroImage uri={currentRec.image} style={styles.cardImage} />

                    {/* Gallery Indicator if multiple images */}
                    {currentRec.images && currentRec.images.length > 1 && (
                      <View style={styles.galleryIndicator}>
                        <Icon name="images" size={16} color="white" />
                        <Text style={styles.galleryText}>
                          {currentRec.images.length}
                        </Text>
                      </View>
                    )}

                    {/* Title and Details Overlay - Bottom Left of Image */}
                    <Animated.View style={[
                      styles.titleOverlay,
                      {
                        opacity: cardContentOpacity,
                        transform: [{ translateY: titleOverlaySlide }],
                      },
                    ]}>
                      <Text style={styles.cardTitle}>{currentRec.title || t('cards:swipeable.experience')}</Text>
                      {currentRec.oneLiner && (
                        <Text style={styles.oneLiner} numberOfLines={1}>{currentRec.oneLiner}</Text>
                      )}

                      {/* Info badges: distance, travel time, rating, price */}
                      <View style={styles.detailsBadges}>
                        <View style={styles.detailBadge}>
                          <Icon name="location" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {parseAndFormatDistance(currentRec.distance, accountPreferences?.measurementSystem) || t('cards:swipeable.nearby')}
                          </Text>
                        </View>
                        {currentRec.travelTime && currentRec.travelTime !== '0 min' ? (
                          <View style={styles.detailBadge}>
                            <Icon name={getTravelModeIcon(currentRec.travelMode ?? effectiveTravelMode)} size={12} color="white" />
                            <Text style={styles.detailBadgeText}>
                              {currentRec.travelTime}
                            </Text>
                          </View>
                        ) : null}
                        {currentRec.rating != null && currentRec.rating > 0 && (
                          <View style={styles.detailBadge}>
                            <Icon name="star" size={12} color="white" />
                            <Text style={styles.detailBadgeText}>
                              {currentRec.rating.toFixed(1)}
                            </Text>
                          </View>
                        )}
                        <View style={styles.detailBadge}>
                          <Icon name="pricetag" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {currentRec.priceTier && TIER_BY_SLUG[currentRec.priceTier as PriceTierSlug]
                              ? formatTierLabel(currentRec.priceTier as PriceTierSlug, getCurrencySymbol(accountPreferences?.currency), getCurrencyRate(accountPreferences?.currency))
                              : formatPriceRange(currentRec.priceRange || t('cards:swipeable.free'), accountPreferences?.currency) || t('cards:swipeable.free')}
                          </Text>
                        </View>
                        <View style={styles.detailBadge}>
                          <Icon name={CategoryIcon} size={12} color="white" />
                          <Text style={styles.detailBadgeText}>{getReadableCategoryName(currentRec.category)}</Text>
                        </View>
                        {isCurrentCardSaved && (
                          <View style={styles.savedBadge}>
                            <Icon name="heart" size={10} color="white" />
                            <Text style={styles.savedBadgeText}>{t('cards:swipeable.saved')}</Text>
                          </View>
                        )}
                      </View>

                      {/* View more badge */}
                      <View style={styles.viewMoreRow}>
                        <View style={styles.viewMoreBadge}>
                          <Icon name="eye" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>{t('cards:swipeable.view_more')}</Text>
                        </View>
                      </View>
                    </Animated.View>
                  </View>

                  {/* White Details Section */}
                  <View style={styles.cardDetails}>
                    {/* Share Button */}
                    <TouchableOpacity
                      style={styles.shareButton}
                      onPress={handleShare}
                      activeOpacity={0.7}
                    >
                      <Icon
                        name="share-social-outline"
                        size={18}
                        color="#6b7280"
                      />
                      <Text style={styles.shareButtonText}>{t('cards:swipeable.share')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </View>

      {/* Expanded Card Modal */}
      <ExpandedCardModal
        visible={isExpandedModalVisible}
        card={selectedCardForExpansion}
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

              // Handle swipe logic (tracking, saving, etc.) - await to catch errors
              await handleSwipe("right", currentRec);
            } else {
              // Fallback: just call onCardLike if card doesn't match
              onCardLike?.(card);
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
        onSave={handleSaveDismissedCard}
        onCardPress={handleDismissedCardPress}
      />

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
      />
    </View>
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
  cardContainer: {
    width: SCREEN_WIDTH - 32,
    maxWidth: 500,
    position: "relative",
    flex: 1,
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "white",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.10)",
    shadowColor: Platform.OS === "android" ? "rgba(0, 0, 0, 0.08)" : "#000",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: Platform.OS === "android" ? 12 : 10,
    zIndex: 2,
  },
  cardInner: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
  },
  nextCard: {
    zIndex: 1,
  },
  imageContainer: {
    flex: IMAGE_SECTION_RATIO,
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  galleryIndicator: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  galleryText: {
    color: "white",
    fontSize: 12,
    fontWeight: "500",
  },
  titleOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 24,
  },
  cardTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 12,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  oneLiner: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
    marginTop: 4,
    marginBottom: 8,
    textShadowColor: "rgba(0, 0, 0, 0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  detailsBadges: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  detailBadge: {
    backgroundColor: "rgba(107, 114, 128, 0.8)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewMoreRow: {
    flexDirection: "row",
    marginTop: 8,
  },
  viewMoreBadge: {
    backgroundColor: "rgba(107, 114, 128, 0.8)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  detailBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "500",
  },
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
  cardDetails: {
    flex: DETAILS_SECTION_RATIO,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0, 0, 0, 0.06)",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    justifyContent: "center",
  },
  description: {
    fontSize: 15,
    color: "#374151",
    marginBottom: 8,
    lineHeight: 22,
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
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: "rgba(249, 250, 251, 0.7)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
  },
  shareButtonText: {
    fontSize: 15,
    color: "#6b7280",
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
    color: "#111827",
    textAlign: "center",
  },
  emptyDeckSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 8,
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
    color: "#9ca3af",
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
    color: "#111827",
    textAlign: "center",
  },
  noCardsSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 8,
    paddingHorizontal: 8,
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
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#eb7825",
  },
  likeText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#eb7825",
  },
  passIndicator: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#6b7280",
  },
  passText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#6b7280",
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
  batchChip: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 20,
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
});
