import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
  Platform,
  Alert,
  TextInput,
  Animated,
} from "react-native";

const ANIMATION_DURATION = 250;
import { Feather, Ionicons } from "@expo/vector-icons";
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
import { formatPriceRange } from "../utils/formatters";

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
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
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
  accountPreferences,
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWhen, setSelectedWhen] = useState<
    "all" | "today" | "this_week" | "this_month" | "upcoming"
  >("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [expandedAccordionItems, setExpandedAccordionItems] = useState<string[]>(["active"]); // Start with Active expanded
  const { user } = useAppStore();
  const queryClient = useQueryClient();

  // Animation refs
  const searchBarOpacity = useRef(new Animated.Value(0)).current;
  const searchBarSlide = useRef(new Animated.Value(30)).current;
  const cardAnimations = useRef<{ [key: string]: { scale: Animated.Value } }>({});

  // Initialize animation for each card
  const getCardAnimation = (cardId: string) => {
    if (!cardAnimations.current[cardId]) {
      cardAnimations.current[cardId] = {
        scale: new Animated.Value(0.8),
      };
    }
    return cardAnimations.current[cardId];
  };

  // Run search bar entrance animation on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(searchBarOpacity, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(searchBarSlide, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Convert scheduledCardIds to Set for O(1) lookups
  const scheduledCardIdsSet = useMemo(
    () => new Set(scheduledCardIds || []),
    [scheduledCardIds]
  );

  // Get set of card IDs that are in calendar entries
  const calendarCardIdsSet = useMemo(() => {
    const ids = new Set<string>();
    calendarEntries?.forEach((entry: any) => {
      if (entry.id) ids.add(entry.id);
      if (entry.experience?.id) ids.add(entry.experience.id);
    });
    return ids;
  }, [calendarEntries]);

  // Apply search and filter controls
  const filteredCards = useMemo(() => {
    const normalize = (value: string | undefined | null) =>
      (value || "").toLowerCase();

    const matchesSearch = (card: SavedCard) => {
      if (!searchQuery.trim()) return true;
      const q = normalize(searchQuery);
      const title = normalize(card.title);
      const category = normalize(card.category || "");
      const sessionName = normalize(card.sessionName || "");
      return (
        title.includes(q) ||
        category.includes(q) ||
        sessionName.includes(q)
      );
    };

    const getDateAdded = (card: SavedCard): Date | null => {
      if (!card.dateAdded) return null;
      try {
        return new Date(card.dateAdded);
      } catch {
        return null;
      }
    };

    const matchesWhen = (card: SavedCard) => {
      if (selectedWhen === "all") return true;
      const dateAdded = getDateAdded(card);
      if (!dateAdded) return false;
      const now = new Date();

      const isSameDay =
        dateAdded.getFullYear() === now.getFullYear() &&
        dateAdded.getMonth() === now.getMonth() &&
        dateAdded.getDate() === now.getDate();

      if (selectedWhen === "today") return isSameDay;

      if (selectedWhen === "this_week") {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        return dateAdded >= startOfWeek && dateAdded < endOfWeek;
      }

      if (selectedWhen === "this_month") {
        return (
          dateAdded.getFullYear() === now.getFullYear() &&
          dateAdded.getMonth() === now.getMonth()
        );
      }

      if (selectedWhen === "upcoming") {
        return dateAdded >= now;
      }

      return true;
    };

    const matchesCategory = (card: SavedCard) => {
      if (selectedCategory === "all") return true;
      const category = card.category || "";
      return category === selectedCategory;
    };

    const applyAllFilters = (card: SavedCard) =>
      matchesSearch(card) &&
      matchesWhen(card) &&
      matchesCategory(card);

    return savedCards.filter(applyAllFilters);
  }, [
    savedCards,
    searchQuery,
    selectedWhen,
    selectedCategory,
  ]);

  // Split filtered cards into active (not scheduled) and archive (scheduled)
  const { activeCards, archiveCards } = useMemo(() => {
    const active: SavedCard[] = [];
    const archive: SavedCard[] = [];

    filteredCards.forEach((card) => {
      // Check if card has been scheduled (exists in calendar entries)
      const isScheduled = calendarCardIdsSet.has(card.id) || scheduledCardIdsSet.has(card.id);
      
      if (isScheduled) {
        archive.push(card);
      } else {
        active.push(card);
      }
    });

    return { activeCards: active, archiveCards: archive };
  }, [filteredCards, calendarCardIdsSet, scheduledCardIdsSet]);

  // Run card pop animations when active cards change
  useEffect(() => {
    activeCards.forEach((card, index) => {
      const animation = getCardAnimation(card.id);
      animation.scale.setValue(0.8);

      setTimeout(() => {
        Animated.spring(animation.scale, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }).start();
      }, index * 60);
    });
  }, [activeCards.length, expandedAccordionItems]);

  // Run card pop animations for archive cards
  useEffect(() => {
    if (expandedAccordionItems.includes("archive")) {
      archiveCards.forEach((card, index) => {
        const animation = getCardAnimation(card.id);
        animation.scale.setValue(0.8);

        setTimeout(() => {
          Animated.spring(animation.scale, {
            toValue: 1,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }).start();
        }, index * 60);
      });
    }
  }, [archiveCards.length, expandedAccordionItems]);

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
    mainScrollContent: {
      paddingBottom: 100,
    },
    listContent: {
      gap: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 62, // Add padding to prevent tab bar from touching last card
    },
    accordionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomColor: "#e5e7eb",
      backgroundColor: "#f3f4f6",
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderRadius: 12,
      marginHorizontal: 16,
      marginBottom: 8,
      elevation: 3,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 3,
    },
    accordionTitleContainer: {
      flexDirection: "row",
      alignItems: "center",
    },
    accordionTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#111827",
    },
    accordionCount: {
      fontSize: 14,
      color: "#6b7280",
      marginLeft: 8,
    },
    accordionContentContainer: {
      backgroundColor: "#f9fafb",
    },
    cardWrapper: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    filterCard: {
      marginHorizontal: 16,
      marginVertical: 5,
      paddingVertical: 8,
    },
    filterHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    searchInputContainer: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "white",
      borderRadius: 12,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      elevation: 5,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: "#111827",
      paddingVertical: 16,
      marginLeft: 3
    },
    filterButton: {
      marginLeft: 12,
      width: 66,
      height: 56,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      borderWidth: 1,
      borderColor: "#e5e7eb",
      backgroundColor: "white",
      elevation: 5,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
    },
    filterSection: {
      marginTop: 12,
    },
    filterLabel: {
      fontSize: 12,
      color: "#6b7280",
      marginBottom: 8,
    },
    filterPillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    filterPill: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: "#f3f4f6",
    },
    filterPillSelected: {
      backgroundColor: "#f97316",
    },
    filterPillText: {
      fontSize: 13,
      color: "#4b5563",
    },
    filterPillTextSelected: {
      color: "white",
      fontWeight: "600",
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
      borderWidth: 0.5,
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
    /*     console.log("card", card.lat);
    console.log("card", card.lng); */
    if (scheduledCardIdsSet.has(card.id)) {
      return;
    }

    // Check if place is open - handle both object and string (legacy) formats
    let parsedHours = (card as any).openingHours;
    if (typeof parsedHours === "string" && parsedHours.trim()) {
      try { parsedHours = JSON.parse(parsedHours); } catch { parsedHours = null; }
    }
    const isPlaceOpen =
      (parsedHours && typeof parsedHours === "object" && parsedHours.open_now === false)
        ? false
        : true;

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

    console.log("cardToSchedule", cardToSchedule.lat);
    console.log("cardToSchedule", cardToSchedule.lng);

    try {
      setSchedulingCardId(cardToSchedule.id);
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
        location: (cardToSchedule as any).location
          ? (cardToSchedule as any).location
          : cardToSchedule.lat && cardToSchedule.lng
          ? { lat: cardToSchedule.lat, lng: cardToSchedule.lng }
          : undefined,
        // Add sessionName if it's a collaboration card
        ...(source === "collaboration" && cardToSchedule.sessionName
          ? { sessionName: cardToSchedule.sessionName }
          : {}),
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
      // Handle location - could be in card.location object or card.lat/lng properties
      location:
        (card as any).location ||
        ((card as any).lat && (card as any).lng
          ? { lat: (card as any).lat, lng: (card as any).lng }
          : undefined),
      selectedDateTime: (card as any)?.dateAdded
        ? new Date((card as any).dateAdded)
        : "N/A",
      // Include strollData and picnicData if available from saved card
      strollData: (card as any).strollData,
      picnicData: (card as any).picnicData, // Include picnicData from saved card
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

  const handlePicnicDataFetched = async (
    card: ExpandedCardData,
    picnicData: ExpandedCardData["picnicData"]
  ) => {
    // Persist picnic data to the appropriate table based on source
    if (!user?.id || !picnicData || !originalSavedCard) return;
    const source: "solo" | "collaboration" = originalSavedCard.source;

    try {
      await savedCardsService.updateCardPicnicData(
        user.id,
        card,
        picnicData,
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
      console.error("Error persisting picnic data:", error);
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

    // Check if place is currently open - handle both object and string (legacy) formats
    let cardHours: any = (card as any).openingHours;
    if (typeof cardHours === "string" && cardHours.trim()) {
      try { cardHours = JSON.parse(cardHours); } catch { cardHours = null; }
    }
    const isPlaceOpen =
      (cardHours && typeof cardHours === "object" && cardHours.open_now === false)
        ? false
        : true;

    // Check if openingHours data is available
    const hasOpeningHoursData =
      cardHours &&
      typeof cardHours === "object" &&
      cardHours !== null &&
      "open_now" in cardHours;

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
                  <View style={{flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 4}}>
                    <Feather name="heart" size={16} color="orange" />
                    <Text style={styles.cardSubtitle}>
                      {(card as any).subtitle || card.category || "Experience"}
                    </Text>
                  </View>
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
                    {formatPriceRange(card.priceRange || "$25-50", accountPreferences?.currency || "USD")}
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

      <ScrollView 
        style={{ flex: 1 }}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Search & Filters */}
        <Animated.View
          style={[
            styles.filterCard,
            {
              opacity: searchBarOpacity,
              transform: [{ translateY: searchBarSlide }],
            },
          ]}
        >
          <View style={styles.filterHeaderRow}>
            <View style={styles.searchInputContainer}>
              <Ionicons
                name="search-outline"
                size={18}
                color="#9ca3af"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name, date, or type..."
                placeholderTextColor="#9ca3af"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <TouchableOpacity
              style={[styles.filterButton, isFiltersExpanded ? { backgroundColor: "#eb7825" } : null]}
              activeOpacity={0.7}
              onPress={() => setIsFiltersExpanded(!isFiltersExpanded)}
            >
              <Feather name="filter" size={16} color={isFiltersExpanded ? "white" : "#9ca3af"} />
              <Ionicons
                name={isFiltersExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={isFiltersExpanded ? "white" : "#9ca3af"}
              />
            </TouchableOpacity>
          </View>

          {isFiltersExpanded && (
            <>
              {/* When */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>When</Text>
                <View style={styles.filterPillRow}>
                  {[
                    { key: "all", label: "All Dates" },
                    { key: "today", label: "Today" },
                    { key: "this_week", label: "This Week" },
                    { key: "this_month", label: "This Month" },
                    { key: "upcoming", label: "Upcoming" },
                  ].map((option) => {
                    const selected = selectedWhen === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.filterPill,
                          selected && styles.filterPillSelected,
                        ]}
                        onPress={() =>
                          setSelectedWhen(option.key as typeof selectedWhen)
                        }
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.filterPillText,
                            selected && styles.filterPillTextSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Category */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Category</Text>
                <View style={styles.filterPillRow}>
                  {[
                    "Take a Stroll",
                    "Sip & Chill",
                    "Casual Eats",
                    "Screen & Relax",
                    "Creative & Hands-On",
                    "Picnics",
                    "Play & Move",
                    "Dining Experiences",
                    "Wellness Dates",
                    "Freestyle",
                  ].map((label) => {
                    const key = label;
                    const selected = selectedCategory === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.filterPill,
                          selected && styles.filterPillSelected,
                        ]}
                        onPress={() =>
                          setSelectedCategory(
                            selected ? "all" : (key as typeof selectedCategory)
                          )
                        }
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.filterPillText,
                            selected && styles.filterPillTextSelected,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </Animated.View>
        {/* Active Section */}
        <TouchableOpacity
          style={[styles.accordionHeader]}
          onPress={() =>
            setExpandedAccordionItems((prev) =>
              prev.includes("active")
                ? prev.filter((i) => i !== "active")
                : [...prev, "active"]
            )
          }
          activeOpacity={0.7}
        >
          <View style={styles.accordionTitleContainer}>
            <Text style={styles.accordionTitle}>Active</Text>
            <Text style={styles.accordionCount}>
              ({activeCards.length})
            </Text>
          </View>
          <Ionicons
            name={
              expandedAccordionItems.includes("active")
                ? "chevron-down"
                : "chevron-forward"
            }
            size={20}
            color="#9ca3af"
          />
        </TouchableOpacity>

        {expandedAccordionItems.includes("active") && (
          <View style={styles.accordionContentContainer}>
            {activeCards.length === 0
              ? renderEmptyComponent()
              : activeCards.map((card) => {
                  const animation = getCardAnimation(card.id);
                  return (
                  <Animated.View
                    key={card.id}
                    style={[
                      styles.cardWrapper,
                      { transform: [{ scale: animation.scale }] },
                    ]}
                  >
                    {renderCard({ item: card })}
                  </Animated.View>
                  );
                })}
          </View>
        )}

        {/* Archive Section */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() =>
            setExpandedAccordionItems((prev) =>
              prev.includes("archive")
                ? prev.filter((i) => i !== "archive")
                : [...prev, "archive"]
            )
          }
          activeOpacity={0.7}
        >
          <View style={styles.accordionTitleContainer}>
            <Text style={styles.accordionTitle}>Archives</Text>
            <Text style={styles.accordionCount}>
              ({archiveCards.length})
            </Text>
          </View>
          <Ionicons
            name={
              expandedAccordionItems.includes("archive")
                ? "chevron-down"
                : "chevron-forward"
            }
            size={20}
            color="#9ca3af"
          />
        </TouchableOpacity>

        {expandedAccordionItems.includes("archive") && (
          <View style={styles.accordionContentContainer}>
            {archiveCards.length === 0
              ? renderEmptyComponent()
              : archiveCards.map((card) => {
                  const animation = getCardAnimation(card.id);
                  return (
                  <Animated.View
                    key={card.id}
                    style={[
                      styles.cardWrapper,
                      { transform: [{ scale: animation.scale }] },
                    ]}
                  >
                    {renderCard({ item: card })}
                  </Animated.View>
                  );
                })}
          </View>
        )}
      </ScrollView>

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
          onPicnicDataFetched={handlePicnicDataFetched}
        />
      )}
    </View>
  );
};

export default SavedTab;
