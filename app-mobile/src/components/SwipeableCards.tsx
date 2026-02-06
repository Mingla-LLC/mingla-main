import React, { useState, useRef, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Pressable,
  Image,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { formatCurrency, formatDistance } from "./utils/formatters";
import {
  ExperiencesService,
  Experience,
  UserPreferences,
} from "../services/experiencesService";
import {
  ExperienceGenerationService,
  GeneratedExperience,
} from "../services/experienceGenerationService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { BoardCardService } from "../services/boardCardService";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useRecommendations,
  Recommendation,
} from "../contexts/RecommendationsContext";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
const CARD_HEIGHT = Math.min(screenHeight * 0.72, 800);
const IMAGE_SECTION_RATIO = 0.66;
const DETAILS_SECTION_RATIO = 1 - IMAGE_SECTION_RATIO;

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
  budget_min: 0,
  budget_max: 1000,
  people_count: 1,
  categories: ["Sip & Chill", "Stroll"],
  travel_mode: "walking",
  travel_constraint_type: "time",
  travel_constraint_value: 30,
  datetime_pref: new Date().toISOString(),
});

// Recommendation interface is now imported from RecommendationsContext

interface SwipeableCardsProps {
  userPreferences?: any;
  currentMode?: string;
  onCardLike: (card: any) => void;
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
    "walk",
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
  // Use recommendations from context

  const {
    recommendations,
    loading,
    isFetching,
    error,
    userLocation,
    isModeTransitioning,
    isWaitingForSessionResolution,
    hasCompletedInitialFetch,
    refreshRecommendations,
  } = useRecommendations();

  // Combine all loading states for UI consistency and to prevent animation freezing
  // Note: We only block the UI for initial loading (loading), not background refetches (isFetching)
  const isAnyLoading =
    loading || isModeTransitioning || isWaitingForSessionResolution;

  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const spinValue = useRef(new Animated.Value(0)).current;

