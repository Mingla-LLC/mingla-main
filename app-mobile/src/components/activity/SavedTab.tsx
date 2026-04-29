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
import { Icon } from "../ui/Icon";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import ExpandedCardModal from "../ExpandedCardModal";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { mixpanelService } from "../../services/mixpanelService";
import { logAppsFlyerEvent } from "../../services/appsFlyerService";
import { recordCardExpand } from "../../services/cardEngagementService";
import { useSavedCards } from "@/src/hooks/useSavedCards";
import { useAppStore } from "../../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { savedCardKeys } from "../../hooks/queryKeys";
import { CalendarService } from "../../services/calendarService";
import { savedCardsService } from "../../services/savedCardsService";
import { toastManager } from "../ui/Toast";
import { getUserLocale } from "../../utils/localeUtils";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import ProposeDateTimeModal from "./ProposeDateTimeModal"; // dark bottom sheet
import { formatPriceRange, formatCurrency, getCurrencySymbol, getCurrencyRate } from "../utils/formatters";
import { PriceTierSlug, TIER_BY_SLUG, formatTierLabel } from '../../constants/priceTiers';
import { HapticFeedback } from "../../utils/hapticFeedback";
import type { CuratedStop } from "../../types/curatedExperience";
import { isPlaceOpenNow, isPlaceOpenAt, extractWeekdayText } from "../../utils/openingHoursUtils";
import { getReadableCategoryName } from "../../utils/categoryUtils";
import { CardFilterBar, WhenFilter } from './CardFilterBar';
import { useFeatureGate } from "../../hooks/useFeatureGate";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import type { GatedFeature } from "../../hooks/useFeatureGate";
import { useKeyboard } from "../../hooks/useKeyboard";
import { useTranslation } from 'react-i18next';

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

  openingHours?: Record<string, string>;
  lat: number;
  lng: number;
}

