import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CARD_HEIGHT = Math.min(SCREEN_HEIGHT * 0.68, 700);
const IMAGE_SECTION_RATIO = 0.62;
const DETAILS_SECTION_RATIO = 1 - IMAGE_SECTION_RATIO;

interface SavedCard {
  id: string;
  saved_card_id?: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_id?: string | null;
  saved_experience_id?: string | null;
  card_data?: any;
  experience_data?: any;
}

interface SwipeableSessionCardsProps {
  cards: SavedCard[];
  voteCounts: Record<string, { yes: number; no: number; userVote: "yes" | "no" | null }>;
  rsvpCounts: Record<string, { responded: number; total: number; userRSVP: "yes" | "no" | null }>;
  onVote: (cardId: string, vote: "yes" | "no") => void;
  onRSVP: (cardId: string, rsvp: "yes" | "no") => void;
  onViewDetails: (card: SavedCard) => void;
  loading?: boolean;
}

const getIconComponent = (iconName: string) => {
  const ioniconsNames = [
    "walk", "cafe", "restaurant", "film", "brush", "basketball", "wine",
    "sparkles", "basket", "location", "leaf", "fitness", "eye", "heart",
    "calendar", "time", "star", "navigate", "color-palette", "bookmark",
  ];

  if (ioniconsNames.includes(iconName)) {
    return iconName;
  }

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

export const SwipeableSessionCards: React.FC<SwipeableSessionCardsProps> = ({
  cards,
  voteCounts,
  rsvpCounts,
  onVote,
  onRSVP,
  onViewDetails,
  loading = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const position = useRef(new Animated.ValueXY()).current;
  const topCardOpacity = useRef(new Animated.Value(1)).current;
  const currentIndexRef = useRef(0);
  const cardsRef = useRef(cards);

  // Keep refs in sync
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Reset index when cards change
  useEffect(() => {
    if (cards.length > 0 && currentIndex >= cards.length) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
    }
  }, [cards.length, currentIndex]);

  // Rotation interpolation based on horizontal drag (like homepage)
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ["-30deg", "0deg", "30deg"],
  });

  // Next card scale effect - scales up as you swipe
  const nextCardScale = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [1, 0.92, 1],
    extrapolate: "clamp",
  });

  const completeSwipe = (newIndex: number) => {
    // Hide the top card (which still shows old content)
    topCardOpacity.setValue(0);
    
    // Reset position while card is invisible
    position.setValue({ x: 0, y: 0 });
    
    // Update the index - this changes what card is rendered
    setCurrentIndex(newIndex);
    currentIndexRef.current = newIndex;
    
    // After a micro-delay to let React re-render with new content, fade in
    requestAnimationFrame(() => {
      Animated.timing(topCardOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: false,
      }).start(() => {
        setIsAnimating(false);
      });
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isAnimating && cardsRef.current.length > 1,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return !isAnimating && cardsRef.current.length > 1 && (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5);
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

        const swipeThreshold = 120;
        const currentCards = cardsRef.current;
        const currentIdx = currentIndexRef.current;

        // Swipe left - go to next card (only if not on last card)
        if (gestureState.dx < -swipeThreshold && currentCards.length > 1 && currentIdx < currentCards.length - 1) {
          setIsAnimating(true);
          Animated.timing(position, {
            toValue: { x: -SCREEN_WIDTH - 100, y: gestureState.dy },
            duration: 200,
            useNativeDriver: false,
          }).start(() => {
            completeSwipe(currentIdx + 1);
          });
        }
        // Swipe right - go to previous card (only if not on first card)
        else if (gestureState.dx > swipeThreshold && currentCards.length > 1 && currentIdx > 0) {
          setIsAnimating(true);
          Animated.timing(position, {
            toValue: { x: SCREEN_WIDTH + 100, y: gestureState.dy },
            duration: 200,
            useNativeDriver: false,
          }).start(() => {
            completeSwipe(currentIdx - 1);
          });
        }
        // Snap back if swipe wasn't far enough or at boundary
        else {
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const handleCardTap = () => {
    if (isAnimating) return;
    // Only handle tap if card is not being dragged
    const currentX = (position.x as any)._value || 0;
    const currentY = (position.y as any)._value || 0;
    if (Math.abs(currentX) < 10 && Math.abs(currentY) < 10 && cards[currentIndex]) {
      onViewDetails(cards[currentIndex]);
    }
  };

  if (loading && cards.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  if (cards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="images-outline" size={64} color="#ccc" />
        <Text style={styles.emptyText}>No saved cards yet</Text>
        <Text style={styles.emptySubtext}>
          Swipe right on cards to save them to this board
        </Text>
      </View>
    );
  }

  const currentCard = cards[currentIndex];
  // Calculate both next and previous card indices
  const nextIndex = (currentIndex + 1) % cards.length;
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : cards.length - 1;
  const nextCard = cards.length > 1 ? cards[nextIndex] : null;
  const prevCard = cards.length > 1 ? cards[prevIndex] : null;
  
  const cardData = currentCard?.card_data || currentCard?.experience_data || {};
  const nextCardData = nextCard?.card_data || nextCard?.experience_data || {};
  const prevCardData = prevCard?.card_data || prevCard?.experience_data || {};
  
  const voteCount = voteCounts[currentCard?.id] || { yes: 0, no: 0, userVote: null };
  const rsvpCount = rsvpCounts[currentCard?.id] || { responded: 0, total: 0, userRSVP: null };

  const CategoryIcon = getIconComponent(cardData.categoryIcon || "star");
  const NextCategoryIcon = getIconComponent(nextCardData.categoryIcon || "star");
  const PrevCategoryIcon = getIconComponent(prevCardData.categoryIcon || "star");

  // Opacity interpolations for background cards based on swipe direction
  const nextCardOpacity = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 3, 0, 1],
    outputRange: [1, 0, 0],
    extrapolate: "clamp",
  });

  const prevCardOpacity = position.x.interpolate({
    inputRange: [-1, 0, SCREEN_WIDTH / 3],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });

  // Helper function to render a background card
  const renderBackgroundCard = (
    bgCardData: any,
    bgCategoryIcon: string,
    opacity: Animated.AnimatedInterpolation<number>
  ) => (
    <Animated.View
      style={[
        styles.card,
        styles.nextCard,
        {
          opacity,
          transform: [{ scale: nextCardScale }],
        },
      ]}
    >
      {/* Hero Image Section */}
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: bgCardData.image || bgCardData.images?.[0] }}
          style={styles.cardImage}
          resizeMode="cover"
        />

        {/* Match Score Badge */}
        <View style={styles.matchBadge}>
          <Ionicons name="star" size={14} color="#eb7825" style={{ marginRight: 4 }} />
          <Text style={styles.matchText}>
            {Math.round(bgCardData.matchScore || 0)}% Match
          </Text>
        </View>

        {/* Title Overlay */}
        <View style={styles.titleOverlay}>
          <Text style={styles.cardTitle}>{bgCardData.title || "Untitled"}</Text>
          <View style={styles.detailsBadges}>
            <View style={styles.detailBadge}>
              <Ionicons name="time" size={12} color="white" />
              <Text style={styles.detailBadgeText}>{bgCardData.travelTime || "N/A"}</Text>
            </View>
            <View style={styles.detailBadge}>
              <Ionicons name="star" size={12} color="white" />
              <Text style={styles.detailBadgeText}>{bgCardData.rating?.toFixed(1) || "4.5"}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Details Section */}
      <View style={styles.cardDetails}>
        <View style={styles.categoryRow}>
          <Ionicons name={bgCategoryIcon as any} size={16} color="#eb7825" />
          <Text style={styles.categoryText}>{bgCardData.category || "Experience"}</Text>
        </View>
        <Text style={styles.description} numberOfLines={2}>
          {bgCardData.description || ""}
        </Text>
      </View>
    </Animated.View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.cardContainer}>
        {/* Previous Card (behind current) - visible when swiping RIGHT */}
        {prevCard && cards.length > 1 && renderBackgroundCard(prevCardData, PrevCategoryIcon, prevCardOpacity)}
        
        {/* Next Card (behind current) - visible when swiping LEFT */}
        {nextCard && cards.length > 1 && renderBackgroundCard(nextCardData, NextCategoryIcon, nextCardOpacity)}

        {/* Current Card */}
        <Animated.View
          style={[
            styles.card,
            {
              opacity: topCardOpacity,
              transform: [
                { translateX: position.x },
                { translateY: position.y },
                { rotate: rotate },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleCardTap}
            style={StyleSheet.absoluteFill}
          >
            {/* Hero Image Section */}
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: cardData.image || cardData.images?.[0] }}
                style={styles.cardImage}
                resizeMode="cover"
              />

              {/* Match Score Badge */}
              <View style={styles.matchBadge}>
                <Ionicons name="star" size={14} color="#eb7825" style={{ marginRight: 4 }} />
                <Text style={styles.matchText}>
                  {Math.round(cardData.matchScore || 0)}% Match
                </Text>
              </View>

              {/* Card Counter */}
              <View style={styles.cardCounter}>
                <Text style={styles.cardCounterText}>
                  {currentIndex + 1} / {cards.length}
                </Text>
              </View>

              {/* Title Overlay */}
              <View style={styles.titleOverlay}>
                <Text style={styles.cardTitle}>{cardData.title || "Untitled"}</Text>
                <View style={styles.detailsBadges}>
                  <View style={styles.detailBadge}>
                    <Ionicons name="time" size={12} color="white" />
                    <Text style={styles.detailBadgeText}>{cardData.travelTime || "N/A"}</Text>
                  </View>
                  <View style={styles.detailBadge}>
                    <Ionicons name="star" size={12} color="white" />
                    <Text style={styles.detailBadgeText}>{cardData.rating?.toFixed(1) || "4.5"}</Text>
                  </View>
                  <View style={styles.detailBadge}>
                    <Text style={styles.detailBadgeText}>{cardData.priceRange || "$"}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Details Section */}
            <View style={styles.cardDetails}>
              <View style={styles.cardDetailsContent}>
                {/* Category */}
                <View style={styles.categoryRow}>
                  <Ionicons name={CategoryIcon as any} size={16} color="#eb7825" />
                  <Text style={styles.categoryText}>{cardData.category || "Experience"}</Text>
                </View>

                {/* Description */}
                <Text style={styles.description} numberOfLines={2}>
                  {cardData.description || ""}
                </Text>

                {/* Vote/RSVP Buttons */}
                <View style={styles.actionButtonsRow}>
                  {/* Thumbs Up */}
                  <TouchableOpacity
                    style={[
                      styles.voteButton,
                      styles.thumbsUpButton,
                      voteCount.userVote === "yes" && styles.voteButtonActive,
                    ]}
                    onPress={() => onVote(currentCard.id, "yes")}
                  >
                    <Ionicons name="thumbs-up" size={18} color="white" />
                    <Text style={styles.voteButtonText}>{voteCount.yes}</Text>
                  </TouchableOpacity>

                  {/* Thumbs Down */}
                  <TouchableOpacity
                    style={[
                      styles.voteButton,
                      styles.thumbsDownButton,
                      voteCount.userVote === "no" && styles.thumbsDownButtonActive,
                    ]}
                    onPress={() => onVote(currentCard.id, "no")}
                  >
                    <Ionicons name="thumbs-down" size={18} color="#d63d1f" />
                    <Text style={styles.thumbsDownText}>{voteCount.no}</Text>
                  </TouchableOpacity>

                  {/* RSVP Button */}
                  <TouchableOpacity
                    style={[
                      styles.rsvpButton,
                      rsvpCount.userRSVP === "yes" && styles.rsvpButtonActive,
                    ]}
                    onPress={() => onRSVP(currentCard.id, "yes")}
                  >
                    <Text
                      style={[
                        styles.rsvpButtonText,
                        rsvpCount.userRSVP === "yes" && styles.rsvpButtonTextActive,
                      ]}
                    >
                      {rsvpCount.userRSVP === "yes" ? "RSVP'd ✓" : "RSVP"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Swipe hint - only show if multiple cards */}
              {cards.length > 1 && (
                <View style={styles.swipeHint}>
                  <Ionicons name="swap-horizontal" size={14} color="#9ca3af" />
                  <Text style={styles.swipeHintText}>Swipe to browse • Tap for details</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Pagination Indicator - only show if multiple cards */}
      {cards.length > 1 && (
        <View style={styles.paginationContainer}>
          {cards.map((_, index) => (
            <View
              key={index}
              style={[
                styles.paginationDot,
                index === currentIndex && styles.paginationDotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  cardContainer: {
    width: SCREEN_WIDTH * 0.92,
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    overflow: "hidden",
    zIndex: 2,
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
  cardCounter: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  cardCounterText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
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
  cardDetails: {
    flex: DETAILS_SECTION_RATIO,
    backgroundColor: "white",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    justifyContent: "space-between",
  },
  cardDetailsContent: {
    flex: 1,
    gap: 10,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  categoryText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "500",
  },
  description: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  actionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  voteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  thumbsUpButton: {
    backgroundColor: "#22c55e",
  },
  thumbsDownButton: {
    backgroundColor: "#ffebee",
  },
  thumbsDownButtonActive: {
    backgroundColor: "#fecaca",
  },
  voteButtonActive: {
    backgroundColor: "#16a34a",
  },
  voteButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  thumbsDownText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#d63d1f",
  },
  rsvpButton: {
    flex: 1.2,
    backgroundColor: "#ffebee",
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpButtonActive: {
    backgroundColor: "#eb7825",
  },
  rsvpButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  rsvpButtonTextActive: {
    color: "white",
  },
  swipeHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 8,
  },
  swipeHintText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  paginationContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
    gap: 8,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d1d5db",
  },
  paginationDotActive: {
    backgroundColor: "#eb7825",
    width: 24,
  },
});

export default SwipeableSessionCards;