  const hasRestoredStateRef = useRef(false);
  const previousRefreshKeyRef = useRef<number | string | undefined>(refreshKey);
  const previousModeRef = useRef<string>(currentMode);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] =
    useState<ExpandedCardData | null>(null);

  // Get current session for board saving
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();
  const { user } = useAuthSimple();

  // Storage keys for persisting card state
  const getStorageKeys = () => {
    const baseKey = `mingla_card_state_${currentMode}_${refreshKey || 0}`;
    return {
      index: `${baseKey}_index`,
      removedCards: `${baseKey}_removed`,
    };
  };

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

  // Check if we're in a board session
  const isBoardSession =
    !isInSolo && (currentSession as any)?.session_type === "board";

  // Load board preferences if in board session
  // Use hook unconditionally (React rules) but pass undefined when not in board session
  const boardSessionResult = useBoardSession(
    isBoardSession && currentSession?.id ? currentSession.id : undefined
  );
  const boardPreferences = boardSessionResult?.preferences || null;

  // Use ref to store current recommendations for PanResponder
  const recommendationsRef = useRef<Recommendation[]>([]);
  const removedCardsRef = useRef<Set<string>>(new Set());
  const currentCardIndexRef = useRef(0);

  // Update refs when state changes
  useEffect(() => {
    recommendationsRef.current = recommendations;
    removedCardsRef.current = removedCards;
    currentCardIndexRef.current = currentCardIndex;
  }, [recommendations, removedCards, currentCardIndex]);

  // Swipe animation values
  const position = useRef(new Animated.ValueXY()).current;
  const rotate = position.x.interpolate({
    inputRange: [-screenWidth, 0, screenWidth],
    outputRange: ["-30deg", "0deg", "30deg"],
  });
  const likeOpacity = position.x.interpolate({
    inputRange: [0, screenWidth / 4],
    outputRange: [0, 1],
  });
  const nopeOpacity = position.x.interpolate({
    inputRange: [-screenWidth / 4, 0],
    outputRange: [1, 0],
  });
  const nextCardOpacity = position.x.interpolate({
    inputRange: [-screenWidth / 2, 0, screenWidth / 2],
    outputRange: [1, 0, 1],
  });

  // Tips related to vibes, intents, and categories
  const tips = [
    "💡 Solo adventures are perfect for discovering hidden gems at your own pace",
    "🌟 First dates? Try cozy cafes or scenic walks for a relaxed atmosphere",
    "💕 Romantic vibes? Look for intimate dining experiences or sunset spots",
    "👥 Group fun works best with interactive activities like escape rooms or game nights",
    "☕ Sip & Chill spots are great for casual meetups and work sessions",
    "🚶‍♀️ Take a Stroll through local parks and neighborhoods to discover new areas",
    "🍽️ Dining Experiences offer unique culinary adventures beyond the ordinary",
    "🎨 Creative & Hands-On activities like pottery or painting classes spark creativity",
    "🧘‍♀️ Wellness Dates combine relaxation with meaningful connection",
    "🎬 Screen & Relax options are perfect for rainy days or cozy evenings",
    "🏃‍♀️ Play & Move activities keep you active while having fun",
    "🧺 Picnics are budget-friendly and perfect for sunny afternoons",
    "✨ Freestyle experiences let you discover something completely unexpected",
    "🍔 Casual Eats offer great food without the formal atmosphere",
    "💼 Business meetings? Choose quiet cafes or professional spaces",
    "🌆 Explore new neighborhoods to find unique local experiences",
    "⏰ Adjust your travel time to discover places just outside your usual radius",
    "💰 Budget-friendly options exist in every category - explore different price ranges",
    "🎯 Mix different categories to keep your experiences diverse and exciting",
    "🌙 Late night spots offer a different vibe - perfect for night owls",
    "☀️ Afternoon activities often have better availability and pricing",
    "🍳 Brunch spots are great for weekend socializing",
    "🌳 Nature-based activities are free and refreshing",
    "🎪 Look for pop-up events and seasonal experiences",
    "🏛️ Museums and galleries offer cultural enrichment",
    "🎵 Live music venues create memorable atmosphere",
    "🍷 Wine tastings and brewery tours are great for groups",
    "🏖️ Waterfront locations offer scenic views and fresh air",
    "🎭 Theaters and comedy clubs provide entertainment value",
    "🛍️ Markets and festivals showcase local culture",
    "🏋️ Fitness classes combine health with social connection",
    "📚 Bookstores and libraries offer quiet, intellectual spaces",
    "🎨 Art galleries provide inspiration and conversation starters",
    "🍕 Food tours let you sample multiple places in one experience",
    "🌉 Iconic landmarks make for great photo opportunities",
    "🏞️ Hiking trails offer exercise and beautiful scenery",
    "🎪 Festivals and events create shared memorable experiences",
    "🍰 Dessert spots are perfect for sweet-tooth satisfaction",
    "🌮 Food trucks offer variety and casual dining",
    "🎯 Try something new - you might discover a new favorite activity",
  ];

  // Shuffle tips array for random order
  const shuffledTips = useRef(tips.sort(() => Math.random() - 0.5)).current;

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

  // Rotate tips every 5 seconds
  useEffect(() => {
    if (!shouldShowLoader) return;

    const tipInterval = setInterval(() => {
      setCurrentTipIndex((prev) => (prev + 1) % shuffledTips.length);
    }, 5000);

    return () => clearInterval(tipInterval);
  }, [shouldShowLoader, shuffledTips.length]);

  // Animate spinner
  useEffect(() => {
    if (!shouldShowLoader) return;

    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );

    spinAnimation.start();

    return () => spinAnimation.stop();
  }, [shouldShowLoader, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Location and fetching are now handled by RecommendationsContext

  // Always use currentCardIndex to track position in the deck
  const currentRec = availableRecommendations[currentCardIndex];

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
        // Preferences or mode changed - reset state and clear old storage
        console.log(
          "🔄 State reset - Preferences changed:",
          preferencesChanged,
          "Mode changed:",
          modeChanged
        );
        setRemovedCards(new Set());
        setCurrentCardIndex(0);

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
          const removedCardsArray = savedRemovedCards[1]
            ? JSON.parse(savedRemovedCards[1])
            : [];

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
            removedCardsArray.length
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

  // PanResponder for swipe gestures
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
            !removedCardIds.includes(rec.id)
        );
        const cardToRemove = availableCards[currentCardIndexRef.current];

        // Check for swipe up (expand card)
        if (gestureState.dy < -50 && Math.abs(gestureState.dx) < 50) {
          if (cardToRemove) {
            handleCardExpand();
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

          // Check if card exists
          if (!cardToRemove) {
            console.warn("No card to swipe");
            Animated.spring(position, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: false,
            }).start();
            return;
          }

          // Animate card off screen first
          Animated.timing(position, {
            toValue: {
              x: direction === "right" ? screenWidth + 100 : -screenWidth - 100,
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

            // Handle swipe logic (tracking, saving, etc.) in background
            handleSwipe(direction, cardToRemove);

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

    // Transform Recommendation to ExpandedCardData
    const expandedCardData: ExpandedCardData = {
      id: currentRec.id,
      title: currentRec.title,
      category: currentRec.category,
      categoryIcon: currentRec.categoryIcon,
      description: currentRec.description,
      fullDescription: currentRec.fullDescription || currentRec.description,
      image: currentRec.image,
      images: currentRec.images || [currentRec.image],
      rating: currentRec.rating,
      reviewCount: currentRec.reviewCount,
      priceRange: currentRec.priceRange,
      distance: currentRec.distance,
      travelTime: currentRec.travelTime,
      address: currentRec.address,
      openingHours: currentRec.openingHours,
      highlights: currentRec.highlights || [],
      tags: currentRec.tags || [],
      matchScore: currentRec.matchScore,
      matchFactors: currentRec.matchFactors,
      socialStats: currentRec.socialStats,
      location:
        currentRec.lat && currentRec.lng
          ? { lat: currentRec.lat, lng: currentRec.lng }
          : userLocation
          ? { lat: userLocation.lat, lng: userLocation.lng }
          : undefined,
      selectedDateTime: userPreferences?.datetime_pref
        ? new Date(userPreferences.datetime_pref)
        : new Date(),
      // Include strollData if it already exists on the card
      strollData: currentRec.strollData,
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

    try {
      // Track interaction in Supabase (only if user is authenticated)
      if (user?.id) {
        const interactionType =
          direction === "right" ? "swipe_right" : "swipe_left";

        try {
          await ExperiencesService.trackInteraction(
            user.id,
            card.id,
            interactionType,
            {
              category: card.category,
              time_of_day: userPreferences?.timeOfDay || "Afternoon",
              budget_range: `${card.priceRange}`,
              location: userPreferences?.location || "San Francisco",
            }
          );
        } catch (trackingError) {
          console.error("Error tracking interaction:", trackingError);
          // Continue without tracking - not critical
        }

        // Save to Supabase if swiped right (liked)
        if (direction === "right") {
          try {
            await ExperiencesService.saveExperience(user.id, card.id, "liked");
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

          // Call onCardLike which handles saving to board or solo saved_cards
          onCardLike(card);
        } else {
          // Track dislike
          try {
            await ExperiencesService.saveExperience(
              user.id,
              card.id,
              "disliked"
            );
          } catch (dislikeError) {
            console.error("Error tracking dislike:", dislikeError);
            // Continue without tracking dislike
          }
        }

        // Track swipe state for board sessions
        if (isBoardSession && currentSession?.id) {
          try {
            await BoardCardService.trackSwipeState({
              sessionId: currentSession.id,
              experienceId: card.id,
              userId: user.id,
              swipeDirection: direction,
            });
          } catch (swipeStateError) {
            console.error("Error tracking swipe state:", swipeStateError);
            // Continue even if swipe state tracking fails
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

    // Reset card position for the next swipe
    position.setValue({ x: 0, y: 0 });
  };

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

  // Loading state with spinner and rotating tips
  // Show loader if: loading, transitioning modes, or waiting for session resolution
  if (shouldShowLoader) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingContent}>
          {/* Animated Spinner */}
          <Animated.View
            style={[
              styles.spinnerContainer,
              {
                transform: [{ rotate: spin }],
              },
            ]}
          >
            <View style={styles.spinnerOuter}>
              <View style={styles.spinnerInner}>
                <Ionicons name="sparkles" size={32} color="#eb7825" />
              </View>
            </View>
          </Animated.View>

          {/* Loading Text */}
          <Text style={styles.loadingTitle}>
            Finding your perfect experiences...
          </Text>

          {/* Rotating Tip */}
          <View style={styles.tipContainer}>
            <Text style={styles.tipText}>{shuffledTips[currentTipIndex]}</Text>
          </View>
        </View>
      </View>
    );
  }

  // Error state - No matches found
  // Only show error if we're NOT transitioning modes (to prevent showing error during transitions)
  if (
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    (error === "no_matches" || (error && availableRecommendations.length === 0))
  ) {
    const currentPrefs = userPreferences || {
      budget_min: 0,
      budget_max: 1000,
      categories: [],
      travel_constraint_value: 30,
    };

    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <Text style={styles.noMatchesEmoji}>💡</Text>
          <Text style={styles.noCardsTitle}>No matches found</Text>
          <Text style={styles.noCardsSubtitle}>
            We couldn't find experiences matching your current filters.
          </Text>

          {/* Filter Summary */}
          <View style={styles.filterSummary}>
            <Text style={styles.filterSummaryTitle}>Current Filters:</Text>
            <View style={styles.filterTags}>
              {currentPrefs.categories &&
                currentPrefs.categories.length > 0 && (
                  <View style={styles.filterTag}>
                    <Text style={styles.filterTagText}>
                      Categories: {currentPrefs.categories.join(", ")}
                    </Text>
                  </View>
                )}
              <View style={styles.filterTag}>
                <Text style={styles.filterTagText}>
                  Budget: ${currentPrefs.budget_min || 0}-$
                  {currentPrefs.budget_max || 1000}
                </Text>
              </View>
              <View style={styles.filterTag}>
                <Text style={styles.filterTagText}>
                  Travel: {currentPrefs.travel_constraint_value || 30} min
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.suggestionsTitle}>Suggestions:</Text>
          <Text style={styles.suggestionsText}>
            • Try expanding your budget range{"\n"}• Add more categories to your
            preferences{"\n"}• Increase your travel time constraint{"\n"}• Check
            back later for new experiences
          </Text>

          <TouchableOpacity
            onPress={() => {
              // Retry by refreshing recommendations
              refreshRecommendations(refreshKey);
            }}
            style={styles.startOverButton}
            activeOpacity={0.7}
          >
            <Text style={styles.startOverButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // General error state
  if (error && error !== "no_matches") {
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <View style={styles.noCardsIcon}>
            <Ionicons name="alert-circle" size={64} color="#ef4444" />
          </View>
          <Text style={styles.noCardsTitle}>Oops! Something went wrong</Text>
          <Text style={styles.noCardsSubtitle}>{error}</Text>
          <TouchableOpacity
            onPress={() => {
              // Retry by refreshing recommendations
              refreshRecommendations(refreshKey);
            }}
            style={styles.startOverButton}
            activeOpacity={0.7}
          >
            <Text style={styles.startOverButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Only show "all caught up" if:
  // 1. We've completed an initial fetch attempt (to distinguish from "not yet loaded")
  // 2. We're NOT loading, NOT transitioning, and truly have no recommendations
  // This prevents showing the empty state during initial load or mode transitions
  if (
    hasCompletedInitialFetch &&
    availableRecommendations.length === 0 &&
    !loading &&
    !isModeTransitioning &&
    !isWaitingForSessionResolution
  ) {
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <View style={styles.sparklesContainer}>
            <Ionicons name="sparkles" size={40} color="#eb7825" />
          </View>
          <Text style={styles.noCardsTitle}>You're all caught up!</Text>
          <Text style={styles.noCardsSubtitle}>
            You've reviewed all available recommendations. You can{" "}
            <Text
              style={styles.actionButtonText}
              onPress={handleOpenPreferences}
            >
              update your preferences
            </Text>{" "}
            to see new suggestions or{" "}
            <Text
              style={styles.actionButtonText}
              onPress={handleViewCardsAgain}
            >
              view your cards again
            </Text>
            .
          </Text>
        </View>
      </View>
    );
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
                  {/* Hero Image Section */}
                  <View style={styles.imageContainer}>
                    <Image
                      source={{ uri: nextCard.image }}
                      style={styles.cardImage}
                      resizeMode="cover"
                    />

                    {/* Match Score Badge */}
                    <View style={styles.matchBadge}>
                      <Ionicons
                        name="star"
                        size={14}
                        color="#1f2937"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.matchText}>
                        {nextCard.matchScore}% Match
                      </Text>
                    </View>

                    {/* Gallery Indicator if multiple images */}
                    {nextCard.images && nextCard.images.length > 1 && (
                      <View style={styles.galleryIndicator}>
                        <Ionicons name="images" size={16} color="white" />
                        <Text style={styles.galleryText}>
                          {nextCard.images.length}
                        </Text>
                      </View>
                    )}

                    {/* Title and Details Overlay */}
                    <View style={styles.titleOverlay}>
                      <Text style={styles.cardTitle}>{nextCard.title}</Text>

                      {/* Three small badges: distance, travel time, rating */}
                      <View style={styles.detailsBadges}>
                        <View style={styles.detailBadge}>
                          <Ionicons name="location" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {nextCard.distance}
                          </Text>
                        </View>
                        <View style={styles.detailBadge}>
                          <Ionicons name="time" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {nextCard.travelTime}
                          </Text>
                        </View>
                        <View style={styles.detailBadge}>
                          <Ionicons name="star" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {nextCard.rating.toFixed(1)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* White Details Section */}
                  <View style={styles.cardDetails}>
                    {/* Category/Provider */}
                    <View style={styles.categoryRow}>
                      <Ionicons
                        name={NextCategoryIcon as any}
                        size={16}
                        color="#eb7825"
                      />
                      <Text style={styles.categoryText}>
                        {nextCard.category}
                      </Text>
                    </View>

                    {/* Description - 2 lines max */}
                    <Text style={styles.description} numberOfLines={2}>
                      {nextCard.description}
                    </Text>

                    {/* Top 2 Highlights */}
                    {nextCard.highlights && nextCard.highlights.length > 0 && (
                      <View style={styles.highlightsContainer}>
                        {nextCard.highlights
                          .slice(0, 2)
                          .map((highlight: string, index: number) => (
                            <View key={index} style={styles.highlightBadge}>
                              <Text style={styles.highlightText}>
                                {highlight}
                              </Text>
                            </View>
                          ))}
                      </View>
                    )}

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
                      <Ionicons
                        name="share-outline"
                        size={18}
                        color="#6b7280"
                      />
                      <Text style={styles.shareButtonText}>Share</Text>
                    </TouchableOpacity>
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
          >
            {/* Swipe Direction Overlays */}
            <Animated.View
              style={[styles.swipeOverlayRight, { opacity: likeOpacity }]}
              pointerEvents="none"
            >
              <View style={styles.swipeIndicator}>
                <Ionicons name="heart" size={60} color="#4ade80" />
                <Text style={styles.swipeText}>LIKE</Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[styles.swipeOverlayLeft, { opacity: nopeOpacity }]}
              pointerEvents="none"
            >
              <View style={styles.swipeIndicator}>
                <Ionicons name="close" size={60} color="#ef4444" />
                <Text style={styles.swipeText}>NOPE</Text>
              </View>
            </Animated.View>

            <TouchableOpacity
              activeOpacity={1}
              onPress={handleCardTap}
              style={StyleSheet.absoluteFill}
            >
              {/* Hero Image Section - 60-65% of card */}
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: currentRec.image }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />

                {/* Match Score Badge - Top Left */}
                <View style={styles.matchBadge}>
                  <Ionicons
                    name="star"
                    size={14}
                    color="#eb7825"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.matchText}>
                    {currentRec.matchScore}% Match
                  </Text>
                </View>

                {/* Gallery Indicator if multiple images */}
                {currentRec.images && currentRec.images.length > 1 && (
                  <View style={styles.galleryIndicator}>
                    <Ionicons name="images" size={16} color="white" />
                    <Text style={styles.galleryText}>
                      {currentRec.images.length}
                    </Text>
                  </View>
                )}

                {/* Title and Details Overlay - Bottom Left of Image */}
                <View style={styles.titleOverlay}>
                  <Text style={styles.cardTitle}>{currentRec.title}</Text>

                  {/* Three small badges: distance, travel time, rating */}
                  <View style={styles.detailsBadges}>
                    <View style={styles.detailBadge}>
                      <Ionicons name="location" size={12} color="white" />
                      <Text style={styles.detailBadgeText}>
                        {currentRec.distance}
                      </Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Ionicons name="time" size={12} color="white" />
                      <Text style={styles.detailBadgeText}>
                        {currentRec.travelTime}
                      </Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Ionicons name="star" size={12} color="white" />
                      <Text style={styles.detailBadgeText}>
                        {currentRec.rating.toFixed(1)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* White Details Section - Bottom 35-40% */}
              <View style={styles.cardDetails}>
                <View style={styles.cardDetailsContent}>
                  {/* Category/Provider */}
                  <View style={styles.categoryRow}>
                    <Ionicons
                      name={CategoryIcon as any}
                      size={16}
                      color="#eb7825"
                    />
                    <Text style={styles.categoryText}>
                      {currentRec.category}
                    </Text>
                  </View>

                  {/* Description - 2 lines max */}
                  <Text style={styles.description}>
                    {currentRec.description}
                  </Text>

                  {/* Address - Show in collaboration mode */}
                  {/*   {currentMode !== "solo" && currentRec.address && (
                    <View style={styles.addressRow}>
                      <Ionicons
                        name="location-outline"
                        size={14}
                        color="#6b7280"
                      />
                      <Text style={styles.addressText} numberOfLines={1}>
                        {currentRec.address}
                      </Text>
                    </View>
                  )}
 */}
                  {/* Top 2 Highlights */}
                  {/*     {currentRec.highlights &&
                    currentRec.highlights.length > 0 && (
                      <View style={styles.highlightsContainer}>
                        {currentRec.highlights
                          .slice(0, 2)
                          .map((highlight: string, index: number) => (
                            <View key={index} style={styles.highlightBadge}>
                              <Text style={styles.highlightText}>
                                {highlight}
                              </Text>
                            </View>
                          ))}
                      </View>
                    )} */}
                </View>

                {/* Share Button - Centered at bottom */}
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={handleShare}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="share-social-outline"
                    size={18}
                    color="#6b7280"
                  />
                  <Text style={styles.shareButtonText}>Share</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
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
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  cardContainer: {
    width: screenWidth * 0.92,
    /*   height: CARD_HEIGHT, */
    maxWidth: 400,
    position: "relative",
    flex: 1,
  },
  card: {
    position: "absolute",
    width: "100%",
    height: "100%",
    backgroundColor: "white",
    borderRadius: 24,
    borderTopWidth: 0,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 2,
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
  detailsBadges: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  detailBadge: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 10,
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
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  categoryText: {
    color: "#6b7280",
    fontSize: 14,
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
    backgroundColor: "white",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    borderTopWidth: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  cardDetailsContent: {
    flexGrow: 1,
    gap: 8,
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
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
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
    gap: 32,
    maxWidth: 320,
  },
  spinnerContainer: {
    width: 100,
    height: 100,
    justifyContent: "center",
    alignItems: "center",
  },
  spinnerOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: "#ffedd5",
    borderTopColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  spinnerInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#fff7ed",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  tipContainer: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 80,
    justifyContent: "center",
  },
  tipText: {
    fontSize: 15,
    color: "#374151",
    textAlign: "center",
    lineHeight: 22,
  },
  noCardsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  noCardsContent: {
    alignItems: "center",
    gap: 16,
  },
  noCardsIcon: {
    width: 80,
    height: 80,
    backgroundColor: "#f3f4f6",
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  sparklesContainer: {
    width: 80,
    height: 80,
    backgroundColor: "#fef3e2",
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  noCardsTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  noCardsSubtitle: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 20,
  },
  noMatchesEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  filterSummary: {
    width: "100%",
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  filterSummaryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },
  filterTags: {
    gap: 8,
  },
  filterTag: {
    backgroundColor: "white",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  filterTagText: {
    fontSize: 13,
    color: "#6b7280",
  },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  suggestionsText: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 22,
    marginBottom: 20,
  },
  actionButtonText: {
    color: "#eb7825",
    fontSize: 16,
    fontWeight: "600",
    textDecorationLine: "underline",
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(74, 222, 128, 0.1)",
    borderWidth: 4,
    borderColor: "#4ade80",
    borderRadius: 16,
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  swipeOverlayLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 4,
    borderColor: "#ef4444",
    borderRadius: 16,
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  swipeIndicator: {
    alignItems: "center",
    justifyContent: "center",
  },
  swipeText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "white",
    marginTop: 8,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
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
});