interface SavedTabProps {
  savedCards?: SavedCard[];
  calendarEntries?: any[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
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
  savedCards: propSavedCards,
  calendarEntries = [],
  isLoading = false,
  isError = false,
  onRetry,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
  userPreferences,
  accountPreferences,
  scheduledCardIds = [],
  boardSavedCards,
  activeBoardSessionId,
}: SavedTabProps) => {
  const { t } = useTranslation(['activity', 'common']);
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  // savedCards and calendarEntries now come via props from the parent chain.
  // No more useAppState() call — eliminates duplicate auth/realtime/query instances.
  const effectiveIsLoading = isLoading;
  const savedCards = boardSavedCards ?? propSavedCards ?? [];

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWhen, setSelectedWhen] = useState<WhenFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAppStore();
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user?.id ?? '') });
    setIsRefreshing(false);
  }, [queryClient, user?.id]);

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
      if (selectedCategory === 'all') return true;
      return card.category === selectedCategory;
    };

    const matchesTier = (card: SavedCard) => {
      if (selectedTier === 'all') return true;
      return (card as any).priceTier === selectedTier;
    };

    const applyAllFilters = (card: SavedCard) =>
      matchesSearch(card) &&
      matchesWhen(card) &&
      matchesCategory(card) &&
      matchesTier(card);

    return savedCards.filter(applyAllFilters);
  }, [
    savedCards,
    searchQuery,
    selectedWhen,
    selectedCategory,
    selectedTier,
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
    experienceCard: {
      backgroundColor: "rgba(255, 255, 255, 0.06)",
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
      backgroundColor: "rgba(255, 255, 255, 0.08)",
    },
    cardInfo: {
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: "#FFFFFF",
      marginBottom: 4,
    },
    cardSubtitle: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
      flexShrink: 1,
    },
    cardTitleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    cardTitleTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    cardSubtitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: 4,
      minWidth: 0,
    },
    recentlySavedWrap: {
      alignItems: "flex-end",
      flexShrink: 0,
      marginLeft: 8,
    },
    recentlySavedText: {
      fontSize: 12,
      color: "rgba(255, 255, 255, 0.55)",
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
      flex: 1,
      minWidth: 0,
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
      color: "rgba(255, 255, 255, 0.72)",
    },
    priceText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#eb7825",
      flexShrink: 1,
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
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.12)", // Light gray border
      alignItems: "center",
      justifyContent: "center",
    },
    deleteButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderWidth: 0.5,
      borderColor: "#ef4444", // Red border
      alignItems: "center",
      justifyContent: "center",
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
      backgroundColor: "rgba(255, 255, 255, 0.04)",
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
      backgroundColor: "rgba(255, 255, 255, 0.06)",
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
      color: "#FFFFFF",
      marginBottom: 8,
    },
    sectionText: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
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
      color: "rgba(255, 255, 255, 0.72)",
      flex: 1,
    },
    socialStatsContainer: {
      gap: 8,
    },
    socialStatsTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#FFFFFF",
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
      color: "rgba(255, 255, 255, 0.72)",
    },
    emptyState: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 16,
      marginVertical: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: "rgba(235, 120, 37, 0.08)",
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
      color: "#FFFFFF",
      marginBottom: 2,
    },
    emptyStateSubtitle: {
      fontSize: 13,
      color: "rgba(255, 255, 255, 0.55)",
      lineHeight: 18,
    },
    clearFiltersButton: {
      marginTop: 12,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: '#fff7ed',
    },
    clearFiltersText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#eb7825',
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
      color: "rgba(255, 255, 255, 0.72)",
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
      backgroundColor: "rgba(255, 255, 255, 0.06)",
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
      borderBottomColor: "rgba(255, 255, 255, 0.12)",
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#FFFFFF",
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
      color: "rgba(255, 255, 255, 0.72)",
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
    retryPill: {
      backgroundColor: "#eb7825",
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      marginLeft: 8,
    },
    retryPillText: {
      color: "#ffffff",
      fontSize: 13,
      fontWeight: "600",
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

    // Hours validation moved to handleProposeDateTime — checks selected time, not current time

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
    const dayName = arrivalTime.toLocaleDateString(getUserLocale(), { weekday: 'long' });
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
    // Gate: curated card schedule requires Mingla+
    if (!canAccess('curated_cards')) {
      setPaywallFeature('curated_cards');
      setShowPaywall(true);
      return;
    }

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
        const timeStr = date.toLocaleString(getUserLocale(), {
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
      // Regular card — check if place is open at selected time
      const weekdayText = extractWeekdayText(cardToSchedule?.openingHours);
      const openAtSelectedTime = isPlaceOpenAt(weekdayText, date);
      if (openAtSelectedTime === false) {
        Alert.alert(
          "Place Closed",
          "This place appears to be closed at the time you selected. Choose a different time or schedule anyway.",
          [
            { text: "Change Time", style: "cancel" },
            { text: "Schedule Anyway", onPress: () => proceedWithScheduling(date) },
          ]
        );
        return;
      }
      proceedWithScheduling(date);
    }
  };

  const proceedWithScheduling = async (scheduledDateTime: Date) => {
    if (!cardToSchedule || !user?.id) {
      Alert.alert(t('activity:savedTab.errorGeneric'), t('activity:savedTab.scheduleErrorLogin'));
      setSchedulingCardId(null);
      setCardToSchedule(null);
      return;
    }

    console.log("cardToSchedule", cardToSchedule.lat);
    console.log("cardToSchedule", cardToSchedule.lng);

    try {
      if (isNaN(scheduledDateTime.getTime())) {
        Alert.alert(t('activity:savedTab.invalidDate'), t('activity:savedTab.invalidDateMsg'));
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
        queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });
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
        images: cardToSchedule.images?.length ? cardToSchedule.images : [cardToSchedule.image].filter(Boolean),
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
        const deviceEventId = await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
        // Store the device calendar event ID for future reschedule/unschedule
        if (deviceEventId && record?.id) {
          CalendarService.updateEntry(record.id, user.id, {
            device_calendar_event_id: deviceEventId,
          }).catch((err) => console.warn('Failed to store device calendar event ID:', err));
        }
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
      logAppsFlyerEvent('experience_scheduled', {
        af_content_type: cardToSchedule.category,
        af_date: scheduledDateISO,
        source,
        af_content_id: cardToSchedule.id,
      });

      // Show success toast
      toastManager.success(
        t('activity:savedTab.scheduledToast', { title: cardToSchedule.title }),
        3000
      );

      // Call the original handler if provided (for any additional logic)
    } catch (error: any) {
      console.error("[SavedTab] Scheduling error:", error);
      const detail = __DEV__ && error?.message ? `\n\nDEV: ${error.message}` : "";
      Alert.alert(
        t('activity:savedTab.scheduleFailed'),
        `${t('activity:savedTab.scheduleFailedMsg')}${detail}`,
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
      images: card.images?.length ? card.images : [card.image].filter(Boolean),
      rating: card.rating || 4.5,
      reviewCount: card.reviewCount || 0,
      // [ORCH-0649 — INVARIANT I-NO-FABRICATED-DISPLAY-N/A]
      // Pass undefined (not literal "N/A") so the renderer's truthy guard
      // hides the pill. Constitution #9 forbids fabricated display values.
      priceRange: card.priceRange || undefined,
      distance: (card as any).distance || "",
      travelTime: card.travelTime || undefined,
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
      priceTier: card.priceTier as ExpandedCardData['priceTier'],
      location:
        (card as any).location ||
        ((card as any).lat && (card as any).lng
          ? { lat: (card as any).lat, lng: (card as any).lng }
          : undefined),
      // [ORCH-0649] Must be a real Date or undefined — never the string "N/A".
      selectedDateTime: (card as any)?.dateAdded
        ? new Date((card as any).dateAdded)
        : undefined,
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

    // ORCH-0408 Phase 4: Record expand — counter + user interaction log (fire-and-forget)
    recordCardExpand(card.id, {
      category: card.category,
      priceTier: card.priceTier,
      isCurated: (card as any).cardType === 'curated',
    });

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
        queryKey: savedCardKeys.list(user.id),
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
        queryKey: savedCardKeys.list(user.id),
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
      mixpanelService.trackExperienceUnsaved({
        card_id: card.id,
        card_title: card.title ?? '',
        category: card.category ?? '',
      });

      // Invalidate savedCards query to trigger a refetch (for solo mode)
      queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });

      // If this is a board card, invalidate the board saved cards query
      if (boardSavedCards !== undefined && activeBoardSessionId) {
        queryClient.invalidateQueries({
          queryKey: ["boardSavedCards", activeBoardSessionId],
        });
      }
    } catch (error) {
      console.error("Error removing saved card:", error);
      toastManager.error(t('activity:savedTab.couldntRemove'), 3000);
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

    // Curated cards are viewable by all tiers — save-gating is handled at save time

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
    const rawType = (card as any).experienceType || 'adventurous';
    const experienceLabel = t(`common:intent_${rawType.replace(/-/g, '_')}`);

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
              <Icon name="map-outline" size={12} color="#F59E0B" />
              <Text style={curatedSavedStyles.typeBadgeText}>{experienceLabel}</Text>
            </View>
            <View style={curatedSavedStyles.stopCountBadge}>
              <Text style={curatedSavedStyles.stopCountText}>{stops.length} Stops</Text>
            </View>
          </View>

          {/* Title: experience title, fallback to stop names */}
          <Text style={curatedSavedStyles.title} numberOfLines={2}>
            {card.title?.trim() || stops.map(s => s.placeName).join(' → ')}
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
              <Icon name="star" size={13} color="white" />
              <Text style={curatedSavedStyles.statText}>{avgRating} avg</Text>
            </View>
            <Text style={curatedSavedStyles.statDot}>·</Text>
            <View style={curatedSavedStyles.statItem}>
              <Icon name="time-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={curatedSavedStyles.statText}>{durationLabel}</Text>
            </View>
            <Text style={curatedSavedStyles.statDot}>·</Text>
            <View style={curatedSavedStyles.statItem}>
              <Icon name="cash-outline" size={13} color="rgba(255,255,255,0.6)" />
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
                <Icon name="calendar" size={16} color="#1C1C1E" />
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
            <Icon name="share-social-outline" size={18} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleRemoveSaved(card)}
            style={curatedSavedStyles.iconButton}
            disabled={isRemoving}
          >
            {isRemoving ? (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
            ) : (
              <Icon name="trash-outline" size={18} color="rgba(255,255,255,0.7)" />
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
              <View style={styles.cardTitleRow}>
                <View style={styles.cardTitleTextWrap}>
                  <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">{card.title}</Text>
                  {/* Subtitle - use category or a default subtitle */}
                  <View style={styles.cardSubtitleRow}>
                    <Icon name="heart" size={16} color="orange" />
                    <Text style={styles.cardSubtitle} numberOfLines={1} ellipsizeMode="tail">
                      {(card as any).subtitle || getReadableCategoryName(card.category) || "Experience"}
                    </Text>
                  </View>
                </View>
                <View style={styles.recentlySavedWrap}>
                  <Text style={styles.recentlySavedText} numberOfLines={1}>{t('activity:savedTab.recentlySaved')}</Text>
                </View>
              </View>

              {/* Stats row: Rating, Duration, Price, Chevron */}
              <View style={styles.cardMeta}>
                <View style={styles.cardStats}>
                  {card.rating != null && Number(card.rating) > 0 && (
                    <View style={styles.statItem}>
                      <Icon name="star" size={14} color="#fbbf24" />
                      <Text style={styles.statText}>{Number(card.rating).toFixed(1)}</Text>
                    </View>
                  )}
                  {card.travelTime && card.travelTime !== '0 min' && (
                    <View style={styles.statItem}>
                      <Icon name={getTravelModeIcon((card as any).travelMode)} size={14} color="#6b7280" />
                      <Text style={styles.statText}>
                        {card.travelTime}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.priceText} numberOfLines={1} ellipsizeMode="tail">
                    {card.priceTier && TIER_BY_SLUG[card.priceTier as PriceTierSlug]
                      ? formatTierLabel(card.priceTier as PriceTierSlug, getCurrencySymbol(accountPreferences?.currency || "USD"), getCurrencyRate(accountPreferences?.currency || "USD"))
                      : card.priceRange ? formatPriceRange(card.priceRange, accountPreferences?.currency || "USD") : 'Varies'}
                  </Text>
                </View>
                <Icon name="chevron-forward" size={16} color="#9ca3af" />
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
                      ? t('activity:savedTab.soloDiscovery')
                      : t('activity:savedTab.fromSession', { name: card.sessionName })}
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
                <Icon name="bag" size={16} color="white" />
                <Text style={styles.primaryButtonText}>{t('activity:savedTab.buyNow')}</Text>
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
                      <Icon name="calendar" size={16} color="white" />
                      <Text style={styles.primaryButtonText}>
                        {isScheduled ? t('activity:savedTab.scheduled') : t('activity:savedTab.schedule')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                {!isPlaceOpen && (
                  <Text style={styles.closedMessage}>
                    {t('activity:savedTab.placeClosed')}
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              onPress={() => onShareCard(card)}
              style={styles.shareButton}
            >
              <Icon name="share-social-outline" size={18} color="#374151" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleRemoveSaved(card)}
              style={styles.deleteButton}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Icon name="trash-outline" size={18} color="#ef4444" />
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
          <Text style={styles.loadingText}>{t('activity:savedTab.loadingSaved')}</Text>
        </View>
      );
    }

    if (isError && !effectiveIsLoading) {
      return (
        <View style={styles.emptyState}>
          <View style={[styles.emptyStateIconCircle, { backgroundColor: '#fef2f2' }]}>
            <Icon name="alert-circle-outline" size={22} color="#ef4444" />
          </View>
          <View style={styles.emptyStateTextContainer}>
            <Text style={styles.emptyStateTitle}>{t('activity:savedTab.errorTitle')}</Text>
            <Text style={styles.emptyStateSubtitle}>
              {t('activity:savedTab.errorSubtitle')}
            </Text>
          </View>
          {onRetry && (
            <TouchableOpacity onPress={onRetry} style={styles.retryPill} activeOpacity={0.7}>
              <Text style={styles.retryPillText}>{t('activity:savedTab.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    // Filters active but no matches — different from truly empty
    if (savedCards.length > 0) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyStateIconCircle}>
            <Icon name="filter-outline" size={22} color="#9ca3af" />
          </View>
          <View style={styles.emptyStateTextContainer}>
            <Text style={styles.emptyStateTitle}>{t('activity:savedTab.noMatchesTitle')}</Text>
            <Text style={styles.emptyStateSubtitle}>
              {t('activity:savedTab.noMatchesSubtitle')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={() => {
              setSearchQuery('');
              setSelectedWhen('all');
              setSelectedCategory('all');
              setSelectedTier('all');
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.clearFiltersText}>{t('activity:savedTab.clearFilters')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Truly empty — no saved cards at all
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyStateIconCircle}>
          <Icon name="heart-outline" size={22} color="#eb7825" />
        </View>
        <View style={styles.emptyStateTextContainer}>
          <Text style={styles.emptyStateTitle}>{t('activity:savedTab.emptyTitle')}</Text>
          <Text style={styles.emptyStateSubtitle}>
            {t('activity:savedTab.emptySubtitle')}
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
          style={{
            opacity: searchBarOpacity,
            transform: [{ translateY: searchBarSlide }],
          }}
        >
          <CardFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedWhen={selectedWhen}
            onWhenChange={setSelectedWhen}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            selectedTier={selectedTier}
            onTierChange={setSelectedTier}
          />
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
          canAccessCurated={canAccess('curated_cards')}
          onPaywallRequired={() => {
            handleCloseModal();
            setPaywallFeature('curated_cards');
            setShowPaywall(true);
          }}
        />
      )}

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
      />
    </View>
  );
};

export default SavedTab;
