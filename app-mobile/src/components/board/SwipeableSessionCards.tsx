import React, { useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { Icon } from "../ui/Icon";
import { formatPriceRange, parseAndFormatDistance, getCurrencySymbol, getCurrencyRate } from "../utils/formatters";
import { PriceTierSlug, TIER_BY_SLUG, formatTierLabel } from '../../constants/priceTiers';
import type { CuratedStop } from '../../types/curatedExperience';
import { useSessionVoting } from "../../hooks/useSessionVoting";

const CURATED_ICON_MAP: Record<string, string> = {
  'Adventurous':   'compass-outline',
  'First Date':    'people-outline',
  'Romantic':      'heart-outline',
  'Group Fun':     'people-circle-outline',
  'Picnic Dates':  'basket-outline',
  'Take a Stroll': 'walk-outline',
};

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
    "walk-outline", "cafe", "restaurant", "film", "brush", "basketball", "wine",
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
        <Icon name="images-outline" size={64} color="#ccc" />
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
            <Icon name="arrow-forward" size={14} color="#9ca3af" />
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
            <Icon name="chevron-back" size={18} color="#6b7280" />
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
            const categoryIcon = isCurated ? "" : getIconComponent(cardData.categoryIcon || "star");
            const categoryLabel = isCurated ? "" : (cardData.category || "Experience");

            // Shared vote/RSVP buttons for both card types
            const voteButtons = (
              <View style={styles.actionButtonsRow}>
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
                  <Icon name="thumbs-up" size={15} color="white" />
                  <Text style={styles.voteButtonText}>{voteCount.yes}</Text>
                </TouchableOpacity>
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
                  <Icon name="thumbs-down" size={15} color="#d63d1f" />
                  <Text style={styles.thumbsDownText}>{voteCount.no}</Text>
                </TouchableOpacity>
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
            );

            // ── Curated card layout (dark theme, multi-stop image strip) ──
            if (isCurated && Array.isArray(cardData.stops) && cardData.stops.length > 0) {
              const stops = cardData.stops as CuratedStop[];
              const avgRating = (stops.reduce((s, st) => s + (st.rating || 0), 0) / stops.length).toFixed(1);
              const durationHrs = cardData.estimatedDurationMinutes
                ? (cardData.estimatedDurationMinutes / 60).toFixed(1)
                : null;

              // Currency-aware pricing: use first stop's tier label, fallback to price range
              const currencySymbol = getCurrencySymbol(accountPreferences?.currency);
              const currencyRate = getCurrencyRate(accountPreferences?.currency);
              const firstStopTier = stops[0]?.priceTier;
              const priceText = firstStopTier && TIER_BY_SLUG[firstStopTier]
                ? formatTierLabel(firstStopTier, currencySymbol, currencyRate)
                : cardData.totalPriceMin != null && cardData.totalPriceMax != null
                  ? cardData.totalPriceMin === 0 && cardData.totalPriceMax === 0
                    ? "Free"
                    : `${currencySymbol}${Math.round(cardData.totalPriceMin * currencyRate)}–${currencySymbol}${Math.round(cardData.totalPriceMax * currencyRate)}`
                  : "";

              const isSingleStop = stops.length === 1;
              const curatedCategoryLabel = cardData.categoryLabel || "Adventurous";
              const curatedCategoryIcon = CURATED_ICON_MAP[curatedCategoryLabel] || "compass-outline";

              // First stop distance & travel time
              const firstStop = stops[0];
              const distanceKm = firstStop?.distanceFromUserKm;
              const travelMin = firstStop?.travelTimeFromUserMin;
              const formattedDistance = distanceKm != null && distanceKm > 0
                ? parseAndFormatDistance(`${distanceKm.toFixed(1)} km`, accountPreferences?.measurementSystem)
                : null;
              const formattedTravelTime = travelMin != null && travelMin > 0
                ? `${Math.round(travelMin)} min`
                : null;

              return (
                <TouchableOpacity
                  key={card.id}
                  style={[styles.card, styles.curatedCard, isCardLocked && styles.cardLocked]}
                  onPress={() => onViewDetails(card)}
                  activeOpacity={0.9}
                >
                  {isCardLocked && (
                    <View style={styles.lockedBadge}>
                      <Icon name="lock-closed" size={12} color="#FFFFFF" />
                      <Text style={styles.lockedBadgeText}>Locked In</Text>
                    </View>
                  )}

                  {/* Card index badge */}
                  <View style={[styles.cardCounter, { zIndex: 5 }]}>
                    <Text style={styles.cardCounterText}>
                      {index + 1}/{sortedCards.length}
                    </Text>
                  </View>

                  {/* Multi-stop image strip */}
                  <View style={styles.curatedImageStrip}>
                    {stops.map((stop, idx) => (
                      <View key={`${stop.placeId}_${idx}`} style={styles.curatedImageWrapper}>
                        {stop.imageUrl ? (
                          <Image
                            source={{ uri: stop.imageUrl }}
                            style={styles.curatedStopImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={[styles.curatedStopImage, styles.curatedImagePlaceholder]} />
                        )}
                        {!isSingleStop && (
                          <View style={styles.curatedStopBadge}>
                            <Text style={styles.curatedStopBadgeText}>{idx + 1}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>

                  {/* Curated info section */}
                  <View style={styles.curatedInfoSection}>
                    {/* Category badge */}
                    <View style={styles.curatedCategoryBadge}>
                      <Icon name={curatedCategoryIcon} size={12} color="#fff" />
                      <Text style={styles.curatedCategoryText} numberOfLines={1}>{curatedCategoryLabel}</Text>
                      <Text style={styles.curatedStopCountText}> · {stops.length} {stops.length === 1 ? "spot" : "stops"}</Text>
                    </View>

                    <Text style={styles.curatedTitle} numberOfLines={2} ellipsizeMode="tail">
                      {cardData.title || "Untitled"}
                    </Text>

                    {/* Meta row */}
                    <View style={styles.curatedMetaRow}>
                      {formattedDistance ? (
                        <>
                          <Icon name="location" size={11} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.curatedMetaText}> {formattedDistance}</Text>
                          <Text style={styles.curatedMetaDot}> · </Text>
                        </>
                      ) : null}
                      {formattedTravelTime ? (
                        <>
                          <Icon name="walk-outline" size={11} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.curatedMetaText}> {formattedTravelTime}</Text>
                          <Text style={styles.curatedMetaDot}> · </Text>
                        </>
                      ) : null}
                      {priceText ? (
                        <>
                          <Text style={styles.curatedMetaText}>{priceText}</Text>
                          <Text style={styles.curatedMetaDot}> · </Text>
                        </>
                      ) : null}
                      {durationHrs ? (
                        <>
                          <Icon name="time-outline" size={11} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.curatedMetaText}> {durationHrs}h</Text>
                          <Text style={styles.curatedMetaDot}> · </Text>
                        </>
                      ) : null}
                      <Icon name="star" size={11} color="#F59E0B" />
                      <Text style={styles.curatedMetaText}> {avgRating} avg</Text>
                    </View>

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
                        <Text style={[styles.rsvpProgressText, { color: "rgba(255,255,255,0.6)" }]}>
                          {rsvpCount.responded}/{rsvpCount.total} attending
                        </Text>
                      </View>
                    )}

                    {/* Vote buttons */}
                    {voteButtons}
                  </View>
                </TouchableOpacity>
              );
            }

            // ── Standard category card layout ──
            return (
              <TouchableOpacity
                key={card.id}
                style={[styles.card, isCardLocked && styles.cardLocked]}
                onPress={() => onViewDetails(card)}
                activeOpacity={0.9}
              >
                {isCardLocked && (
                  <View style={styles.lockedBadge}>
                    <Icon name="lock-closed" size={12} color="#FFFFFF" />
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

                  <View style={styles.cardCounter}>
                    <Text style={styles.cardCounterText}>
                      {index + 1}/{sortedCards.length}
                    </Text>
                  </View>

                  <View style={styles.titleOverlay}>
                    <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                      {cardData.title || "Untitled"}
                    </Text>
                    <View style={styles.detailsBadges}>
                      <View style={styles.detailBadge}>
                        <Icon name="location" size={11} color="white" />
                        <Text style={styles.detailBadgeText} numberOfLines={1} ellipsizeMode="tail">
                          {parseAndFormatDistance(cardData.distance, accountPreferences?.measurementSystem) || "Nearby"}
                        </Text>
                      </View>
                      <View style={styles.detailBadge}>
                        <Icon name="star" size={11} color="white" />
                        <Text style={styles.detailBadgeText} numberOfLines={1} ellipsizeMode="tail">
                          {cardData.rating?.toFixed(1) || "4.5"}
                        </Text>
                      </View>
                      <View style={styles.detailBadge}>
                        <Text style={styles.detailBadgeText} numberOfLines={1} ellipsizeMode="tail">
                          {(cardData as any).priceTier && TIER_BY_SLUG[(cardData as any).priceTier as PriceTierSlug]
                            ? formatTierLabel((cardData as any).priceTier as PriceTierSlug, getCurrencySymbol(accountPreferences?.currency), getCurrencyRate(accountPreferences?.currency))
                            : formatPriceRange(cardData.priceRange, accountPreferences?.currency) || "$"}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.cardDetails}>
                  <View style={styles.categoryRow}>
                    <Icon name={categoryIcon} size={14} color="#eb7825" />
                    <Text style={styles.categoryText} numberOfLines={1} ellipsizeMode="tail">{categoryLabel}</Text>
                  </View>

                  <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
                    {cardData.description || ""}
                  </Text>

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

                  {voteButtons}
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
            <Icon name="chevron-forward" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-start",
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
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 2,
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
    flex: 1,
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
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    borderRadius: 22,
    borderWidth: 0.5,
    borderColor: "rgba(0, 0, 0, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: Platform.OS === "ios" ? 12 : 8 },
    shadowOpacity: Platform.OS === "ios" ? 0.2 : 0.15,
    shadowRadius: Platform.OS === "ios" ? 32 : 24,
    elevation: 10,
    overflow: "hidden",
  },
  // ── Curated card styles ──
  curatedCard: {
    backgroundColor: "#1C1C1E",
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  curatedImageStrip: {
    flexDirection: "row",
    height: Platform.OS === "ios" ? 250 : 210,
  },
  curatedImageWrapper: {
    flex: 1,
    position: "relative",
  },
  curatedStopImage: {
    width: "100%",
    height: "100%",
  },
  curatedImagePlaceholder: {
    backgroundColor: "#2C2C2E",
  },
  curatedStopBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  curatedStopBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  curatedInfoSection: {
    flex: 1,
    padding: 12,
    gap: 6,
    justifyContent: "center",
  },
  curatedCategoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F59E0B",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  curatedCategoryText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  curatedStopCountText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "500",
  },
  curatedTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
  },
  curatedMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  curatedMetaText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
  },
  curatedMetaDot: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
  },
  // ── Standard card styles ──
  imageContainer: {
    height: Platform.OS === "ios" ? 443 : 365,
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
    maxWidth: "45%",
  },
  detailBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "500",
    flexShrink: 1,
  },
  cardDetails: {
    padding: 12,
    gap: 6,
    overflow: "hidden",
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },
  categoryText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1,
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
    opacity: 0.35,
    backgroundColor: "#D1D5DB",
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
