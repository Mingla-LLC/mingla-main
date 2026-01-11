import React, { useState, useEffect, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import ExpandedCardModal from "../ExpandedCardModal";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { useSavedCards } from "@/src/hooks/useSavedCards";
import { useAppStore } from "../../store/appStore";

interface SavedCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceRange: string;
  travelTime: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  matchScore: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  dateAdded: string;
  source: "solo" | "collaboration";
  sessionName?: string;
  purchaseOptions?: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    description: string;
    features: string[];
    popular?: boolean;
  }>;
}

interface SavedTabProps {
  savedCards: SavedCard[];
  isLoading?: boolean;
  onScheduleFromSaved: (card: SavedCard) => void | Promise<void>;
  onPurchaseFromSaved: (card: SavedCard, purchaseOption: any) => void;
  onShareCard: (card: SavedCard) => void;
  onRemoveSaved: (card: SavedCard) => void;
  userPreferences?: any;
  scheduledCardIds?: string[];
}

const SavedTab = ({
  savedCards,
  isLoading = false,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
  onRemoveSaved,
  userPreferences,
  scheduledCardIds = [],
}: SavedTabProps) => {
  const [selectedCardForModal, setSelectedCardForModal] =
    useState<ExpandedCardData | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [schedulingCardId, setSchedulingCardId] = useState<string | null>(null);

  // Convert scheduledCardIds to Set for O(1) lookups
  const scheduledCardIdsSet = useMemo(
    () => new Set(scheduledCardIds || []),
    [scheduledCardIds]
  );

  const getMatchScore = (card: SavedCard): number | null => {
    if (typeof card?.matchScore === "number") return card.matchScore;
    if (typeof (card as any)?.match_score === "number")
      return (card as any).match_score;
    if ((card as any)?.matchFactors?.overall)
      return (card as any).matchFactors.overall;
    if ((card as any)?.matchFactors?.total)
      return (card as any).matchFactors.total;
    return null;
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    listContent: {
      gap: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 62, // Add padding to prevent tab bar from touching last card
    },
    experienceCard: {
      backgroundColor: "white",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
      overflow: "hidden",
    },
    cardContent: {
      padding: 16,
    },
    cardHeader: {
      flexDirection: "row",
      gap: 12,
    },
    cardImage: {
      width: 80,
      height: 80,
      borderRadius: 12,
      overflow: "hidden",
      backgroundColor: "#f3f4f6",
    },
    cardInfo: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: "#111827",
      marginBottom: 4,
    },
    cardSubtitle: {
      fontSize: 14,
      color: "#6b7280",
      marginBottom: 8,
    },
    recentlySavedText: {
      fontSize: 12,
      color: "#9ca3af",
    },
    cardMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    cardStats: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    statItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    statIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    statText: {
      fontSize: 14,
      color: "#6b7280",
    },
    priceText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#eb7825",
    },
    sourceIndicator: {
      marginTop: 4,
    },
    sourceBadge: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    soloBadge: {
      backgroundColor: "#dbeafe",
    },
    collaborationBadge: {
      backgroundColor: "#f3e8ff",
    },
    soloText: {
      fontSize: 12,
      fontWeight: "500",
      color: "#1e40af",
    },
    collaborationText: {
      fontSize: 12,
      fontWeight: "500",
      color: "#7c3aed",
    },
    sourceIcon: {
      width: 12,
      height: 12,
    },
    sourceText: {
      fontSize: 12,
    },
    quickActions: {
      paddingTop: 12,
      paddingHorizontal: 16,
      paddingBottom: 16,
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
    },
    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: "#eb7825",
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    primaryButtonDisabled: {
      opacity: 0.7,
    },
    primaryButtonText: {
      color: "white",
      fontSize: 14,
      fontWeight: "600",
    },
    shareButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "white",
      borderWidth: 1,
      borderColor: "#e5e7eb", // Light gray border
      alignItems: "center",
      justifyContent: "center",
    },
    deleteButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "white",
      borderWidth: 1,
      borderColor: "#ef4444", // Red border
      alignItems: "center",
      justifyContent: "center",
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
      backgroundColor: "#f9fafb",
    },
    imageGallery: {
      position: "relative",
    },
    galleryImage: {
      aspectRatio: 16 / 9,
      overflow: "hidden",
    },
    imageNavigation: {
      position: "absolute",
      top: "50%",
      transform: [{ translateY: -16 }],
      width: 32,
      height: 32,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    leftNav: {
      left: 8,
    },
    rightNav: {
      right: 8,
    },
    navIcon: {
      width: 16,
      height: 16,
      color: "white",
    },
    imageIndicators: {
      position: "absolute",
      bottom: 8,
      left: "50%",
      transform: [{ translateX: -50 }],
      flexDirection: "row",
      gap: 4,
    },
    indicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    activeIndicator: {
      backgroundColor: "white",
    },
    inactiveIndicator: {
      backgroundColor: "rgba(255, 255, 255, 0.5)",
    },
    detailsSection: {
      padding: 16,
      gap: 16,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    sectionText: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    highlightsContainer: {
      gap: 8,
    },
    highlightsList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    highlightTag: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "#fef3e2",
      borderRadius: 8,
    },
    highlightText: {
      fontSize: 12,
      color: "#ea580c",
    },
    locationContainer: {
      gap: 8,
    },
    locationRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    locationIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
      marginTop: 2,
      flexShrink: 0,
    },
    locationText: {
      fontSize: 14,
      color: "#6b7280",
      flex: 1,
    },
    socialStatsContainer: {
      gap: 8,
    },
    socialStatsTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    socialStatsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    socialStatItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    socialStatIcon: {
      width: 16,
      height: 16,
    },
    socialStatText: {
      fontSize: 14,
      color: "#6b7280",
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 48,
    },
    emptyStateIcon: {
      width: 48,
      height: 48,
      color: "#d1d5db",
      marginBottom: 16,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    emptyStateSubtitle: {
      fontSize: 14,
      color: "#6b7280",
      textAlign: "center",
      marginBottom: 24,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 48,
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      color: "#6b7280",
      marginTop: 8,
    },
  });

  const getIconComponent = (iconName: any) => {
    if (typeof iconName === "function") {
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
      Users: "people",
      Check: "checkmark",
      ThumbsUp: "thumbs-up",
      ThumbsDown: "thumbs-down",
      MessageSquare: "chatbubble",
      Share2: "share",
      X: "close",
      ChevronRight: "chevron-forward",
      ChevronLeft: "chevron-back",
      Bookmark: "bookmark",
    };

    return iconMap[iconName] || "heart";
  };

  const handleSchedule = async (card: SavedCard) => {
    if (scheduledCardIdsSet.has(card.id)) {
      return;
    }

    setSchedulingCardId(card.id);
    try {
      await onScheduleFromSaved(card);

      // Add to device calendar
      try {
        const dateTimePrefs = userPreferences
          ? {
              timeOfDay: userPreferences.timeOfDay || "Afternoon",
              dayOfWeek: userPreferences.dayOfWeek || "Weekend",
              planningTimeframe:
                userPreferences.planningTimeframe || "This month",
            }
          : {
              timeOfDay: "Afternoon",
              dayOfWeek: "Weekend",
              planningTimeframe: "This month",
            };

        // This would integrate with calendar utilities
      } catch (error) {
        console.error("Error adding to device calendar:", error);
      }
    } catch (error) {
      console.error("Error scheduling card:", error);
    } finally {
      // Small delay to show success feedback
      setTimeout(() => {
        setSchedulingCardId(null);
      }, 500);
    }
  };

  const handleCardPress = (card: SavedCard) => {
    const matchScore = getMatchScore(card);

    // Transform saved card to ExpandedCardData format
    const expandedCardData: ExpandedCardData = {
      id: card.id,
      title: card.title,
      category: card.category,
      categoryIcon: card.categoryIcon,
      description: card.description,
      fullDescription: card.fullDescription || card.description,
      image: card.image,
      images: card.images || [card.image],
      rating: card.rating || 4.5,
      reviewCount: card.reviewCount || 0,
      priceRange: card.priceRange || "$25-50",
      distance: (card as any).distance || "",
      travelTime: card.travelTime || "15 min",
      address: card.address || "",
      openingHours: (card as any).openingHours,
      highlights: card.highlights || [],
      tags: (card as any).tags || [],
      matchScore: matchScore || 0,
      matchFactors: (card as any).matchFactors || {
        location: 0,
        budget: 0,
        category: 0,
        time: 0,
        popularity: 0,
      },
      socialStats: {
        views: card.socialStats?.views || 0,
        likes: card.socialStats?.likes || 0,
        saves: card.socialStats?.saves || 0,
        shares: (card.socialStats as any)?.shares || 0,
      },
      location: (card as any).location,
      selectedDateTime: userPreferences?.datetime_pref
        ? new Date(userPreferences.datetime_pref)
        : new Date(),
    };

    setSelectedCardForModal(expandedCardData);
    setIsModalVisible(true);
  };

  const handleCloseModal = () => {
    setIsModalVisible(false);
    setSelectedCardForModal(null);
  };

  const renderCard = ({ item: card }: { item: SavedCard }) => {
    const isScheduled = scheduledCardIdsSet.has(card.id);
    return (
      <View style={styles.experienceCard}>
        <TouchableOpacity
          onPress={() => handleCardPress(card)}
          activeOpacity={0.7}
          style={styles.cardContent}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardImage}>
              <ImageWithFallback
                source={{ uri: card.image }}
                alt={card.title}
                style={{ width: "100%", height: "100%" }}
              />
            </View>

            <View style={styles.cardInfo}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  {/* Subtitle - use category or a default subtitle */}
                  <Text style={styles.cardSubtitle}>
                    {(card as any).subtitle || card.category || "Experience"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.recentlySavedText}>Recently saved</Text>
                </View>
              </View>

              {/* Stats row: Rating, Duration, Price, Chevron */}
              <View style={styles.cardMeta}>
                <View style={styles.cardStats}>
                  <View style={styles.statItem}>
                    <Ionicons name="star" size={14} color="#fbbf24" />
                    <Text style={styles.statText}>{card.rating || "4.5"}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons name="paper-plane" size={14} color="#6b7280" />
                    <Text style={styles.statText}>
                      {card.travelTime || "15m"}
                    </Text>
                  </View>
                  <Text style={styles.priceText}>
                    {card.priceRange || "$25-50"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </View>

              {/* Source badge */}
              <View style={styles.sourceIndicator}>
                <View
                  style={[
                    styles.sourceBadge,
                    card.source === "solo"
                      ? styles.soloBadge
                      : styles.collaborationBadge,
                  ]}
                >
                  <Text
                    style={[
                      styles.sourceText,
                      card.source === "solo"
                        ? styles.soloText
                        : styles.collaborationText,
                    ]}
                  >
                    {card.source === "solo"
                      ? "Solo Discovery"
                      : `From ${card.sessionName}`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <View style={styles.actionsRow}>
            {/* Conditional Buy Now/Schedule button */}
            {card.purchaseOptions && card.purchaseOptions.length > 0 ? (
              <TouchableOpacity
                onPress={() =>
                  onPurchaseFromSaved(card, card.purchaseOptions?.[0])
                }
                style={styles.primaryButton}
              >
                <Ionicons name="bag" size={16} color="white" />
                <Text style={styles.primaryButtonText}>Buy Now</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => handleSchedule(card)}
                style={[
                  styles.primaryButton,
                  (schedulingCardId === card.id || isScheduled) &&
                    styles.primaryButtonDisabled,
                ]}
                disabled={schedulingCardId === card.id || isScheduled}
              >
                {schedulingCardId === card.id ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Ionicons name="calendar" size={16} color="white" />
                    <Text style={styles.primaryButtonText}>
                      {isScheduled ? "Scheduled" : "Schedule"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => onShareCard(card)}
              style={styles.shareButton}
            >
              <Ionicons name="share-social-outline" size={18} color="#374151" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onRemoveSaved(card)}
              style={styles.deleteButton}
            >
              <Ionicons name="trash-outline" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderEmptyComponent = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#eb7825" />
          <Text style={styles.loadingText}>Loading saved experiences...</Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Ionicons name="heart" size={48} color="#d1d5db" />
        <Text style={styles.emptyStateTitle}>No Saved Experiences</Text>
        <Text style={styles.emptyStateSubtitle}>
          Start swiping to save experiences you love
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={savedCards}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyComponent}
        showsVerticalScrollIndicator={false}
      />

      {/* Expanded Card Modal */}
      {isModalVisible && selectedCardForModal && (
        <ExpandedCardModal
          visible={isModalVisible}
          card={selectedCardForModal}
          onClose={handleCloseModal}
          isSaved={true}
          onSave={async (card) => {
            // Card is already saved, just close the modal
            handleCloseModal();
          }}
          onPurchase={(card, bookingOption) => {
            handleCloseModal();
            onPurchaseFromSaved(card as any, bookingOption);
          }}
          onShare={(card) => {
            handleCloseModal();
            onShareCard(card as any);
          }}
          userPreferences={userPreferences}
        />
      )}
    </View>
  );
};

export default SavedTab;
