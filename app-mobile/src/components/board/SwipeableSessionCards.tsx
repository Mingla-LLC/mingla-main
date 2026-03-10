import React, { useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatPriceRange, parseAndFormatDistance, getCurrencySymbol, getCurrencyRate } from "../utils/formatters";
import { PriceTierSlug, TIER_BY_SLUG, formatTierLabel } from '../../constants/priceTiers';
import { useSessionVoting } from "../../hooks/useSessionVoting";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.75;
const CARD_GAP = 12;

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
  sessionId: string;
  userId: string | undefined;
  participantCount: number;
  onViewDetails: (card: SavedCard) => void;
  loading?: boolean;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
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
  sessionId,
  userId,
  participantCount,
  onViewDetails,
  loading = false,
  accountPreferences,
}) => {
  const scrollRef = useRef<ScrollView | null>(null);
  const [scrollPosition, setScrollPosition] = useState(0);

  const {
    voteCounts,
    rsvpCounts,
    lockedCards,
    handleVote: onVote,
    handleRSVP: onRSVP,
  } = useSessionVoting(sessionId, userId, participantCount);

  // Vote-based ordering: descending by yes votes, then by saved_at
  const sortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      const aVotes = voteCounts[a.id]?.yes ?? 0;
      const bVotes = voteCounts[b.id]?.yes ?? 0;
      if (bVotes !== aVotes) return bVotes - aVotes;
      // Secondary sort: newest first
      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime();
    });
  }, [cards, voteCounts]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollPosition(event.nativeEvent.contentOffset.x);
  }, []);

  const scrollCards = useCallback((direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = CARD_WIDTH + CARD_GAP;
    const newPosition =
      direction === "right"
        ? scrollPosition + scrollAmount
        : Math.max(0, scrollPosition - scrollAmount);
    scrollRef.current.scrollTo({ x: newPosition, animated: true });
  }, [scrollPosition]);

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

  return (
    <View style={styles.container}>
      {/* Card count header */}
      <View style={styles.cardCountHeader}>
        <Text style={styles.cardCountText}>{sortedCards.length} card{sortedCards.length !== 1 ? "s" : ""}</Text>
        {cards.length > 1 && (
          <View style={styles.scrollHint}>
            <Ionicons name="arrow-forward" size={14} color="#9ca3af" />
            <Text style={styles.scrollHintText}>Scroll to browse</Text>
          </View>
        )}
      </View>

      {/* Horizontal scrollable cards */}
      <View style={styles.scrollContainer}>
        {/* Left Navigation Button */}
        {cards.length > 1 && scrollPosition > 10 && (
          <TouchableOpacity
            style={[styles.navButton, styles.navButtonLeft]}
            onPress={() => scrollCards("left")}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          decelerationRate="fast"
          snapToInterval={CARD_WIDTH + CARD_GAP}
          snapToAlignment="start"
        >
          {sortedCards.map((card, index) => {
            const cardData = card.card_data || card.experience_data || {};
            const voteCount = voteCounts[card.id] || { yes: 0, no: 0, userVote: null, voters: [] };
            const rsvpCount = rsvpCounts[card.id] || { responded: 0, total: 0, userRSVP: null, attendees: [] };
            const isCardLocked = lockedCards[card.id]?.isLocked || false;
            const isCurated = cardData.cardType === 'curated';
            const categoryIcon = getIconComponent(isCurated ? "compass" : (cardData.categoryIcon || "star"));
            const categoryLabel = isCurated ? "Adventurous" : (cardData.category || "Experience");

            return (
              <TouchableOpacity
                key={card.id}
                style={[styles.card, isCardLocked && styles.cardLocked]}
                onPress={() => onViewDetails(card)}
                activeOpacity={0.9}
              >
                {/* Locked badge */}
                {isCardLocked && (
                  <View style={styles.lockedBadge}>
                    <Ionicons name="lock-closed" size={12} color="#FFFFFF" />
                    <Text style={styles.lockedBadgeText}>Locked In</Text>
                  </View>
                )}

                {/* Image Section */}
                <View style={styles.imageContainer}>
                  <Image
                    source={{ uri: cardData.image || cardData.images?.[0] }}
                    style={styles.cardImage}
                    resizeMode="cover"
                  />

                  {/* Card index badge */}
                  <View style={styles.cardCounter}>
                    <Text style={styles.cardCounterText}>
                      {index + 1}/{sortedCards.length}
                    </Text>
                  </View>

                  {/* Title Overlay */}
                  <View style={styles.titleOverlay}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {cardData.title || "Untitled"}
                    </Text>
                    <View style={styles.detailsBadges}>
                      <View style={styles.detailBadge}>
                        <Ionicons name="location" size={11} color="white" />
                        <Text style={styles.detailBadgeText}>
                          {parseAndFormatDistance(cardData.distance, accountPreferences?.measurementSystem) || "Nearby"}
                        </Text>
                      </View>
                      <View style={styles.detailBadge}>
                        <Ionicons name="star" size={11} color="white" />
                        <Text style={styles.detailBadgeText}>
                          {cardData.rating?.toFixed(1) || "4.5"}
                        </Text>
                      </View>
                      <View style={styles.detailBadge}>
                        <Text style={styles.detailBadgeText}>
                          {(cardData as any).priceTier && TIER_BY_SLUG[(cardData as any).priceTier as PriceTierSlug]
                            ? formatTierLabel((cardData as any).priceTier as PriceTierSlug, getCurrencySymbol(accountPreferences?.currency), getCurrencyRate(accountPreferences?.currency))
                            : formatPriceRange(cardData.priceRange, accountPreferences?.currency) || "$"}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Details Section */}
                <View style={styles.cardDetails}>
                  {/* Category */}
                  <View style={styles.categoryRow}>
                    <Ionicons name={categoryIcon as any} size={14} color="#eb7825" />
                    <Text style={styles.categoryText}>{categoryLabel}</Text>
                  </View>

                  {/* Description */}
                  <Text style={styles.description} numberOfLines={2}>
                    {cardData.description || ""}
                  </Text>

                  {/* RSVP Progress */}
                  {rsvpCount.total > 0 && rsvpCount.responded > 0 && (
                    <View style={styles.rsvpProgressRow}>
                      <View style={styles.rsvpProgressBarBg}>
                        <View
                          style={[
                            styles.rsvpProgressBarFill,
                            { width: `${Math.min(100, (rsvpCount.responded / rsvpCount.total) * 100)}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.rsvpProgressText}>
                        {rsvpCount.responded}/{rsvpCount.total} attending
                      </Text>
                    </View>
                  )}

                  {/* Vote/RSVP Buttons */}
                  <View
                    style={styles.actionButtonsRow}
                  >
                    {/* Thumbs Up */}
                    <TouchableOpacity
                      style={[
                        styles.voteButton,
                        styles.thumbsUpButton,
                        voteCount.userVote === "yes" && styles.voteButtonActive,
                        isCardLocked && styles.buttonDisabled,
                      ]}
                      onPress={() => onVote(card.id, "yes")}
                      disabled={isCardLocked}
                    >
                      <Ionicons name="thumbs-up" size={15} color="white" />
                      <Text style={styles.voteButtonText}>{voteCount.yes}</Text>
                    </TouchableOpacity>

                    {/* Thumbs Down */}
                    <TouchableOpacity
                      style={[
                        styles.voteButton,
                        styles.thumbsDownButton,
                        voteCount.userVote === "no" && styles.thumbsDownButtonActive,
                        isCardLocked && styles.buttonDisabled,
                      ]}
                      onPress={() => onVote(card.id, "no")}
                      disabled={isCardLocked}
                    >
                      <Ionicons name="thumbs-down" size={15} color="#d63d1f" />
                      <Text style={styles.thumbsDownText}>{voteCount.no}</Text>
                    </TouchableOpacity>

                    {/* RSVP Button */}
                    <TouchableOpacity
                      style={[
                        styles.rsvpButton,
                        rsvpCount.userRSVP === "yes" && styles.rsvpButtonActive,
                        isCardLocked && styles.buttonDisabled,
                      ]}
                      onPress={() => onRSVP(card.id, "yes")}
                      disabled={isCardLocked}
                    >
                      <Text
                        style={[
                          styles.rsvpButtonText,
                          rsvpCount.userRSVP === "yes" && styles.rsvpButtonTextActive,
                        ]}
                      >
                        {rsvpCount.userRSVP === "yes" ? "RSVP'd" : "RSVP"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Right Navigation Button */}
        {cards.length > 1 && (
          <TouchableOpacity
            style={[styles.navButton, styles.navButtonRight]}
            onPress={() => scrollCards("right")}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 0,
    marginTop: 0,
    backgroundColor: "white",
    overflow: "hidden",
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
  cardCountHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    paddingVertical: 4,
  },
  cardCountText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  scrollHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  scrollHintText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  scrollContainer: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    gap: CARD_GAP,
  },
  navButton: {
    position: "absolute",
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  navButtonLeft: {
    left: 4,
  },
  navButtonRight: {
    right: 4,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    overflow: "hidden",
  },
  imageContainer: {
    height: 260,
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  cardCounter: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cardCounterText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
  titleOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    paddingBottom: 16,
  },
  cardTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 6,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  detailsBadges: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  detailBadge: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  detailBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "500",
  },
  cardDetails: {
    padding: 12,
    gap: 6,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  categoryText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "500",
  },
  description: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 18,
  },
  actionButtonsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  voteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 18,
    gap: 5,
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
    fontSize: 13,
    fontWeight: "600",
    color: "white",
  },
  thumbsDownText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#d63d1f",
  },
  rsvpButton: {
    flex: 1.2,
    backgroundColor: "#ffebee",
    paddingVertical: 8,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpButtonActive: {
    backgroundColor: "#eb7825",
  },
  rsvpButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#eb7825",
  },
  rsvpButtonTextActive: {
    color: "white",
  },
  cardLocked: {
    borderWidth: 2,
    borderColor: "#10B981",
  },
  lockedBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#10B981",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  lockedBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  rsvpProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rsvpProgressBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: "#E5E7EB",
    borderRadius: 2,
    overflow: "hidden",
  },
  rsvpProgressBarFill: {
    height: "100%",
    backgroundColor: "#10B981",
    borderRadius: 2,
  },
  rsvpProgressText: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "500",
  },
});

export default SwipeableSessionCards;
