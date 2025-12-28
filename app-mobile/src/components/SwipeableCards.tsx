import React, { useState, useRef, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  StatusBar,
  ActivityIndicator,
} from "react-native";
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
import { enhancedLocationService } from "../services/enhancedLocationService";
import * as Location from "expo-location";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { BoardCardService } from "../services/boardCardService";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { SafeAreaView } from "react-native-safe-area-context";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
const CARD_HEIGHT = Math.min(screenHeight * 0.72, 700);
const IMAGE_SECTION_RATIO = 0.66;
const DETAILS_SECTION_RATIO = 1 - IMAGE_SECTION_RATIO;

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

interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  lat?: number;
  lng?: number;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours: string;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
}

interface SwipeableCardsProps {
  userPreferences?: any;
  currentMode?: string;
  onCardLike?: (card: any) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string; // Key that changes to trigger refresh
}

// Real data will be fetched from Supabase

const getIconComponent = (iconName: string) => {
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

  return iconMap[iconName] || "heart";
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
  generateNewMockCard,
  onboardingData,
  refreshKey,
}: SwipeableCardsProps) {
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFetchingCompanion, setIsFetchingCompanion] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const spinValue = useRef(new Animated.Value(0)).current;
  const hasFetchedRef = useRef(false);
  const lastRefreshKeyRef = useRef<number | string | undefined>(undefined);
  const previousModeRef = useRef<string | undefined>(currentMode);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] =
    useState<ExpandedCardData | null>(null);

  // Track if we're transitioning between modes to prevent showing stale cards
  const [isModeTransitioning, setIsModeTransitioning] = useState(false);

  // Get current session for board saving
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();
  const { user } = useAuthSimple();

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

  // Check if we're waiting for session resolution in collaboration mode
  const isWaitingForSessionResolution =
    currentMode !== "solo" && !resolvedSessionId && sessionsLoading;

  // Check if we're in a board session
  const isBoardSession = !isInSolo && currentSession?.session_type === "board";

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

  // Rotate tips every 5 seconds
  useEffect(() => {
    if (!loading) return;

    const tipInterval = setInterval(() => {
      setCurrentTipIndex((prev) => (prev + 1) % shuffledTips.length);
    }, 5000);

    return () => clearInterval(tipInterval);
  }, [loading, shuffledTips.length]);

  // Animate spinner
  useEffect(() => {
    if (!loading) return;

    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );

    spinAnimation.start();

    return () => spinAnimation.stop();
  }, [loading, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Get user location - prioritize location from DB, fallback to current GPS location
  useEffect(() => {
    const getLocation = async () => {
      try {
        // First, try to get location from database preferences
        if (user?.id) {
          try {
            const prefs = await ExperiencesService.getUserPreferences(user.id);
            if (prefs && (prefs as any).custom_location) {
              const savedLocation = (prefs as any).custom_location;

              // Check if it's coordinates (format: "37.7749, -122.4194")
              const coordinatesMatch = savedLocation.match(
                /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/
              );
              if (coordinatesMatch) {
                const lat = parseFloat(coordinatesMatch[1]);
                const lng = parseFloat(coordinatesMatch[2]);
                if (!isNaN(lat) && !isNaN(lng)) {
                  console.log("Using saved coordinates from DB:", { lat, lng });
                  setUserLocation({ lat, lng });
                  return;
                }
              } else {
                // It's a city name - geocode it to get coordinates
                try {
                  const geocoded = await Location.geocodeAsync(savedLocation);
                  if (geocoded && geocoded.length > 0) {
                    const { latitude, longitude } = geocoded[0];
                    setUserLocation({ lat: latitude, lng: longitude });
                    return;
                  }
                } catch (geocodeError) {
                  console.log(
                    "Could not geocode saved location, falling back to GPS:",
                    geocodeError
                  );
                }
              }
            }
          } catch (prefsError) {
            console.log(
              "Error loading preferences for location, falling back to GPS:",
              prefsError
            );
          }
        }

        // Fallback to current GPS location
        console.log("No saved location in DB, using current GPS location");
        const location = await enhancedLocationService.getCurrentLocation();
        if (location) {
          setUserLocation({ lat: location.latitude, lng: location.longitude });
        } else {
          // Try to get last known location as fallback
          const lastKnown =
            await enhancedLocationService.getLastKnownLocation();
          if (lastKnown) {
            setUserLocation({
              lat: lastKnown.latitude,
              lng: lastKnown.longitude,
            });
          } else {
            // Final fallback to default location (San Francisco)
            setUserLocation({ lat: 37.7749, lng: -122.4194 });
          }
        }
      } catch (error: any) {
        // Suppress location service errors - they're expected if services are disabled
        const errorMessage = error?.message || String(error) || "";
        const isLocationServiceError =
          errorMessage.includes("location services") ||
          errorMessage.includes("unavailable") ||
          errorMessage.includes("Location services are not enabled");

        if (!isLocationServiceError) {
          // Only log unexpected errors
          console.error("Error getting location:", error);
        }

        // Try last known location before falling back to default
        try {
          const lastKnown =
            await enhancedLocationService.getLastKnownLocation();
          if (lastKnown) {
            setUserLocation({
              lat: lastKnown.latitude,
              lng: lastKnown.longitude,
            });
          } else {
            // Final fallback to default location
            setUserLocation({ lat: 37.7749, lng: -122.4194 });
          }
        } catch {
          // Final fallback to default location
          setUserLocation({ lat: 37.7749, lng: -122.4194 });
        }
      }
    };
    getLocation();
  }, [user?.id]);

  // Fetch AI-generated experiences
  useEffect(() => {
    const fetchRecommendations = async () => {
      if (!userLocation) {
        // Wait for location
        return;
      }

      // FIRST: Determine the current mode and check if it changed
      const modeChanged =
        previousModeRef.current !== undefined &&
        previousModeRef.current !== currentMode;

      // If mode changed, clear everything and show loading
      if (modeChanged) {
        console.log(
          `🔄 Mode changed from "${previousModeRef.current}" to "${currentMode}": clearing and fetching new recommendations`
        );
        setIsModeTransitioning(true);
        setRecommendations([]);
        setRemovedCards(new Set());
        setCurrentCardIndex(0);
        setLoading(true);
        setError(null);
        // DON'T update previousModeRef yet - wait until we successfully fetch new recommendations
        // This ensures modeChanged stays true throughout the fetch process
      }

      // SECOND: Determine if we're in collaboration or solo mode
      // If we're in collaboration mode but waiting for session resolution, show loading
      if (isWaitingForSessionResolution) {
        setLoading(true);
        return;
      }

      // THIRD: Determine the actual mode we should fetch for
      const isCollaborationMode = currentMode !== "solo" && resolvedSessionId;

      // If we're in collaboration mode but session isn't resolved yet, wait
      if (currentMode !== "solo" && !resolvedSessionId) {
        // Still loading sessions or session not found - show loading
        if (sessionsLoading) {
          setLoading(true);
          return;
        }
        // Sessions loaded but session not found - show error
        setError(`Session "${currentMode}" not found`);
        setLoading(false);
        setIsModeTransitioning(false);
        return;
      }

      // FOURTH: Check if we should skip fetching (only if mode hasn't changed)
      // Never use cached data if mode changed - we need fresh data for the new mode
      const refreshKeyChanged = refreshKey !== lastRefreshKeyRef.current;
      const hasRecommendations = recommendations.length > 0;

      if (
        hasRecommendations &&
        !refreshKeyChanged &&
        !modeChanged &&
        !isModeTransitioning
      ) {
        // Already have recommendations and no explicit refresh requested - use cached data
        // But only if mode hasn't changed and we're not transitioning
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Mark as fetched and update refresh key ref
        hasFetchedRef.current = true;
        lastRefreshKeyRef.current = refreshKey;

        // Get user preferences if available
        let userPrefs: UserPreferences | null = null;
        if (user?.id) {
          try {
            const prefs = await ExperiencesService.getUserPreferences(user.id);
            if (prefs) {
              userPrefs = prefs;
            } else {
              userPrefs = getDefaultPreferences();
            }
          } catch (error) {
            console.error("Error loading user preferences:", error);
            userPrefs = getDefaultPreferences();
          }
        } else {
          userPrefs = getDefaultPreferences();
        }

        // Merge board preferences if in board session
        if (isBoardSession && boardPreferences) {
          userPrefs = {
            ...userPrefs,
            categories: boardPreferences.categories || userPrefs.categories,
            budget_min: boardPreferences.budget_min ?? userPrefs.budget_min,
            budget_max: boardPreferences.budget_max ?? userPrefs.budget_max,
            people_count: boardPreferences.group_size || userPrefs.people_count,
          };
        }

        if (!userPrefs) {
          setError("Unable to load preferences");
          setLoading(false);
          return;
        }

        // Generate experiences using AI
        try {
          let generatedExperiences: any[] = [];

          // Mode is already determined above - use isCollaborationMode from there
          if (isCollaborationMode) {
            // Use session-based generation that aggregates all user preferences
            generatedExperiences =
              await ExperienceGenerationService.generateSessionExperiences({
                sessionId: resolvedSessionId,
                userId: user?.id,
              });
          } else {
            // Only fetch solo cards if we're actually in solo mode
            if (currentMode === "solo") {
              console.log(
                `🎯 Solo mode detected - Generating individual experiences`
              );
              console.log(`   Current Mode: ${currentMode}`);
              console.log(
                `   Resolved Session ID: ${resolvedSessionId || "null"}`
              );
              // Use solo generation with individual preferences
              generatedExperiences =
                await ExperienceGenerationService.generateExperiences({
                  userId: user?.id || "anonymous",
                  preferences: userPrefs,
                  location: userLocation,
                });
            } else {
              // This shouldn't happen, but handle gracefully
              setError(`Unable to resolve session for mode: ${currentMode}`);
              setLoading(false);
              return;
            }
          }

          if (generatedExperiences.length === 0) {
            setError("no_matches");
            setRecommendations([]);
            return;
          }

          // Transform to Recommendation format
          const transformedRecommendations = generatedExperiences.map((exp) => {
            // Debug: Log strollData for stroll cards
            if (exp.strollData) {
              console.log("✅ strollData preserved in transformation:", {
                cardTitle: exp.title,
                hasCompanionStops: !!exp.strollData.companionStops?.length,
                companionStopsCount: exp.strollData.companionStops?.length || 0,
              });
            }
            return {
              id: exp.id,
              title: exp.title,
              category: exp.category,
              categoryIcon: exp.categoryIcon,
              timeAway: exp.travelTime,
              description: exp.description,
              budget: exp.priceRange,
              rating: exp.rating,
              image: exp.heroImage,
              images: exp.images || [exp.heroImage],
              priceRange: exp.priceRange,
              distance: exp.distance,
              travelTime: exp.travelTime,
              experienceType: exp.category,
              highlights: exp.highlights || [],
              fullDescription: exp.description,
              address: exp.address,
              openingHours: "",
              tags: exp.highlights || [],
              matchScore: exp.matchScore,
              reviewCount: exp.reviewCount,
              lat: exp.lat,
              lng: exp.lng,
              socialStats: {
                views: 0,
                likes: 0,
                saves: 0,
                shares: 0,
              },
              matchFactors: exp.matchFactors || {
                location: 85,
                budget: 85,
                category: 85,
                time: 85,
                popularity: 85,
              },
              // Include strollData if available
              strollData: exp.strollData,
            };
          });

          setRecommendations(transformedRecommendations);

          // Only mark transition as complete and update previousModeRef AFTER successfully fetching
          if (modeChanged) {
            console.log(
              `✅ Successfully fetched ${transformedRecommendations.length} recommendations for mode "${currentMode}"`
            );
            previousModeRef.current = currentMode;
            setIsModeTransitioning(false); // Mode transition complete
          }

          // Track view interaction for the first card
          if (transformedRecommendations.length > 0 && user?.id) {
            try {
              await ExperiencesService.trackInteraction(
                user.id,
                transformedRecommendations[0].id,
                "view"
              );
            } catch (error) {
              console.error("Error tracking view interaction:", error);
            }
          }
        } catch (genError) {
          console.error("Error generating experiences:", genError);
          setError("Failed to generate experiences. Please try again.");
          // If mode changed but fetch failed, still update previousModeRef to prevent retry loops
          if (modeChanged) {
            previousModeRef.current = currentMode;
          }
          setIsModeTransitioning(false);
        }
      } catch (err) {
        console.error("Error fetching recommendations:", err);
        setError("Failed to load recommendations");
        // If mode changed but fetch failed, still update previousModeRef to prevent retry loops
        if (modeChanged) {
          previousModeRef.current = currentMode;
        }
        setIsModeTransitioning(false);
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [
    user?.id,
    userLocation,
    refreshKey,
    currentMode,
    resolvedSessionId,
    currentSession?.id,
    availableSessions,
    isWaitingForSessionResolution,
    sessionsLoading,
  ]); // Refresh when preferences, mode, or session changes

  // Initialize previousModeRef on mount
  useEffect(() => {
    if (previousModeRef.current === undefined) {
      previousModeRef.current = currentMode;
    }
  }, []);

  // Don't show recommendations if:
  // 1. We're transitioning between modes
  // 2. Mode changed but recommendations haven't been cleared yet
  // 3. We have recommendations but they don't match current mode (safety check)
  const modeMismatch =
    previousModeRef.current !== undefined &&
    previousModeRef.current !== currentMode &&
    recommendations.length > 0;

  const shouldHideCards = isModeTransitioning || modeMismatch;

  const availableRecommendations = shouldHideCards
    ? []
    : recommendations.filter(
        (rec) => !removedCards.has(rec.id) && !removedCardIds.includes(rec.id)
      );

  // Always use currentCardIndex to track position in the deck
  const currentRec = availableRecommendations[currentCardIndex];

  // If we detect a mode mismatch, clear recommendations immediately
  useEffect(() => {
    if (modeMismatch) {
      console.log(`⚠️ Mode mismatch detected: clearing stale recommendations`);
      setRecommendations([]);
      setRemovedCards(new Set());
      setCurrentCardIndex(0);
      setIsModeTransitioning(true);
      setLoading(true);
    }
  }, [modeMismatch]);

  // Reset index if we're beyond the available cards
  useEffect(() => {
    if (
      currentCardIndex >= availableRecommendations.length &&
      availableRecommendations.length > 0
    ) {
      setCurrentCardIndex(0);
    }
  }, [availableRecommendations.length, currentCardIndex]);

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

    let strollData = (currentRec as any).strollData;

    // If stroll card and we don't already have companion data, fetch it on demand
    const categoryLower = currentRec.category?.toLowerCase() || "";
    const isStrollCard =
      categoryLower.includes("stroll") ||
      categoryLower === "take a stroll" ||
      categoryLower === "take-a-stroll" ||
      categoryLower === "take_a_stroll";

    if (!strollData && isStrollCard) {
      const anchor =
        strollData?.anchor ||
        (currentRec.lat &&
        currentRec.lng &&
        currentRec.title
          ? {
              id: currentRec.id,
              name: currentRec.title,
              location: { lat: currentRec.lat, lng: currentRec.lng },
              address: currentRec.address,
            }
          : null);

      if (anchor) {
        try {
          setIsFetchingCompanion(true);
          const fetchedStrollData =
            await ExperienceGenerationService.fetchCompanionStrollData(anchor);
          if (fetchedStrollData) {
            strollData = fetchedStrollData;
          }
        } catch (err) {
          console.error("Error fetching companion stroll data:", err);
        } finally {
          setIsFetchingCompanion(false);
        }
      }
    }

    // Debug: Log strollData when expanding
    if (strollData) {
      console.log("✅ strollData found when expanding card:", {
        cardTitle: currentRec.title,
        hasCompanionStops: !!strollData.companionStops?.length,
        companionStopsCount: strollData.companionStops?.length || 0,
        hasTimeline: !!strollData.timeline?.length,
        timelineSteps: strollData.timeline?.length || 0,
      });
    } else {
      console.log("⚠️ No strollData found for card:", currentRec.title);
    }

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
      // Use anchor location for stroll cards, otherwise use user location
      location:
        strollData?.anchor?.location ||
        (userLocation
          ? { lat: userLocation.lat, lng: userLocation.lng }
          : undefined),
      selectedDateTime: userPreferences?.datetime_pref
        ? new Date(userPreferences.datetime_pref)
        : new Date(),
      // Include strollData if available
      strollData: strollData,
    };

    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
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
            } else {
              console.error("Error saving experience:", saveError);
            }
            // Continue with local save even if Supabase fails
          }

          // If in a board session, save to board_saved_cards
          if (isBoardSession && currentSession?.id) {
            try {
              const experienceData = {
                id: card.id,
                title: card.title,
                category: card.category,
                categoryIcon: card.categoryIcon,
                image: card.image,
                images: card.images,
                rating: card.rating,
                reviewCount: card.reviewCount,
                travelTime: card.travelTime,
                priceRange: card.priceRange,
                description: card.description,
                fullDescription: card.fullDescription,
                address: card.address,
                highlights: card.highlights,
                matchScore: card.matchScore,
                socialStats: card.socialStats,
                matchFactors: card.matchFactors,
              };

              await BoardCardService.saveCardToBoard({
                sessionId: currentSession.id,
                experienceId: card.id,
                experienceData,
                userId: user.id,
              });
            } catch (boardSaveError) {
              console.error("Error saving card to board:", boardSaveError);
              // Continue even if board save fails
            }
          }

          if (onCardLike) {
            onCardLike(card);
          }
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

  // Loading state with spinner and rotating tips
  // Show loader if: loading, transitioning modes, or waiting for session resolution
  if (loading || isModeTransitioning || isWaitingForSessionResolution) {
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
              setError(null);
              setLoading(true);
              // Retry with same preferences
              const fetchRecommendations = async () => {
                if (!userLocation && currentMode === "solo") return;
                try {
                  let generatedExperiences: any[] = [];

                  // Resolve session ID from currentMode if needed
                  const resolvedSessionIdForRetry =
                    currentMode !== "solo"
                      ? currentSession?.id ||
                        availableSessions.find(
                          (s) => s.id === currentMode || s.name === currentMode
                        )?.id
                      : null;

                  // Check if we're in collaboration mode and have a session
                  const isCollaborationMode =
                    currentMode !== "solo" && resolvedSessionIdForRetry;

                  if (isCollaborationMode) {
                    console.log(
                      `🎯 Retry: Collaboration mode - Using session experiences`
                    );
                    console.log(`   Session ID: ${resolvedSessionIdForRetry}`);
                    // Use session-based generation
                    generatedExperiences =
                      await ExperienceGenerationService.generateSessionExperiences(
                        {
                          sessionId: resolvedSessionIdForRetry,
                          userId: user?.id,
                        }
                      );
                  } else {
                    console.log(
                      `🎯 Retry: Solo mode - Using individual experiences`
                    );
                    // Use solo generation
                    const userPrefs: UserPreferences = user?.id
                      ? (await ExperiencesService.getUserPreferences(
                          user.id
                        )) ?? getDefaultPreferences()
                      : getDefaultPreferences();

                    generatedExperiences =
                      await ExperienceGenerationService.generateExperiences({
                        userId: user?.id || "anonymous",
                        preferences: userPrefs,
                        location: userLocation,
                      });
                  }

                  if (generatedExperiences.length > 0) {
                    const transformed = generatedExperiences.map((exp) => ({
                      id: exp.id,
                      title: exp.title,
                      category: exp.category,
                      categoryIcon: exp.categoryIcon,
                    lat: exp.lat,
                    lng: exp.lng,
                      timeAway: exp.travelTime,
                      description: exp.description,
                      budget: exp.priceRange,
                      rating: exp.rating,
                      image: exp.heroImage,
                      images: exp.images || [exp.heroImage],
                      priceRange: exp.priceRange,
                      distance: exp.distance,
                      travelTime: exp.travelTime,
                      experienceType: exp.category,
                      highlights: exp.highlights || [],
                      fullDescription: exp.description,
                      address: exp.address,
                      openingHours: "",
                      tags: exp.highlights || [],
                      matchScore: exp.matchScore,
                      reviewCount: exp.reviewCount,
                      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
                      matchFactors: exp.matchFactors || {
                        location: 85,
                        budget: 85,
                        category: 85,
                        time: 85,
                        popularity: 85,
                      },
                    }));
                    setRecommendations(transformed);
                    setError(null);
                  } else {
                    setError("no_matches");
                  }
                } catch (err) {
                  setError("Failed to load recommendations");
                } finally {
                  setLoading(false);
                }
              };
              fetchRecommendations();
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
              setError(null);
              setLoading(true);
              // Retry by re-fetching
              const fetchRecommendations = async () => {
                if (!userLocation && currentMode === "solo") return;
                try {
                  let generatedExperiences: any[] = [];

                  // Resolve session ID from currentMode if needed
                  const resolvedSessionIdForRetry =
                    currentMode !== "solo"
                      ? currentSession?.id ||
                        availableSessions.find(
                          (s) => s.id === currentMode || s.name === currentMode
                        )?.id
                      : null;

                  // Check if we're in collaboration mode and have a session
                  const isCollaborationMode =
                    currentMode !== "solo" && resolvedSessionIdForRetry;

                  if (isCollaborationMode) {
                    console.log(
                      `🎯 Retry: Collaboration mode - Using session experiences`
                    );
                    console.log(`   Session ID: ${resolvedSessionIdForRetry}`);
                    // Use session-based generation
                    generatedExperiences =
                      await ExperienceGenerationService.generateSessionExperiences(
                        {
                          sessionId: resolvedSessionIdForRetry,
                          userId: user?.id,
                        }
                      );
                  } else {
                    console.log(
                      `🎯 Retry: Solo mode - Using individual experiences`
                    );
                    // Use solo generation
                    const userPrefs: UserPreferences = user?.id
                      ? (await ExperiencesService.getUserPreferences(
                          user.id
                        )) ?? getDefaultPreferences()
                      : getDefaultPreferences();

                    generatedExperiences =
                      await ExperienceGenerationService.generateExperiences({
                        userId: user?.id || "anonymous",
                        preferences: userPrefs,
                        location: userLocation,
                      });
                  }

                  if (generatedExperiences.length > 0) {
                    const transformed = generatedExperiences.map((exp) => ({
                      id: exp.id,
                      title: exp.title,
                      category: exp.category,
                      categoryIcon: exp.categoryIcon,
                      timeAway: exp.travelTime,
                      description: exp.description,
                      budget: exp.priceRange,
                      rating: exp.rating,
                      image: exp.heroImage,
                      images: exp.images || [exp.heroImage],
                      priceRange: exp.priceRange,
                      distance: exp.distance,
                      travelTime: exp.travelTime,
                      experienceType: exp.category,
                      highlights: exp.highlights || [],
                      fullDescription: exp.description,
                      address: exp.address,
                      openingHours: "",
                      tags: exp.highlights || [],
                      matchScore: exp.matchScore,
                      reviewCount: exp.reviewCount,
                      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
                      matchFactors: exp.matchFactors || {
                        location: 85,
                        budget: 85,
                        category: 85,
                        time: 85,
                        popularity: 85,
                      },
                    }));
                    setRecommendations(transformed);
                    setError(null);
                  }
                } catch (err) {
                  setError("Failed to load recommendations");
                } finally {
                  setLoading(false);
                }
              };
              fetchRecommendations();
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

  // Only show "all caught up" if we're NOT loading, NOT transitioning, and truly have no recommendations
  // This prevents showing the empty state during mode transitions
  if (
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
            You've reviewed all available recommendations. Check back later for
            more personalized suggestions!
          </Text>
          <TouchableOpacity
            onPress={() => {
              setRemovedCards(new Set());
              setCurrentCardIndex(0);
              position.setValue({ x: 0, y: 0 });
              onResetCards?.();
            }}
            style={styles.startOverButton}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.startOverButtonText}>Start Over</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // If we have no recommendations but we're still loading/transitioning, show loader
  if (availableRecommendations.length === 0) {
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

  if (!currentRec) {
    return null;
  }

  const CategoryIcon = getIconComponent(currentRec.categoryIcon);

  return (
    <SafeAreaView style={styles.safeArea}>
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
                    color="#1f2937"
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
                  <Text style={styles.description} numberOfLines={2}>
                    {currentRec.description}
                  </Text>

                  {/* Address - Show in collaboration mode */}
                  {currentMode !== "solo" && currentRec.address && (
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

                  {/* Top 2 Highlights */}
                  {currentRec.highlights &&
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
                    )}
                </View>

                {/* Share Button - Centered at bottom */}
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={handleShare}
                  activeOpacity={0.7}
                >
                  <Ionicons name="share-outline" size={18} color="#6b7280" />
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
        onSave={(card) => {
          onCardLike?.(card);
          handleCloseExpandedModal();
        }}
        onSchedule={(card) => {
          onAddToCalendar?.(card);
          handleCloseExpandedModal();
        }}
        onPurchase={(card, bookingOption) => {
          onPurchaseComplete?.(card, bookingOption);
          handleCloseExpandedModal();
        }}
        onShare={(card) => {
          onShareCard?.(card);
        }}
        userPreferences={userPreferences}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  container: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 12,
  },
  cardContainer: {
    width: screenWidth * 0.92,
    height: CARD_HEIGHT,
    maxWidth: 400,
    position: "relative",
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
