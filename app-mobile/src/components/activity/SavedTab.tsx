import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  RefreshControl,
} from "react-native";

const ANIMATION_DURATION = 250;
import { Feather, Ionicons } from "@expo/vector-icons";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import ExpandedCardModal from "../ExpandedCardModal";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { mixpanelService } from "../../services/mixpanelService";
import { useSavedCards } from "@/src/hooks/useSavedCards";
import { useAppStore } from "../../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { useAppState } from "../AppStateManager";
import { CalendarService } from "../../services/calendarService";
import { savedCardsService } from "../../services/savedCardsService";
import { toastManager } from "../ui/Toast";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import ProposeDateTimeModal from "./ProposeDateTimeModal"; // dark bottom sheet
import { formatPriceRange, formatCurrency, getCurrencySymbol, getCurrencyRate } from "../utils/formatters";
import { PriceTierSlug, TIER_BY_SLUG, formatTierLabel } from '../../constants/priceTiers';
import { HapticFeedback } from "../../utils/hapticFeedback";
import type { CuratedStop } from "../../types/curatedExperience";
import { isPlaceOpenNow, extractWeekdayText } from "../../utils/openingHoursUtils";
import { useFeatureGate } from "../../hooks/useFeatureGate";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import type { GatedFeature } from "../../hooks/useFeatureGate";
import { useKeyboard } from "../../hooks/useKeyboard";

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
  priceTier?: string;
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
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const {
    savedCards: contextSavedCards,
    isLoadingSavedCards: contextIsLoadingSavedCards,
    calendarEntries,
  } = useAppState();
  const effectiveIsLoading = isLoading || contextIsLoadingSavedCards;
  // Use boardSavedCards if provided, otherwise use savedCards from context
  const savedCards = boardSavedCards ?? contextSavedCards;

  // Feature gating for locked curated cards
  const { canAccess } = useFeatureGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('curated_cards');
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAppStore();
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["savedCards", user?.id] });
    setIsRefreshing(false);
  }, [queryClient]);

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

  // Run card pop animations when filtered cards change
  useEffect(() => {
    filteredCards.forEach((card, index) => {
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
  }, [filteredCards.length]);

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
      backgroundColor: "#FFFFFF",
      borderRadius: 12,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: "#f0f0f0",
      elevation: 1,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
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
      borderColor: "#f0f0f0",
      backgroundColor: "#FFFFFF",
      elevation: 1,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
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
      backgroundColor: "#FFFFFF",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: "#f0f0f0",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
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
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 16,
      marginVertical: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: "#fffbf5",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#f5e6d3",
    },
    emptyStateIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#fef3e2",
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    emptyStateTextContainer: {
      flex: 1,
    },
    emptyStateTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 2,
    },
    emptyStateSubtitle: {
      fontSize: 13,
      color: "#9ca3af",
      lineHeight: 18,
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

  const curatedSavedStyles = StyleSheet.create({
    card: {
      backgroundColor: '#1C1C1E',
      borderRadius: 16,
      marginBottom: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
    },
    imageStrip: {
      flexDirection: 'row',
      height: 100,
    },
    imageContainer: {
      flex: 1,
      position: 'relative',
    },
    stopImage: {
      width: '100%',
      height: '100%',
    },
    stopBadge: {
      position: 'absolute',
      bottom: 6,
      left: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#F59E0B',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stopBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#1C1C1E',
    },
    content: {
      padding: 14,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    typeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(245,158,11,0.12)',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    typeBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#F59E0B',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    stopCountBadge: {
      backgroundColor: 'rgba(255,255,255,0.08)',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    stopCountText: {
      fontSize: 11,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.5)',
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: '#ffffff',
      marginBottom: 4,
      lineHeight: 22,
    },
    tagline: {
      fontSize: 13,
      color: 'rgba(255,255,255,0.5)',
      fontStyle: 'italic',
      marginBottom: 10,
    },
    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    statItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    statText: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.6)',
      fontWeight: '500',
    },
    statDot: {
      color: 'rgba(255,255,255,0.3)',
      marginHorizontal: 6,
      fontSize: 12,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingBottom: 14,
      gap: 10,
    },
    scheduleButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: '#F59E0B',
      paddingVertical: 10,
      borderRadius: 10,
    },
    scheduleButtonDisabled: {
      backgroundColor: 'rgba(245,158,11,0.4)',
    },
    scheduleButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#1C1C1E',
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.06)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    lockedCardOverflow: {
      overflow: 'hidden',
    },
    lockedBody: {
      backgroundColor: '#1C1C1E',
      padding: 24,
      alignItems: 'center',
      gap: 12,
    },
    lockedTeaserText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
      textAlign: 'center',
    },
    lockedSubtext: {
      color: '#9CA3AF',
      fontSize: 12,
      textAlign: 'center',
    },
    lockedUpgradeButton: {
      backgroundColor: '#f97316',
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 10,
      marginTop: 4,
    },
    lockedUpgradeText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    lockedRemoveButton: {
      marginTop: 4,
    },
    lockedRemoveText: {
      color: '#6B7280',
      fontSize: 12,
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
    HapticFeedback.success();
    if (scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id)) {
      return;
    }

    // Check if place is open using live client-side time computation
    const liveStatus = isPlaceOpenNow(extractWeekdayText(card.openingHours));
    if (liveStatus === false) {
      Alert.alert(
        "Place Closed",
        "This place is currently closed. Please schedule for when it's open."
      );
      return;
    }

    // Close expanded card modal if open (prevents Modal stacking conflicts)
    if (isModalVisible) {
      setIsModalVisible(false);
      setSelectedCardForModal(null);
    }

    // Show the propose date/time modal
    setCardToSchedule(card);
    setShowProposeDateTimeModal(true);
  };

  // ---- Opening Hours Validation for Curated Plans ----

  interface StopAvailability {
    stopName: string;
    isOpen: boolean;
    reason?: string;
  }

  const to24Hour = (hour: number, ampm: string): number => {
    const isPM = ampm.toUpperCase() === 'PM';
    if (hour === 12) return isPM ? 12 : 0;
    return isPM ? hour + 12 : hour;
  };

  const checkSingleStopOpen = (
    stop: CuratedStop,
    arrivalTime: Date
  ): StopAvailability => {
    const dayName = arrivalTime.toLocaleDateString('en-US', { weekday: 'long' });
    const hoursString = stop.openingHours?.[dayName];

    // No hours data — assume open
    if (!hoursString) {
      return { stopName: stop.placeName, isOpen: true };
    }

    // Explicitly closed
    if (hoursString.toLowerCase().includes('closed')) {
      return {
        stopName: stop.placeName,
        isOpen: false,
        reason: `Closed on ${dayName}s`,
      };
    }

    // Open 24 hours
    if (hoursString.toLowerCase().includes('24 hours') || hoursString.toLowerCase().includes('open 24')) {
      return { stopName: stop.placeName, isOpen: true };
    }

    // Parse "9:00 AM – 5:00 PM" or "9 AM – 5 PM" format
    const match = hoursString.match(
      /(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*[–\-]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)/i
    );
    if (!match) {
      // Can't parse — assume open
      return { stopName: stop.placeName, isOpen: true };
    }

    const openHour = to24Hour(parseInt(match[1]), match[3]);
    const openMinute = parseInt(match[2] || '0');
    const closeHour = to24Hour(parseInt(match[4]), match[6]);
    const closeMinute = parseInt(match[5] || '0');

    const arrivalHour = arrivalTime.getHours();
    const arrivalMinute = arrivalTime.getMinutes();
    const arrivalTotal = arrivalHour * 60 + arrivalMinute;
    const openTotal = openHour * 60 + openMinute;
    const closeTotal = closeHour * 60 + closeMinute;

    if (arrivalTotal < openTotal) {
      const openTimeStr = `${match[1]}:${match[2] || '00'} ${match[3]}`;
      return {
        stopName: stop.placeName,
        isOpen: false,
        reason: `Opens at ${openTimeStr}`,
      };
    }

    if (arrivalTotal >= closeTotal && closeTotal > openTotal) {
      const closeTimeStr = `${match[4]}:${match[5] || '00'} ${match[6]}`;
      return {
        stopName: stop.placeName,
        isOpen: false,
        reason: `Closes at ${closeTimeStr}`,
      };
    }

    return { stopName: stop.placeName, isOpen: true };
  };

  const checkAllStopsOpen = (
    stops: CuratedStop[],
    startTime: Date
  ): { allOpen: boolean; results: StopAvailability[] } => {
    let cumulativeMinutes = 0;

    const results: StopAvailability[] = stops.map((stop, idx) => {
      // Calculate estimated arrival time at this stop
      const arrivalTime = new Date(startTime.getTime() + cumulativeMinutes * 60000);
      const availability = checkSingleStopOpen(stop, arrivalTime);

      // Add this stop's duration + next stop's travel time
      cumulativeMinutes += (stop.estimatedDurationMinutes ?? 45);
      if (idx < stops.length - 1 && stops[idx + 1]?.travelTimeFromPreviousStopMin) {
        cumulativeMinutes += stops[idx + 1].travelTimeFromPreviousStopMin!;
      }

      return availability;
    });

    return {
      allOpen: results.every(r => r.isOpen),
      results,
    };
  };

  const handleScheduleCurated = (card: SavedCard) => {
    HapticFeedback.success();
    if (scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id)) return;

    // Close expanded card modal if open (prevents Modal stacking conflicts)
    if (isModalVisible) {
      setIsModalVisible(false);
      setSelectedCardForModal(null);
    }

    // Open the date/time picker modal
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

    // Check if this is a curated card with stops
    const isCurated = cardToSchedule
      && Array.isArray((cardToSchedule as any).stops)
      && (cardToSchedule as any).stops.length > 0;

    if (isCurated) {
      const stops = (cardToSchedule as any).stops as CuratedStop[];
      const { allOpen, results } = checkAllStopsOpen(stops, date);

      if (allOpen) {
        // All stops are open — ask for confirmation
        const timeStr = date.toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        Alert.alert(
          'All Stops Are Open!',
          `All ${stops.length} stops are open at ${timeStr}.\n\nWould you like to schedule this plan and add it to your calendar?`,
          [
            { text: 'Not Now', style: 'cancel', onPress: () => setCardToSchedule(null) },
            { text: 'Schedule', onPress: () => proceedWithScheduling(date) },
          ]
        );
      } else {
        // Some stops are closed — show which ones and why
        const closedStops = results.filter(r => !r.isOpen);
        const closedList = closedStops
          .map(s => `  \u2022 ${s.stopName} \u2014 ${s.reason}`)
          .join('\n');

        Alert.alert(
          'Some Stops Are Closed',
          `Not all activities are open at the time you selected:\n\n${closedList}\n\nPlease choose a different time when all stops are available.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setCardToSchedule(null) },
            {
              text: 'Choose New Time',
              onPress: () => {
                // Reopen the date/time picker
                setShowProposeDateTimeModal(true);
              },
            },
          ]
        );
      }
    } else {
      // Regular card — proceed immediately (existing behavior)
      proceedWithScheduling(date);
    }
  };

  const proceedWithScheduling = async (scheduledDateTime: Date) => {
    if (!cardToSchedule || !user?.id) {
      Alert.alert("Error", "You must be logged in to schedule cards.");
      setSchedulingCardId(null);
      setCardToSchedule(null);
      return;
    }

    console.log("cardToSchedule", cardToSchedule.lat);
    console.log("cardToSchedule", cardToSchedule.lng);

    try {
      if (isNaN(scheduledDateTime.getTime())) {
        Alert.alert("Invalid Date", "The selected date is not valid. Please try again.");
        setSchedulingCardId(null);
        setCardToSchedule(null);
        return;
      }
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
      const isCurated = Array.isArray((cardToSchedule as any).stops)
        && (cardToSchedule as any).stops.length > 0;

      const cardData: ExpandedCardData = {
        id: cardToSchedule.id,
        placeId: (cardToSchedule as any).placeId ?? cardToSchedule.id,
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
        priceRange: cardToSchedule.priceRange || "Varies",
        distance: (cardToSchedule as any).distance || "",
        travelTime: cardToSchedule.travelTime || "15 min",
        address: cardToSchedule.address || "",
        openingHours: cardToSchedule.openingHours,
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
        // Curated fields — pass through if present
        ...(isCurated && {
          cardType: 'curated' as const,
          stops: (cardToSchedule as any).stops,
          tagline: (cardToSchedule as any).tagline,
          pairingKey: (cardToSchedule as any).pairingKey,
          totalPriceMin: (cardToSchedule as any).totalPriceMin,
          totalPriceMax: (cardToSchedule as any).totalPriceMax,
          estimatedDurationMinutes: (cardToSchedule as any).estimatedDurationMinutes,
          experienceType: (cardToSchedule as any).experienceType,
        }),
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
        let deviceEvent;
        if (isCurated) {
          deviceEvent = DeviceCalendarService.createEventFromCuratedCard(
            cardToSchedule,
            scheduledDateTime,
            (cardToSchedule as any).estimatedDurationMinutes || 120
          );
        } else {
          deviceEvent = DeviceCalendarService.createEventFromCard(
            cardData,
            scheduledDateTime,
            record.duration_minutes || 120
          );
        }
        await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
      } catch (deviceCalendarError) {
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Track experience scheduled
      mixpanelService.trackExperienceScheduled({
        cardId: cardToSchedule.id,
        cardTitle: cardToSchedule.title,
        category: cardToSchedule.category,
        source,
        scheduledDate: scheduledDateISO,
      });

      // Show success toast
      toastManager.success(
        `Scheduled! ${cardToSchedule.title} has been moved to your calendar`,
        3000
      );

      // Call the original handler if provided (for any additional logic)
    } catch (error: any) {
      console.error("[SavedTab] Scheduling error:", error);
      const detail = __DEV__ && error?.message ? `\n\nDEV: ${error.message}` : "";
      Alert.alert(
        "Schedule failed",
        `We couldn't add this to your calendar. Please try again.${detail}`,
      );
    } finally {
      setSchedulingCardId(null);
      setCardToSchedule(null);
    }
  };

  const handleCardPress = (card: SavedCard) => {
    HapticFeedback.buttonPress();
    const matchScore = getMatchScore(card);

    // Detect if this is a curated multi-stop card
    const isCurated = Array.isArray((card as any).stops) && (card as any).stops.length > 0;

    const expandedCardData: ExpandedCardData = {
      id: card.id,
      placeId: (card as any).placeId ?? card.id,
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
      openingHours: card.openingHours,
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
      location:
        (card as any).location ||
        ((card as any).lat && (card as any).lng
          ? { lat: (card as any).lat, lng: (card as any).lng }
          : undefined),
      selectedDateTime: (card as any)?.dateAdded
        ? new Date((card as any).dateAdded)
        : "N/A",
      strollData: (card as any).strollData,
      picnicData: (card as any).picnicData,
      website: (card as any).website || undefined,
      phone: (card as any).phone || undefined,
      // Curated fields — pass through if present
      ...(isCurated && {
        cardType: 'curated' as const,
        stops: (card as any).stops,
        tagline: (card as any).tagline,
        pairingKey: (card as any).pairingKey,
        totalPriceMin: (card as any).totalPriceMin,
        totalPriceMax: (card as any).totalPriceMax,
        estimatedDurationMinutes: (card as any).estimatedDurationMinutes,
        experienceType: (card as any).experienceType,
        shoppingList: (card as any).shoppingList,
      }),
    };

    setSelectedCardForModal(expandedCardData);
    setOriginalSavedCard(card);
    setIsModalVisible(true);

    // Track card expanded
    mixpanelService.trackCardExpanded({
      cardId: card.id,
      cardTitle: card.title,
      category: card.category,
      source: "saved",
    });
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
    HapticFeedback.error();

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

  const renderCuratedCard = (card: SavedCard) => {
    const stops = (card as any).stops as CuratedStop[];
    const isRemoving = removingCardIds.has(card.id);

    // Locked curated card — show blurred teaser
    if (!canAccess('curated_cards')) {
      const categoryLabel = (card as any).categoryLabel || (card as any).experienceType || 'Curated';
      const teaserText = (card as any).teaserText || `A ${categoryLabel.toLowerCase()} experience with ${stops?.length ?? 0} curated stops`;
      return (
        <View style={[curatedSavedStyles.card, curatedSavedStyles.lockedCardOverflow]}>
          <View style={curatedSavedStyles.lockedBody}>
            <Ionicons name="lock-closed" size={32} color="rgba(255,255,255,0.5)" />
            <Text style={curatedSavedStyles.lockedTeaserText} numberOfLines={2}>
              {teaserText}
            </Text>
            <Text style={curatedSavedStyles.lockedSubtext}>
              {stops?.length ?? 0} stops · Curated experience
            </Text>
            <TouchableOpacity
              onPress={() => { setPaywallFeature('curated_cards'); setShowPaywall(true); }}
              style={curatedSavedStyles.lockedUpgradeButton}
            >
              <Text style={curatedSavedStyles.lockedUpgradeText}>Unlock with Pro</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleRemoveSaved(card)}
              style={curatedSavedStyles.lockedRemoveButton}
              disabled={isRemoving}
            >
              <Text style={curatedSavedStyles.lockedRemoveText}>{isRemoving ? 'Removing...' : 'Remove'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const isScheduled = scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id);

    // Computed display values
    const avgRating = stops.length > 0
      ? (stops.reduce((sum, st) => sum + st.rating, 0) / stops.length).toFixed(1)
      : '–';
    const totalPriceMin = (card as any).totalPriceMin ?? 0;
    const totalPriceMax = (card as any).totalPriceMax ?? 0;
    const currencyCode = accountPreferences?.currency || 'USD';
    const totalPrice = totalPriceMin === 0 && totalPriceMax === 0
      ? 'Free'
      : `${formatCurrency(totalPriceMin, currencyCode)}–${formatCurrency(totalPriceMax, currencyCode)}`;
    const totalMin = (card as any).estimatedDurationMinutes ?? 0;
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    const durationLabel = hrs > 0
      ? `${hrs}h ${mins > 0 ? `${mins}min` : ''}`
      : `${mins}min`;
    const EXPERIENCE_LABELS: Record<string, string> = {
      'adventurous': 'Adventurous',
      'first-date': 'First Date',
      'romantic': 'Romantic',
      'friendly': 'Friendly',
      'group-fun': 'Group Fun',
      'picnic-dates': 'Picnic Dates',
      'take-a-stroll': 'Take a Stroll',
    };
    const rawType = (card as any).experienceType || 'adventurous';
    const experienceLabel = EXPERIENCE_LABELS[rawType] ?? rawType.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    return (
      <View style={curatedSavedStyles.card}>
        {/* 3-image strip with numbered badges */}
        <View style={curatedSavedStyles.imageStrip}>
          {stops.slice(0, 3).map((stop, idx) => (
            <View key={`${stop.placeId}_${idx}`} style={curatedSavedStyles.imageContainer}>
              <ImageWithFallback
                source={{ uri: stop.imageUrl }}
                alt={stop.placeName}
                style={curatedSavedStyles.stopImage}
              />
              <View style={curatedSavedStyles.stopBadge}>
                <Text style={curatedSavedStyles.stopBadgeText}>{idx + 1}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Tappable content area */}
        <TouchableOpacity
          onPress={() => handleCardPress(card)}
          activeOpacity={0.7}
          style={curatedSavedStyles.content}
        >
          {/* Experience type + stop count badges */}
          <View style={curatedSavedStyles.badgeRow}>
            <View style={curatedSavedStyles.typeBadge}>
              <Ionicons name="map-outline" size={12} color="#F59E0B" />
              <Text style={curatedSavedStyles.typeBadgeText}>{experienceLabel}</Text>
            </View>
            <View style={curatedSavedStyles.stopCountBadge}>
              <Text style={curatedSavedStyles.stopCountText}>{stops.length} Stops</Text>
            </View>
          </View>

          {/* Title: stop names joined with arrows */}
          <Text style={curatedSavedStyles.title} numberOfLines={2}>
            {stops.map(s => s.placeName).join(' → ')}
          </Text>

          {/* Tagline */}
          {(card as any).tagline ? (
            <Text style={curatedSavedStyles.tagline} numberOfLines={1}>
              {(card as any).tagline}
            </Text>
          ) : null}

          {/* Stats row: avg rating, duration, price */}
          <View style={curatedSavedStyles.statsRow}>
            <View style={curatedSavedStyles.statItem}>
              <Ionicons name="star" size={13} color="#F59E0B" />
              <Text style={curatedSavedStyles.statText}>{avgRating} avg</Text>
            </View>
            <Text style={curatedSavedStyles.statDot}>·</Text>
            <View style={curatedSavedStyles.statItem}>
              <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={curatedSavedStyles.statText}>{durationLabel}</Text>
            </View>
            <Text style={curatedSavedStyles.statDot}>·</Text>
            <View style={curatedSavedStyles.statItem}>
              <Ionicons name="cash-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={curatedSavedStyles.statText}>{totalPrice}</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Action buttons */}
        <View style={curatedSavedStyles.actions}>
          <TouchableOpacity
            onPress={() => handleScheduleCurated(card)}
            style={[
              curatedSavedStyles.scheduleButton,
              (isScheduled || schedulingCardId === card.id) && curatedSavedStyles.scheduleButtonDisabled,
            ]}
            disabled={isScheduled || schedulingCardId === card.id}
          >
            {schedulingCardId === card.id ? (
              <ActivityIndicator size="small" color="#1C1C1E" />
            ) : (
              <>
                <Ionicons name="calendar" size={16} color="#1C1C1E" />
                <Text style={curatedSavedStyles.scheduleButtonText}>
                  {isScheduled ? 'Scheduled' : 'Schedule Plan'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onShareCard(card)}
            style={curatedSavedStyles.iconButton}
          >
            <Ionicons name="share-social-outline" size={18} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleRemoveSaved(card)}
            style={curatedSavedStyles.iconButton}
            disabled={isRemoving}
          >
            {isRemoving ? (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
            ) : (
              <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.7)" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCard = ({ item: card }: { item: SavedCard }) => {
    // Curated multi-stop cards get a premium layout
    const isCuratedCard = Array.isArray((card as any).stops) && (card as any).stops.length > 0;
    if (isCuratedCard) {
      return renderCuratedCard(card);
    }

    const isScheduled = scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id);
    const isRemoving = removingCardIds.has(card.id);

    // Check if place is currently open using live client-side time computation
    const liveStatus = isPlaceOpenNow(extractWeekdayText(card.openingHours));
    const isPlaceOpen = liveStatus !== false; // true or null (unknown) → allow scheduling

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
                    {card.priceTier && TIER_BY_SLUG[card.priceTier as PriceTierSlug]
                      ? formatTierLabel(card.priceTier as PriceTierSlug, getCurrencySymbol(accountPreferences?.currency || "USD"), getCurrencyRate(accountPreferences?.currency || "USD"))
                      : card.priceRange ? formatPriceRange(card.priceRange, accountPreferences?.currency || "USD") : 'Varies'}
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
        <View style={styles.emptyStateIconCircle}>
          <Ionicons name="heart-outline" size={22} color="#eb7825" />
        </View>
        <View style={styles.emptyStateTextContainer}>
          <Text style={styles.emptyStateTitle}>Nothing saved yet</Text>
          <Text style={styles.emptyStateSubtitle}>
            Swipe right on something great and it lands here.
          </Text>
        </View>
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
        isCurated={
          !!(
            cardToSchedule &&
            Array.isArray((cardToSchedule as any).stops) &&
            (cardToSchedule as any).stops.length > 0
          )
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#999" />}
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
        {/* Saved Cards List */}
        {filteredCards.length === 0
          ? renderEmptyComponent()
          : filteredCards.map((card) => {
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
        {keyboardHeight > 0 && <View style={{ height: keyboardHeight }} />}
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

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
        initialTier="pro"
      />
    </View>
  );
};

export default SavedTab;
