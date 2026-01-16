import React, { useState, useEffect, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import ExpandedCardModal from "../ExpandedCardModal";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { useSavedCards } from "@/src/hooks/useSavedCards";
import { useAppStore } from "../../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { useAppState } from "../AppStateManager";
import { CalendarService } from "../../services/calendarService";
import { savedCardsService } from "../../services/savedCardsService";
import { toastManager } from "../ui/Toast";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import ProposeDateTimeModal from "./ProposeDateTimeModal";

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
  sessionId?: string; // Session ID where the card was saved
  purchaseOptions?: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    description: string;
    features: string[];
    popular?: boolean;
  }>;

  lat: number;
  lng: number;
}

interface SavedTabProps {
  isLoading?: boolean;
  onScheduleFromSaved: (card: SavedCard) => void | Promise<void>;
  onPurchaseFromSaved: (card: SavedCard, purchaseOption: any) => void;
  onShareCard: (card: SavedCard) => void;
  userPreferences?: any;
  scheduledCardIds?: string[];
  boardSavedCards?: SavedCard[]; // Optional: board-specific saved cards
  activeBoardSessionId?: string | null; // Session ID for invalidating board cards query
}

const SavedTab = ({
  isLoading = false,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
  userPreferences,
  scheduledCardIds = [],
  boardSavedCards,
  activeBoardSessionId,
}: SavedTabProps) => {
  const {
    savedCards: contextSavedCards,
    isLoadingSavedCards: contextIsLoadingSavedCards,
    calendarEntries,
  } = useAppState();
  const effectiveIsLoading = isLoading || contextIsLoadingSavedCards;
  // Use boardSavedCards if provided, otherwise use savedCards from context
  const savedCards = boardSavedCards ?? contextSavedCards;
  const [selectedCardForModal, setSelectedCardForModal] =
    useState<ExpandedCardData | null>(null);
  const [originalSavedCard, setOriginalSavedCard] = useState<SavedCard | null>(
    null
  );
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [schedulingCardId, setSchedulingCardId] = useState<string | null>(null);
  const [removingCardIds, setRemovingCardIds] = useState<Set<string>>(
    new Set()
  );
  const [showProposeDateTimeModal, setShowProposeDateTimeModal] =
    useState(false);
  const [cardToSchedule, setCardToSchedule] = useState<SavedCard | null>(null);
  const { user } = useAppStore();
  const queryClient = useQueryClient();

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
    scheduleButtonContainer: {
      flex: 1,
      gap: 6,
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
    closedMessage: {
      fontSize: 12,
      color: "#ef4444",
      textAlign: "center",
      marginTop: 4,
      fontWeight: "500",
    },
    warningMessage: {
      fontSize: 12,
      color: "#f59e0b",
      textAlign: "center",
      marginTop: 4,
      fontWeight: "500",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: "white",
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 20,
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
    },
    modalHeaderButtons: {
      flexDirection: "row",
      gap: 16,
    },
    modalCancelButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    modalCancelText: {
      fontSize: 16,
      color: "#6b7280",
    },
    modalConfirmButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    modalConfirmText: {
      fontSize: 16,
      fontWeight: "600",
      color: "#eb7825",
    },
    dateTimePicker: {
      height: 200,
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

  // Helper function to generate suggested dates
  const generateSuggestedDates = (dateTimePrefs: any) => {
    const suggestions = [];
    const today = new Date();

    for (let i = 0; i < 3; i++) {
      const futureDate = new Date(today);

      if (dateTimePrefs?.planningTimeframe === "This week") {
        futureDate.setDate(today.getDate() + (i + 1) * 2);
      } else if (dateTimePrefs?.planningTimeframe === "This month") {
        futureDate.setDate(today.getDate() + (i + 1) * 7);
      } else {
        futureDate.setDate(today.getDate() + (i + 1) * 14);
      }

      if (dateTimePrefs?.dayOfWeek === "Weekend") {
        const dayOfWeek = futureDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          futureDate.setDate(futureDate.getDate() + (6 - dayOfWeek));
        }
      }

      let hour = 14;
      if (dateTimePrefs?.timeOfDay === "Morning") hour = 10;
      else if (dateTimePrefs?.timeOfDay === "Evening") hour = 18;

      futureDate.setHours(hour, 0, 0, 0);
      suggestions.push(futureDate.toISOString());
    }

    return suggestions;
  };

  const handleSchedule = (card: SavedCard) => {
    if (scheduledCardIdsSet.has(card.id)) {
      return;
    }

    // Check if place is open
    const isPlaceOpen =
      ((card as any).openingHours as { open_now?: boolean })?.open_now ?? true;

    if (!isPlaceOpen) {
      Alert.alert(
        "Place Closed",
        "This place is currently closed. Please schedule for when it's open."
      );
      return;
    }

    // Show the propose date/time modal
    setCardToSchedule(card);
    setShowProposeDateTimeModal(true);
  };

  // Get current scheduled date for a card if it exists
  const getCurrentScheduledDate = (cardId: string): Date | null => {
    if (!calendarEntries) return null;
    const entry = calendarEntries.find(
      (entry: any) => entry.experience?.id === cardId || entry.id === cardId
    );
    if (entry && entry.date && entry.time) {
      // Combine date and time strings into a Date object
      const dateTimeString = `${entry.date}T${entry.time}`;
      return new Date(dateTimeString);
    }
    return null;
  };

  // Handle date/time proposal from modal
  const handleProposeDateTime = (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom"
  ) => {
    setShowProposeDateTimeModal(false);
    // For now, immediately proceed with scheduling
    // In the future, this could trigger AI compatibility check
    proceedWithScheduling(date);
  };

  const proceedWithScheduling = async (scheduledDateTime: Date) => {
    if (!cardToSchedule || !user?.id) {
      Alert.alert("Error", "You must be logged in to schedule cards.");
      setCardToSchedule(null);
      return;
    }

    setSchedulingCardId(cardToSchedule.id);
    try {
      const scheduledDateISO = scheduledDateTime.toISOString();

      // Determine source from card
      const source: "solo" | "collaboration" =
        cardToSchedule.source === "solo" ? "solo" : "collaboration";

      // Remove card from saved_cards table when scheduling
      try {
        await savedCardsService.removeCard(
          user.id,
          cardToSchedule.id,
          source,
          cardToSchedule.sessionId || undefined
        );
        queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });
      } catch (error) {
        console.error(
          "Error removing card from saved_cards when scheduling:",
          error
        );
      }

      // Transform card to ExpandedCardData format for calendar entry
      const cardData: ExpandedCardData = {
        id: cardToSchedule.id,
        title: cardToSchedule.title,
        category: cardToSchedule.category,
        categoryIcon: cardToSchedule.categoryIcon,
        description: cardToSchedule.description,
        fullDescription:
          cardToSchedule.fullDescription || cardToSchedule.description,
        image: cardToSchedule.image,
        images: cardToSchedule.images || [cardToSchedule.image],
        rating: cardToSchedule.rating || 4.5,
        reviewCount: cardToSchedule.reviewCount || 0,
        priceRange: cardToSchedule.priceRange || "$25-50",
        distance: (cardToSchedule as any).distance || "",
        travelTime: cardToSchedule.travelTime || "15 min",
        address: cardToSchedule.address || "",
        openingHours: (cardToSchedule as any).openingHours,
        highlights: cardToSchedule.highlights || [],
        tags: (cardToSchedule as any).tags || [],
        matchScore: cardToSchedule.matchScore || 0,
        matchFactors: (cardToSchedule as any).matchFactors || {
          location: 0,
          budget: 0,
          category: 0,
          time: 0,
          popularity: 0,
        },
        socialStats: {
          views: cardToSchedule.socialStats?.views || 0,
          likes: cardToSchedule.socialStats?.likes || 0,
          saves: cardToSchedule.socialStats?.saves || 0,
          shares: (cardToSchedule.socialStats as any)?.shares || 0,
        },
        location: (cardToSchedule as any).location,
      };

      const cardWithSource = {
        ...cardData,
        source,
      };

      // Add to calendar in Supabase (lockedIn)
      const record = await CalendarService.addEntryFromSavedCard(
        user.id,
        cardWithSource,
        scheduledDateISO
      );

      // Invalidate calendar entries query to refresh after adding to lockedIn
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // Add to device calendar
      try {
        const deviceEvent = DeviceCalendarService.createEventFromCard(
          cardData,
          scheduledDateTime,
          record.duration_minutes || 120
        );
        await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
      } catch (deviceCalendarError) {
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Show success toast
      toastManager.success(
        `Scheduled! ${cardToSchedule.title} has been moved to your calendar`,
        3000
      );

      // Call the original handler if provided (for any additional logic)
    } catch (error) {
      console.error("Error scheduling card:", error);
      Alert.alert(
        "Schedule failed",
        "We couldn't add this to your calendar. Please try again."
      );
    } finally {
      setSchedulingCardId(null);
      setCardToSchedule(null);
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
      priceRange: card.priceRange || "N/A",
      distance: (card as any).distance || "",
      travelTime: card.travelTime || "N/A",
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
      location: { lat: card.lat, lng: card.lng },
      selectedDateTime: (card as any)?.dateAdded
        ? new Date((card as any).dateAdded)
        : "N/A",
      // Include strollData if available from saved card
      strollData: (card as any).strollData,
    };

    setSelectedCardForModal(expandedCardData);
    setOriginalSavedCard(card);
    setIsModalVisible(true);
  };

  const handleCloseModal = () => {
    setIsModalVisible(false);
    setSelectedCardForModal(null);
    setOriginalSavedCard(null);
  };

  const handleStrollDataFetched = async (
    card: ExpandedCardData,
    strollData: ExpandedCardData["strollData"]
  ) => {
    // Persist stroll data to the appropriate table based on source
    if (!user?.id || !strollData || !originalSavedCard) return;

    const source: "solo" | "collaboration" = originalSavedCard.source;
    try {
      await savedCardsService.updateCardStrollData(
        user.id,
        card,
        strollData,
        source,
        originalSavedCard.sessionId || undefined
      );

      // Invalidate queries to refresh the saved cards list
      queryClient.invalidateQueries({
        queryKey: ["savedCards", user.id],
      });
      if (originalSavedCard.sessionId) {
        queryClient.invalidateQueries({
          queryKey: ["boardSavedCards", originalSavedCard.sessionId],
        });
      }
    } catch (error) {
      console.error("Error persisting stroll data:", error);
      // Don't show error to user - data is still in modal state
    }
  };

  const handleModalSave = async (card: ExpandedCardData) => {
    // Card is already saved, just close the modal
    handleCloseModal();
  };

  const handleModalPurchase = (card: ExpandedCardData, bookingOption: any) => {
    handleCloseModal();
    onPurchaseFromSaved(card as any, bookingOption);
  };

  const handleModalShare = (card: ExpandedCardData) => {
    handleCloseModal();
    onShareCard(card as any);
  };

  const handleCloseProposeDateTimeModal = () => {
    setShowProposeDateTimeModal(false);
    setCardToSchedule(null);
  };

  const handleRemoveSaved = async (card: SavedCard) => {
    if (!user?.id) return;

    setRemovingCardIds((prev) => new Set(prev).add(card.id));
    try {
      await savedCardsService.removeCard(
        user.id,
        card.id,
        card.source,
        card.sessionId || undefined
      );

      // Invalidate savedCards query to trigger a refetch (for solo mode)
      queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });

      // If this is a board card, invalidate the board saved cards query
      if (boardSavedCards !== undefined && activeBoardSessionId) {
        queryClient.invalidateQueries({
          queryKey: ["boardSavedCards", activeBoardSessionId],
        });
      }
    } catch (error) {
      console.error("Error removing saved card:", error);
    } finally {
      setRemovingCardIds((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    }
  };

  const renderCard = ({ item: card }: { item: SavedCard }) => {
    const isScheduled = scheduledCardIdsSet.has(card.id);
    const isRemoving = removingCardIds.has(card.id);

    // Check if place is currently open
    const isPlaceOpen =
      ((card as any).openingHours as { open_now?: boolean })?.open_now ?? true;

    // Check if openingHours data is available
    const hasOpeningHoursData =
      (card as any).openingHours &&
      typeof (card as any).openingHours === "object" &&
      (card as any).openingHours !== null &&
      "open_now" in (card as any).openingHours;

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
              <View style={styles.scheduleButtonContainer}>
                <TouchableOpacity
                  onPress={() => handleSchedule(card)}
                  style={[
                    styles.primaryButton,
                    (schedulingCardId === card.id ||
                      isScheduled ||
                      !isPlaceOpen) &&
                      styles.primaryButtonDisabled,
                  ]}
                  disabled={
                    schedulingCardId === card.id || isScheduled || !isPlaceOpen
                  }
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
                {!isPlaceOpen && (
                  <Text style={styles.closedMessage}>
                    This place is currently closed
                  </Text>
                )}
                {/*    {!hasOpeningHoursData && (
                  <Text style={styles.warningMessage}>
                    Opening hours not available - schedule at your own risk
                  </Text>
                )} */}
              </View>
            )}

            <TouchableOpacity
              onPress={() => onShareCard(card)}
              style={styles.shareButton}
            >
              <Ionicons name="share-social-outline" size={18} color="#374151" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleRemoveSaved(card)}
              style={styles.deleteButton}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Ionicons name="trash-outline" size={18} color="#ef4444" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderEmptyComponent = () => {
    if (effectiveIsLoading) {
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
      {/* Date/Time Picker Modal */}
      {/* Propose Date & Time Modal */}
      <ProposeDateTimeModal
        visible={showProposeDateTimeModal}
        onClose={handleCloseProposeDateTimeModal}
        card={cardToSchedule}
        currentScheduledDate={cardToSchedule?.dateAdded}
        onProposeDateTime={handleProposeDateTime}
      />

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
          onSave={handleModalSave}
          onPurchase={handleModalPurchase}
          onShare={handleModalShare}
          userPreferences={userPreferences}
          onStrollDataFetched={handleStrollDataFetched}
        />
      )}
    </View>
  );
};

export default SavedTab;
