import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from 'react-i18next';
// ORCH-0436: useCoachMark import removed — map coach mark no longer needed
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  Modal,
  Platform,
  Animated,
  ActivityIndicator,
  AppState,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./ui/Icon";
import * as Haptics from "expo-haptics";
// ORCH-0435 Phase B: DateTimePicker import removed
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatPriceRange, parseAndFormatDistance, getCurrencyRate } from "./utils/formatters";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { Recommendation } from "../contexts/RecommendationsContext";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
// ORCH-0435 Phase B: HolidayExperiencesService import removed (pairing-only)
import { NightOutExperiencesService, NightOutVenue } from "../services/nightOutExperiencesService";
import { useAppStore } from "../store/appStore";
import { useUserLocation } from "../hooks/useUserLocation";
// ORCH-0435 Phase B: useCalendarHolidays import removed (pairing-only)
import { enhancedLocationService } from "../services/enhancedLocationService";
import { PreferencesService } from "../services/preferencesService";
import { mixpanelService } from "../services/mixpanelService";
// ORCH-0435 Phase B: Pairing imports removed — pairing UI now lives on Friends page
import { useFeatureGate, GatedFeature } from "../hooks/useFeatureGate";
import { CustomPaywallScreen } from "./CustomPaywallScreen";
// ORCH-0436: DiscoverMap import removed — map no longer rendered in Near You tab
import { ActivityStatusPicker } from "./map/ActivityStatusPicker";
import { useMapSettings } from "../hooks/useMapSettings";
import { useSavedCards } from "../hooks/useSavedCards";
import { savedCardsService } from "../services/savedCardsService";
import { savedCardKeys } from "../hooks/queryKeys";
// ORCH-0436: useCalendarEntries import removed — only used for map
import { useQueryClient } from '@tanstack/react-query';
// ORCH-0435 Phase B: Person hero cards + custom holiday imports removed

// ORCH-0435 Phase B: Custom holiday storage keys removed

// Storage key for cached discover experiences (refreshes daily)
const DISCOVER_CACHE_KEY = "mingla_discover_cache_v7";
const DISCOVER_DAILY_CACHE_KEY = "mingla_discover_cache_daily_v6";
const DISCOVER_CACHE_MIGRATION_KEY = "mingla_discover_cache_migration";
const DISCOVER_CACHE_MIGRATION_VERSION = "2026-03-15-website-field-v7";

// Storage key for cached night-out venues (refreshes daily)
const NIGHT_OUT_CACHE_KEY = "mingla_night_out_cache";

// ORCH-0435 Phase B: CustomHoliday interface removed

import { SCREEN_WIDTH, s } from "../utils/responsive";
// ORCH-0435 Phase B: computeTravelInfo + getCategoryIcon imports removed (pairing-only)
import { PRICE_TIERS } from '../constants/priceTiers';

const CARD_WIDTH = SCREEN_WIDTH - s(32); // 16px padding on each side
const GRID_CARD_WIDTH = (SCREEN_WIDTH - s(48)) / 2; // 16px padding + 16px gap between cards
const HERO_CARD_WIDTH = (SCREEN_WIDTH - s(44)) / 2; // 16px padding + 12px gap between hero cards
const ANIMATION_DURATION = 400;

// ORCH-0435 Phase B: Holiday helper functions removed

// Category icons mapping (v3 category system)
const categoryIcons: { [key: string]: string } = {
  "Nature & Views": "leaf-outline",
  "Nature": "leaf-outline",
  "First Meet": "chatbubbles-outline",
  "Picnic Park": "basket-outline",
  "Picnic": "basket-outline",
  "Drink": "wine-outline",
  "Casual Eats": "fast-food-outline",
  "Fine Dining": "restaurant-outline",
  "Watch": "film-outline",
  "Live Performance": "musical-notes-outline",
  "Creative & Arts": "color-palette-outline",
  "Play": "game-controller-outline",
  "Wellness": "body-outline",
  "Flowers": "flower-outline",
};

// All experience categories (v3 category system — matches categoryPlaceTypes.ts)
const ALL_CATEGORIES = [
  "Nature & Views",
  "First Meet",
  "Picnic Park",
  "Drink",
  "Casual Eats",
  "Fine Dining",
  "Watch",
  "Live Performance",
  "Creative & Arts",
  "Play",
  "Wellness",
  "Flowers",
];

interface DiscoverCache {
  date: string;
  expiresAt: string | null; // ISO timestamp for 24h expiry (null for legacy entries)
  recommendations: Recommendation[];
  featuredCard: FeaturedCardData | null;
  gridCards: GridCardData[];
  heroCards: FeaturedCardData[];
}

const discoverSessionCache = new Map<string, DiscoverCache>();

// Clear in-memory session cache on module load to ensure fresh state after code updates
discoverSessionCache.clear();

const getDiscoverExactCacheKey = (
  userId: string,
  lat: number | null,
  lng: number | null,
  fingerprint?: string
): string => `${DISCOVER_CACHE_KEY}_${userId}_${lat?.toFixed(2)}_${lng?.toFixed(2)}${fingerprint ? `_${fingerprint}` : ''}`;

const getDiscoverDailyCacheKey = (userId: string, prefsFingerprint?: string): string =>
  `${DISCOVER_DAILY_CACHE_KEY}_${userId}${prefsFingerprint ? `_${prefsFingerprint}` : ''}`;

const US_TIMEZONE = "America/New_York";
const usDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: US_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getUsDateKey = (): string => usDateFormatter.format(new Date());

// ORCH-0435 Phase B: HOLIDAY_CATEGORY_MAP + getCategoriesForHolidayName removed (pairing-only)

// Tab types for Discover screen
export type DiscoverTab = "near-you" | "night-out";

interface DiscoverTabsProps {
  activeTab: DiscoverTab;
  onTabChange: (tab: DiscoverTab) => void;
}


// Featured card data interface
interface FeaturedCardData {
  id: string;
  placeId?: string;
  title: string;
  experienceType: string;
  description: string;
  image: string;
  images?: string[];
  priceRange: string;
  rating: number;
  reviewCount?: number;
  address?: string;
  travelTime?: string;
  distance?: string;
  highlights?: string[];
  tags?: string[];
  location?: { lat: number; lng: number };
  openingHours?: string | { open_now?: boolean; weekday_text?: string[] } | null;
  website?: string | null;
  phone?: string | null;
}

interface FeaturedCardProps {
  card: FeaturedCardData;
  currency?: string;
  measurementSystem?: "Metric" | "Imperial";
  onPress?: () => void;
}

interface GridCardData {
  id: string;
  placeId?: string;
  title: string;
  category: string;
  description: string;
  image: string;
  images?: string[];
  priceRange: string;
  rating: number;
  reviewCount?: number;
  address?: string;
  travelTime?: string;
  distance?: string;
  highlights?: string[];
  tags?: string[];
  location?: { lat: number; lng: number };
  openingHours?: string | { open_now?: boolean; weekday_text?: string[] } | null;
  website?: string | null;
  phone?: string | null;
}

interface GridCardProps {
  card: GridCardData;
  currency?: string;
  onPress?: () => void;
}

// Night Out Card Data Interface
interface NightOutCardData {
  id: string;
  eventName: string;
  artistName: string;
  venueName: string;
  image: string;
  images?: string[];
  price: string;
  priceMin: number | null;
  priceMax: number | null;
  date: string;
  time: string;
  localDate: string;
  location: string;
  tags: string[];
  genre?: string;
  subGenre?: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  ticketUrl: string;
  ticketStatus: string;
  distance?: number;
}

interface NightOutCardProps {
  card: NightOutCardData;
  currency?: string;
  onPress?: () => void;
}

// Filter types
type DateFilter = "any" | "today" | "tomorrow" | "weekend" | "next-week" | "month";
type PriceFilter = "any" | "chill" | "comfy" | "bougie" | "lavish" | "free" | "under-25" | "25-50" | "50-100" | "over-100";
type GenreFilter = "all" | "afrobeats" | "dancehall" | "hiphop-rnb" | "house" | "techno" | "jazz-blues" | "latin-salsa" | "reggae" | "kpop" | "acoustic-indie";

interface NightOutFilters {
  date: DateFilter;
  price: PriceFilter;
  genre: GenreFilter;
}

const GENRE_TO_KEYWORDS: Record<GenreFilter, string[]> = {
  "all":             [],
  "afrobeats":       ["afrobeats", "amapiano"],
  "dancehall":       ["dancehall", "soca"],
  "hiphop-rnb":      ["hip hop", "r&b", "rnb", "hip-hop"],
  "house":           ["house", "deep house", "afro house"],
  "techno":          ["techno", "electronic"],
  "jazz-blues":      ["jazz", "blues"],
  "latin-salsa":     ["latin", "salsa", "reggaeton"],
  "reggae":          ["reggae", "dub"],
  "kpop":            ["kpop", "k-pop"],
  "acoustic-indie":  ["acoustic", "indie"],
};

function getDateRange(filter: DateFilter): { startDate: string; endDate: string } {
  const now = new Date();
  // Ticketmaster requires ISO 8601 WITHOUT milliseconds: YYYY-MM-DDTHH:mm:ssZ
  const toISONoMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(23, 59, 59, 0);
    return copy;
  };

  switch (filter) {
    case "today":
      return { startDate: toISONoMs(now), endDate: toISONoMs(endOfDay(now)) };
    case "tomorrow": {
      const tmrw = new Date(now);
      tmrw.setDate(tmrw.getDate() + 1);
      return { startDate: toISONoMs(startOfDay(tmrw)), endDate: toISONoMs(endOfDay(tmrw)) };
    }
    case "weekend": {
      const dayOfWeek = now.getDay();
      const daysUntilFri = (5 - dayOfWeek + 7) % 7 || 7;
      const friday = new Date(now);
      friday.setDate(friday.getDate() + (dayOfWeek <= 5 && dayOfWeek > 0 ? daysUntilFri : 0));
      friday.setHours(18, 0, 0, 0);
      const sunday = new Date(friday);
      sunday.setDate(sunday.getDate() + 2);
      sunday.setHours(23, 59, 59, 0);
      if (dayOfWeek === 0 || dayOfWeek === 6 || (dayOfWeek === 5 && now.getHours() >= 18)) {
        return { startDate: toISONoMs(now), endDate: toISONoMs(sunday) };
      }
      return { startDate: toISONoMs(friday), endDate: toISONoMs(sunday) };
    }
    case "next-week": {
      const monday = new Date(now);
      monday.setDate(monday.getDate() + (8 - now.getDay()) % 7);
      monday.setHours(0, 0, 0, 0);
      const nextSunday = new Date(monday);
      nextSunday.setDate(nextSunday.getDate() + 6);
      nextSunday.setHours(23, 59, 59, 0);
      return { startDate: toISONoMs(monday), endDate: toISONoMs(nextSunday) };
    }
    case "month":
    case "any":
    default: {
      const monthLater = new Date(now);
      monthLater.setDate(monthLater.getDate() + 30);
      return { startDate: toISONoMs(now), endDate: toISONoMs(monthLater) };
    }
  }
}

interface DiscoverScreenProps {
  isTabVisible?: boolean;
  /** Open Chats tab and start/open DM with this user. */
  onOpenChatWithUser?: (userId: string) => void;
  /** Full-screen friend profile (same as Connections → view profile). */
  onViewFriendProfile?: (userId: string) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  preferencesRefreshKey?: number; // Incremented when user saves preferences
  deepLinkParams?: Record<string, string> | null;
  onDeepLinkHandled?: () => void;
}

// Tabs component similar to BoardTabs
const DiscoverTabs: React.FC<DiscoverTabsProps> = ({
  activeTab,
  onTabChange,
}) => {
  const { t } = useTranslation(['discover', 'common']);
  const tabs: Array<{ id: DiscoverTab; label: string; icon: string }> = [
    { id: "near-you", label: t('discover:tabs.near_you'), icon: "map-pin" },
    { id: "night-out", label: t('discover:tabs.night_out'), icon: "music" },
  ];

  return (
    <View style={styles.tabsWrapper}>
      <View style={styles.tabsContainer}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                <Icon
                  name={tab.icon}
                  size={18}
                  color={isActive ? "#eb7825" : "#6B7280"}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// Featured Card Component
const FeaturedCard: React.FC<FeaturedCardProps> = ({ card, currency = "USD", measurementSystem = "Imperial", onPress }) => {
  const { t } = useTranslation(['discover', 'common']);
  const formattedPrice = formatPriceRange(card.priceRange, currency);
  const formattedDistance = parseAndFormatDistance(card.distance, measurementSystem);
  
  return (
    <TouchableOpacity 
      style={styles.featuredCard}
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Card Image Section */}
      <View style={styles.cardImageContainer}>
        <Image
          source={{ uri: card.image }}
          style={styles.cardImage}
          resizeMode="cover"
        />
        {/* Featured Badge */}
        <View style={styles.featuredBadge}>
          <Text style={styles.featuredBadgeText}>{t('discover:featured.badge')}</Text>
        </View>
        {/* Travel Info Badges */}
        <View style={styles.travelInfoContainer}>
          {formattedDistance ? (
            <View style={styles.travelInfoBadge}>
              <Icon name="location-outline" size={14} color="white" />
              <Text style={styles.travelInfoText}>{formattedDistance}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Card Content Section */}
      <View style={styles.cardContent}>
        {/* Title */}
        <Text style={styles.cardTitle}>{card.title}</Text>

        {/* Experience Type */}
        <Text style={styles.experienceType}>{card.experienceType}</Text>

        {/* Description */}
        <Text style={styles.cardDescription} numberOfLines={3}>
          {card.description}
        </Text>

        {/* Bottom Row: Price Range and Rating */}
        <View style={styles.cardFooter}>
          <Text style={styles.priceRange}>{formattedPrice}</Text>
          <View style={styles.ratingContainer}>
            <Icon name="star" size={16} color="#eb7825" />
            <Text style={styles.ratingText}>{card.rating.toFixed(1)}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Hero Card Component (side-by-side at top of For You view)
interface HeroCardProps {
  card: FeaturedCardData;
  currency?: string;
  measurementSystem?: "Metric" | "Imperial";
  onPress?: () => void;
}

const HeroCard: React.FC<HeroCardProps> = ({ card, currency = "USD", measurementSystem = "Imperial", onPress }) => {
  const formattedPrice = formatPriceRange(card.priceRange, currency);
  const categoryIcon = categoryIcons[card.experienceType] || "ellipse-outline";

  return (
    <TouchableOpacity
      style={styles.heroCard}
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Hero Image */}
      <View style={styles.heroCardImageContainer}>
        <Image
          source={{ uri: card.image }}
          style={styles.heroCardImage}
          resizeMode="cover"
        />
        {/* Category Badge */}
        <View style={styles.heroCardCategoryBadge}>
          <Icon name={categoryIcon} size={14} color="#eb7825" />
          <Text style={styles.heroCardCategoryText}>{card.experienceType}</Text>
        </View>
      </View>

      {/* Hero Content */}
      <View style={styles.heroCardContent}>
        <Text style={styles.heroCardTitle} numberOfLines={2}>{card.title}</Text>
        <Text style={styles.heroCardDescription} numberOfLines={2}>{card.description}</Text>
        <View style={styles.heroCardFooter}>
          <Text style={styles.heroCardPrice}>{formattedPrice}</Text>
          <View style={styles.heroCardRating}>
            <Icon name="star" size={13} color="#eb7825" />
            <Text style={styles.heroCardRatingText}>{card.rating.toFixed(1)}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Grid Card Component (smaller version with category icon)
const GridCard: React.FC<GridCardProps> = ({ card, currency = "USD", onPress }) => {
  const formattedPrice = formatPriceRange(card.priceRange, currency);
  const categoryIcon = categoryIcons[card.category] || "ellipse-outline";
  
  return (
    <TouchableOpacity 
      style={styles.gridCard}
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Card Image Section */}
      <View style={styles.gridCardImageContainer}>
        <Image
          source={{ uri: card.image }}
          style={styles.gridCardImage}
          resizeMode="cover"
        />
        {/* Category Icon Badge */}
        <View style={styles.categoryIconBadge}>
          <Icon name={categoryIcon} size={16} color="#eb7825" />
        </View>
      </View>

      {/* Card Content Section */}
      <View style={styles.gridCardContent}>
        {/* Title */}
        <Text style={styles.gridCardTitle} numberOfLines={2}>{card.title}</Text>

        {/* Category */}
        <Text style={styles.gridCardCategory} numberOfLines={1}>{card.category}</Text>

        {/* Bottom Row: Price Range and Arrow Button */}
        <View style={styles.gridCardFooter}>
          <Text style={styles.gridCardPrice}>{formattedPrice}</Text>
          <View style={styles.gridCardArrowButton}>
            <Icon name="chevron-right" size={14} color="white" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Night Out Card Component — compact horizontal layout
const NightOutCard: React.FC<NightOutCardProps> = ({ card, currency = "USD", onPress }) => {
  const { t } = useTranslation(['discover', 'common']);
  const formattedPrice = formatPriceRange(card.price, currency);
  const displayPrice = formattedPrice || card.price || t('discover:nightout.tba');
  const statusColor = card.ticketStatus === "onsale" ? "#10B981" : card.ticketStatus === "offsale" ? "#EF4444" : "#F59E0B";
  const statusLabel = card.ticketStatus === "onsale" ? t('discover:nightout.on_sale') : card.ticketStatus === "offsale" ? t('discover:nightout.sold_out') : t('discover:nightout.soon');

  return (
    <TouchableOpacity
      style={styles.nightOutCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Compact horizontal layout: image left, info right */}
      <View style={styles.nightOutCardRow}>
        {/* Thumbnail */}
        <View style={styles.nightOutThumbWrap}>
          <Image
            source={{ uri: card.image }}
            style={styles.nightOutThumb}
            resizeMode="cover"
          />
          {/* Status dot */}
          <View style={[styles.nightOutStatusDot, { backgroundColor: statusColor }]} />
        </View>

        {/* Info */}
        <View style={styles.nightOutInfo}>
          {/* Event title */}
          <Text style={styles.nightOutTitle} numberOfLines={1}>{card.eventName}</Text>

          {/* Artist */}
          <Text style={styles.nightOutArtist} numberOfLines={1}>{card.artistName}</Text>

          {/* Date · Time row */}
          <View style={styles.nightOutMetaRow}>
            <Icon name="calendar" size={12} color="#eb7825" />
            <Text style={styles.nightOutMetaText}>{card.date}</Text>
            <Text style={styles.nightOutMetaDot}>·</Text>
            <Icon name="clock" size={12} color="#eb7825" />
            <Text style={styles.nightOutMetaText}>{card.time}</Text>
          </View>

          {/* Venue row */}
          <View style={styles.nightOutMetaRow}>
            <Icon name="location-outline" size={12} color="#eb7825" />
            <Text style={styles.nightOutMetaText} numberOfLines={1}>{card.venueName}{card.location ? `, ${card.location}` : ""}</Text>
          </View>
        </View>

        {/* Right column: price + status */}
        <View style={styles.nightOutRight}>
          <Text style={styles.nightOutPrice} numberOfLines={1}>{displayPrice}</Text>
          <Text style={[styles.nightOutStatusLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Tags strip (only show genre + first 2 tags) */}
      {(card.genre || card.tags.length > 0) && (
        <View style={styles.nightOutTagStrip}>
          {card.genre ? (
            <View style={styles.nightOutTagChip}>
              <Icon name="musical-notes-outline" size={10} color="#eb7825" />
              <Text style={styles.nightOutTagLabel}>{card.genre}</Text>
            </View>
          ) : null}
          {card.tags.filter(t => t !== card.genre && t !== "Music" && t !== "Live").slice(0, 2).map((tag, i) => (
            <View key={i} style={styles.nightOutTagChip}>
              <Text style={styles.nightOutTagLabel}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
};

export default function DiscoverScreen({
  isTabVisible = true,
  onOpenChatWithUser,
  onViewFriendProfile,
  accountPreferences,
  preferencesRefreshKey,
  deepLinkParams,
  onDeepLinkHandled,
}: DiscoverScreenProps) {
  const { t } = useTranslation(['discover', 'common']);
  const insets = useSafeAreaInsets();
  // ORCH-0436: coachMap removed — map no longer rendered
  const { settings: mapSettings, updateSettings: updateMapSettings } = useMapSettings();
  const [activeTab, setActiveTab] = useState<DiscoverTab>("near-you");
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] = useState<ExpandedCardData | null>(null);
  // Navigation state for scrolling between expanded cards (e.g., paired saves list)
  const expandedCardListRef = useRef<ExpandedCardData[]>([]);
  const [expandedCardIndex, setExpandedCardIndex] = useState<number | null>(null);
  
  // Entrance animation values
  const featuredCardOpacity = useRef(new Animated.Value(0)).current;
  const featuredCardSlide = useRef(new Animated.Value(40)).current;
  const gridCardsLeftOpacity = useRef(new Animated.Value(0)).current;
  const gridCardsLeftSlide = useRef(new Animated.Value(30)).current;
  const gridCardsRightOpacity = useRef(new Animated.Value(0)).current;
  const gridCardsRightSlide = useRef(new Animated.Value(30)).current;


  // Run entrance animations on mount
  useEffect(() => {
    // Featured card animates first
    Animated.parallel([
      Animated.timing(featuredCardOpacity, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(featuredCardSlide, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
    ]).start();

    // Left column grid cards follow after featured card
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(gridCardsLeftOpacity, {
          toValue: 1,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(gridCardsLeftSlide, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }, 150); // 150ms delay after featured card starts

    // Right column grid cards lag slightly behind left
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(gridCardsRightOpacity, {
          toValue: 1,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(gridCardsRightSlide, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }, 230); // 80ms after left column starts
  }, []);
  
  // ORCH-0435 Phase B: Pairing UI removed — pairing now lives on Friends page

  // Get auth for Discover features
  const user = useAppStore((s) => s.user);
  const { canAccess } = useFeatureGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('curated_cards');
  const prefetchQueryClient = useQueryClient();
  const { data: mapSavedCards } = useSavedCards(user?.id);
  // ORCH-0436: mapCalendarEntries + mapScheduledCardIds removed — only used for map
  const mapSavedCardIds = useMemo(() => new Set((mapSavedCards ?? []).map(c => c.id)), [mapSavedCards]);



  // ── User preference categories (drives which categories the Discover API fetches) ──
  const [userSelectedCategories, setUserSelectedCategories] = useState<string[] | null>(null);
  const [userTravelMode, setUserTravelMode] = useState<string | undefined>(undefined);
  const prevRefreshKeyRef = useRef<number | undefined>(undefined);

  // Stable fingerprint of user's preferences — used to partition caches per preference set
  const prefsFingerprint = useMemo(() => {
    const catPart = (!userSelectedCategories || userSelectedCategories.length === 0)
      ? 'all'
      : [...userSelectedCategories].sort().join(',');
    const modePart = userTravelMode || 'walking';
    return `${catPart}_${modePart}`;
  }, [userSelectedCategories, userTravelMode]);

  useEffect(() => {
    const loadUserCategories = async () => {
      if (!user?.id) return;
      try {
        const prefs = await PreferencesService.getUserPreferences(user.id);
        if (prefs?.categories && prefs.categories.length > 0) {
          // Filter out intent IDs – keep only actual category names/IDs
          const intentIds = new Set([
            "adventurous", "first-date", "romantic", "group-fun", "picnic-dates", "take-a-stroll",
          ]);
          const categories = prefs.categories.filter((c: string) => !intentIds.has(c));
          setUserSelectedCategories(categories.length > 0 ? categories : null);
          console.log("[Discover] Loaded user categories:", categories);
        } else {
          setUserSelectedCategories(null);
        }
        // Extract travel mode for travel time computation
        if (prefs?.travel_mode) {
          setUserTravelMode(prefs.travel_mode);
        }
      } catch (err) {
        console.warn("[Discover] Failed to load user preferences:", err);
        setUserSelectedCategories(null);
        setUserTravelMode(undefined);
      }
    };
    loadUserCategories();
  }, [user?.id, preferencesRefreshKey]);

  // When preferences change (refreshKey bumps), invalidate local caches so discover re-fetches
  // Per-fingerprint cache keys mean old entries expire naturally — no need to delete them.
  useEffect(() => {
    if (prevRefreshKeyRef.current !== undefined && prevRefreshKeyRef.current !== preferencesRefreshKey) {
      console.log("[Discover] Preferences changed – resetting fetch guard for new preference set");
      hasFetchedRef.current = false;
      discoverSessionCache.clear();
    }
    prevRefreshKeyRef.current = preferencesRefreshKey;
  }, [preferencesRefreshKey]);

  // Fallback: saved location preference (only used if device GPS is unavailable)
  const { data: userLocationData } = useUserLocation(user?.id, "solo", preferencesRefreshKey);
  const fallbackLat = userLocationData?.lat;
  const fallbackLng = userLocationData?.lng;


  // Device GPS location - used by BOTH "For You" and "Night Out" tabs
  const [deviceGpsLat, setDeviceGpsLat] = useState<number | null>(null);
  const [deviceGpsLng, setDeviceGpsLng] = useState<number | null>(null);
  const deviceGpsFetchedRef = useRef(false);

  useEffect(() => {
    if (deviceGpsFetchedRef.current) return;
    deviceGpsFetchedRef.current = true;

    const resolveLocation = async () => {
      // Try real GPS first (cached by OS — typically <200ms)
      try {
        const loc = await enhancedLocationService.getCurrentLocation();
        if (loc?.latitude && loc?.longitude) {
          setDeviceGpsLat(loc.latitude);
          setDeviceGpsLng(loc.longitude);
          console.log("[Discover] Device GPS:", loc.latitude, loc.longitude);
          return;
        }
      } catch {
        /* fall through to fallback */
      }

      // Fall back to saved preference location
      if (fallbackLat && fallbackLng) {
        console.log("[Discover] GPS unavailable, using preference location");
        setDeviceGpsLat(fallbackLat);
        setDeviceGpsLng(fallbackLng);
      }
    };

    resolveLocation();
  }, [fallbackLat, fallbackLng]);

  // Reset the one-shot GPS flag on foreground resume so GPS re-fires after the
  // user has been away (e.g., flew to a new city). The next render cycle will
  // re-enter the effect above with deviceGpsFetchedRef.current === false.
  useEffect(() => {
    let lastState = AppState.currentState;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (lastState === 'background' && nextState === 'active') {
        deviceGpsFetchedRef.current = false;
      }
      lastState = nextState;
    });
    return () => sub.remove();
  }, []);

  // locationLat/locationLng now come from device GPS (not saved preference)
  const locationLat = deviceGpsLat;
  const locationLng = deviceGpsLng;

  // ORCH-0436: discoverMapUserLocation + discoverMapAccountPreferences removed — map no longer rendered


  // Night Out Filter Modal state
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<NightOutFilters>({
    date: "any",
    price: "any",
    genre: "all",
  });

  // Night Out real data state
  const [nightOutCards, setNightOutCards] = useState<NightOutCardData[]>([]);
  const [nightOutLoading, setNightOutLoading] = useState(true);
  const [nightOutError, setNightOutError] = useState<string | null>(null);

  // Night Out reuses the shared device GPS coordinates
  const nightOutGpsLat = deviceGpsLat;
  const nightOutGpsLng = deviceGpsLng;

  // State for Discover-specific recommendations (fetched with ALL categories)
  const [discoverRecommendations, setDiscoverRecommendations] = useState<Recommendation[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasCompletedDiscoverFetch, setHasCompletedDiscoverFetch] = useState(false);
  const [discoverRetryKey, setDiscoverRetryKey] = useState(0);
  const [isDiscoverCacheMigrationReady, setIsDiscoverCacheMigrationReady] = useState(false);
  const hasFetchedRef = useRef(false);
  const fetchingRef = useRef(false);
  const lastDiscoverFetchDateRef = useRef<string | null>(null);
  const loadedFromCacheRef = useRef(false); // Flag to skip card re-randomization when loaded from cache

  // Helper to get current US date string (YYYY-MM-DD format)
  const getTodayDateString = (): string => {
    return getUsDateKey();
  };

  // One-time cache migration: invalidate malformed legacy discover cache entries
  useEffect(() => {
    let isCancelled = false;

    const runDiscoverCacheMigration = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setIsDiscoverCacheMigrationReady(true);
        }
        return;
      }

      try {
        const migrationMarkerKey = `${DISCOVER_CACHE_MIGRATION_KEY}_${user.id}`;
        const migrationMarker = await AsyncStorage.getItem(migrationMarkerKey);

        if (migrationMarker !== DISCOVER_CACHE_MIGRATION_VERSION) {
          const allKeys = await AsyncStorage.getAllKeys();
          const keysToRemove = allKeys.filter((key) =>
            key.startsWith(`mingla_discover_cache_v2_${user.id}_`) ||
            key.startsWith(`mingla_discover_cache_v3_${user.id}_`) ||
            key.startsWith(`mingla_discover_cache_v4_${user.id}_`) ||
            key.startsWith(`mingla_discover_cache_v5_${user.id}_`) ||
            key.startsWith(`mingla_discover_cache_v6_${user.id}_`) ||
            key.startsWith(`mingla_discover_cache_daily_v1_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v2_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v3_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v4_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v5_${user.id}`)
          );

          if (keysToRemove.length > 0) {
            await AsyncStorage.multiRemove(keysToRemove);
            console.log(`[Discover] Cleared ${keysToRemove.length} legacy cache entries for user`, user.id);
          }

          discoverSessionCache.clear();
          await AsyncStorage.setItem(migrationMarkerKey, DISCOVER_CACHE_MIGRATION_VERSION);
        }
      } catch (error) {
        console.error("[Discover] Cache migration failed:", error);
      } finally {
        if (!isCancelled) {
          setIsDiscoverCacheMigrationReady(true);
        }
      }
    };

    setIsDiscoverCacheMigrationReady(false);
    runDiscoverCacheMigration();

    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  // Save discover data to cache
  const saveDiscoverCache = async (
    recommendations: Recommendation[],
    featuredCard: FeaturedCardData | null,
    gridCards: GridCardData[],
    heroCards: FeaturedCardData[] = [],
    expiresAt: string | null = null
  ) => {
    if (!user?.id) {
      return;
    }
    try {
      const cacheData: DiscoverCache = {
        date: getTodayDateString(),
        expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        recommendations,
        featuredCard,
        gridCards,
        heroCards,
      };
      const exactCacheKey = getDiscoverExactCacheKey(user.id, locationLat, locationLng, prefsFingerprint);
      const dailyCacheKey = getDiscoverDailyCacheKey(user.id, prefsFingerprint);
      const serialized = JSON.stringify(cacheData);

      discoverSessionCache.set(exactCacheKey, cacheData);
      discoverSessionCache.set(dailyCacheKey, cacheData);

      await AsyncStorage.multiSet([
        [exactCacheKey, serialized],
        [dailyCacheKey, serialized],
      ]);
      console.log("Saved discover cache for date:", cacheData.date, "prefs:", prefsFingerprint);
    } catch (error) {
      console.error("Error saving discover cache:", error);
    }
  };

  // Load discover data from cache
  const loadDiscoverCache = async (): Promise<DiscoverCache | null> => {
    if (!user?.id) {
      return null;
    }
    try {
      const exactCacheKey = getDiscoverExactCacheKey(user.id, locationLat, locationLng, prefsFingerprint);
      const dailyCacheKey = getDiscoverDailyCacheKey(user.id, prefsFingerprint);

      const cachedExactInMemory = discoverSessionCache.get(exactCacheKey);
      if (cachedExactInMemory) {
        return cachedExactInMemory;
      }

      const cachedDailyInMemory = discoverSessionCache.get(dailyCacheKey);
      if (cachedDailyInMemory) {
        return cachedDailyInMemory;
      }

      const entries = await AsyncStorage.multiGet([exactCacheKey, dailyCacheKey]);
      const exactSerialized = entries[0]?.[1];
      const dailySerialized = entries[1]?.[1];

      if (exactSerialized) {
        const parsed = JSON.parse(exactSerialized) as DiscoverCache;
        discoverSessionCache.set(exactCacheKey, parsed);
        discoverSessionCache.set(dailyCacheKey, parsed);
        return parsed;
      }

      if (dailySerialized) {
        const parsed = JSON.parse(dailySerialized) as DiscoverCache;
        discoverSessionCache.set(dailyCacheKey, parsed);
        return parsed;
      }
    } catch (error) {
      console.error("Error loading discover cache:", error);
    }
    return null;
  };

  const getDiscoverCacheFromMemory = (): DiscoverCache | null => {
    if (!user?.id) {
      return null;
    }

    const exactCacheKey = getDiscoverExactCacheKey(user.id, locationLat, locationLng, prefsFingerprint);
    const dailyCacheKey = getDiscoverDailyCacheKey(user.id, prefsFingerprint);

    return discoverSessionCache.get(exactCacheKey) || discoverSessionCache.get(dailyCacheKey) || null;
  };

  const prefetchDiscoverImages = (
    featuredCard: FeaturedCardData | null,
    gridCards: GridCardData[]
  ) => {
    const urls = [
      featuredCard?.image,
      ...(featuredCard?.images || []),
      ...gridCards.map((card) => card.image),
    ].filter((url): url is string => !!url && typeof url === "string");

    const uniqueUrls = Array.from(new Set(urls)).slice(0, 20);
    uniqueUrls.forEach((url) => {
      Image.prefetch(url).catch(() => {});
    });
  };

  const featuredFromGridCard = (card: GridCardData): FeaturedCardData => ({
    id: card.id,
    title: card.title,
    experienceType: card.category,
    description: card.description,
    image: card.image,
    images: card.images?.length ? card.images : [card.image].filter(Boolean),
    priceRange: card.priceRange,
    rating: card.rating,
    reviewCount: card.reviewCount,
    address: card.address,
    travelTime: card.travelTime,
    distance: card.distance,
    highlights: card.highlights || [],
    tags: card.tags || [],
    location: card.location,
    openingHours: card.openingHours || null,
    website: card.website || null,
    phone: card.phone || null,
  });

  const featuredFromRecommendation = (rec: Recommendation): FeaturedCardData => ({
    id: `${rec.id}_featured_fallback`,
    title: rec.title,
    experienceType: rec.category,
    description: rec.description,
    image: rec.image,
    images: rec.images?.length ? rec.images : [rec.image].filter(Boolean),
    priceRange: rec.priceRange,
    rating: rec.rating,
    reviewCount: rec.reviewCount,
    address: rec.address,
    travelTime: rec.travelTime,
    distance: rec.distance,
    highlights: rec.highlights || [],
    tags: rec.tags || [],
    location: rec.lat && rec.lng ? { lat: rec.lat, lng: rec.lng } : undefined,
    openingHours: rec.openingHours || null,
    website: rec.website || null,
    phone: rec.phone || null,
  });

  const gridFromRecommendation = (rec: Recommendation): GridCardData => ({
    id: rec.id,
    title: rec.title,
    category: rec.category,
    description: rec.description,
    image: rec.image,
    images: rec.images?.length ? rec.images : [rec.image].filter(Boolean),
    priceRange: rec.priceRange,
    rating: rec.rating,
    reviewCount: rec.reviewCount,
    address: rec.address,
    travelTime: rec.travelTime,
    distance: rec.distance,
    highlights: rec.highlights || [],
    tags: rec.tags || [],
    location: rec.lat && rec.lng ? { lat: rec.lat, lng: rec.lng } : undefined,
    openingHours: rec.openingHours || null,
    website: rec.website || null,
    phone: rec.phone || null,
  });

  const applyCachedDiscoverData = (cachedData: DiscoverCache) => {
    const fallbackFeatured = cachedData.featuredCard || (cachedData.gridCards?.[0] ? featuredFromGridCard(cachedData.gridCards[0]) : null);
    const hasGridCards = (cachedData.gridCards?.length || 0) > 0;
    const hasCompleteCardState = !!fallbackFeatured && hasGridCards;

    loadedFromCacheRef.current = hasCompleteCardState;

    // Restore hero cards from cache (backward compat: default to empty array)
    let cachedHeroCards = cachedData.heroCards || [];
    let cachedGridCards = cachedData.gridCards || [];

    // CLIENT-SIDE FALLBACK: If cached hero cards are missing, extract from grid
    if (cachedHeroCards.length < 2 && cachedGridCards.length > 0) {
      const TARGET_HERO_CATEGORIES = ["Fine Dining", "Play"];
      const heroUsedIds = new Set(cachedHeroCards.map((h: FeaturedCardData) => h.id));
      const heroUsedCats = new Set(cachedHeroCards.map((h: FeaturedCardData) => h.experienceType));
      const newHeroes = [...cachedHeroCards];

      for (const heroCategory of TARGET_HERO_CATEGORIES) {
        if (newHeroes.length >= 2) break;
        if (heroUsedCats.has(heroCategory)) continue;
        const candidate = cachedGridCards.find(
          (c: GridCardData) => c.category === heroCategory && !heroUsedIds.has(c.id)
        );
        if (candidate) {
          newHeroes.push(featuredFromGridCard(candidate));
          heroUsedIds.add(candidate.id);
          heroUsedCats.add(heroCategory);
        }
      }
      // Fill remaining with highest-rated
      if (newHeroes.length < 2) {
        const remaining = cachedGridCards
          .filter((c: GridCardData) => !heroUsedIds.has(c.id))
          .sort((a: GridCardData, b: GridCardData) => (b.rating || 0) - (a.rating || 0));
        for (const c of remaining) {
          if (newHeroes.length >= 2) break;
          newHeroes.push(featuredFromGridCard(c));
          heroUsedIds.add(c.id);
        }
      }
      // Remove heroes from grid
      cachedGridCards = cachedGridCards.filter((c: GridCardData) => !heroUsedIds.has(c.id));
      cachedHeroCards = newHeroes;
      console.log(`[cache-restore] Reconstructed ${cachedHeroCards.length} heroes from grid`);
    }

    if (cachedHeroCards.length > 0) {
      setSelectedHeroCards(cachedHeroCards);
    }

    if (hasCompleteCardState) {
      setSelectedFeaturedCard(cachedHeroCards[0] || fallbackFeatured);
      setSelectedGridCards(cachedGridCards);
    } else {
      const fallbackFromRecommendations = cachedData.recommendations?.[0]
        ? featuredFromRecommendation(cachedData.recommendations[0])
        : null;
      const reconstructedGrid = (cachedData.recommendations || [])
        .slice(0, 10)
        .map(gridFromRecommendation);

      setSelectedFeaturedCard(fallbackFromRecommendations);
      setSelectedGridCards(reconstructedGrid);
    }

    setDiscoverRecommendations(cachedData.recommendations);
    setHasCompletedDiscoverFetch(true);
    prefetchDiscoverImages(cachedHeroCards[0] || fallbackFeatured, cachedGridCards);
  };

  // Helper: check if a cached batch is still within its 24h window
  const isCacheStillValid = (cache: DiscoverCache): boolean => {
    if (cache.expiresAt) {
      return new Date(cache.expiresAt) > new Date();
    }
    // Legacy fallback: date-based check
    return cache.date === getTodayDateString();
  };

  // Fetch recommendations with ALL 12 categories for the Discover "For You" tab
  // Cached for 24 hours - uses persisted data until expiry
  useEffect(() => {
    const fetchDiscoverRecommendations = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      // If retrying after an error, clear the guards that block re-fetching
      if (discoverError) {
        hasFetchedRef.current = false;
        lastDiscoverFetchDateRef.current = null;
        setDiscoverError(null);
        setHasCompletedDiscoverFetch(false);
      }

      if (!user?.id) {
        fetchingRef.current = false;
        return;
      }

      if (!isDiscoverCacheMigrationReady) {
        fetchingRef.current = false;
        return;
      }

      let waitingForLocation = false;
      const today = getTodayDateString();

      // Reset once-per-session guard when US day changes (refresh at US midnight)
      if (lastDiscoverFetchDateRef.current && lastDiscoverFetchDateRef.current !== today) {
        hasFetchedRef.current = false;
      }

      // Only fetch once per session
      if (hasFetchedRef.current && lastDiscoverFetchDateRef.current === today) {
        fetchingRef.current = false;
        return;
      }

      setDiscoverError(null);

      try {
        // Fast path: hydrate from in-memory cache instantly (no async storage wait)
        let cachedData = getDiscoverCacheFromMemory();

        if (cachedData && cachedData.recommendations.length > 0) {
          console.log("Using in-memory discover cache from:", cachedData.date, "expires:", cachedData.expiresAt);
          applyCachedDiscoverData(cachedData);
          setDiscoverLoading(false);

          if (isCacheStillValid(cachedData)) {
            hasFetchedRef.current = true;
            lastDiscoverFetchDateRef.current = today;
            return;
          }
        }

        // If no memory cache, check persistent cache
        if (!cachedData) {
          setDiscoverLoading(true);
          cachedData = await loadDiscoverCache();
        }

        if (cachedData && cachedData.recommendations.length > 0) {
          console.log("Using cached discover data from:", cachedData.date, "expires:", cachedData.expiresAt);
          applyCachedDiscoverData(cachedData);
          setDiscoverLoading(false);

          if (isCacheStillValid(cachedData)) {
            hasFetchedRef.current = true;
            lastDiscoverFetchDateRef.current = today;
            return;
          }
        }

        if (!locationLat || !locationLng) {
          waitingForLocation = !cachedData;
          if (waitingForLocation) {
            setDiscoverLoading(false);
          }
          return;
        }

        // If we already hydrated stale cache, refresh in background without blocking UI
        if (cachedData && !isCacheStillValid(cachedData)) {
          console.log("Refreshing stale discover cache in background (expired)");
        } else {
          setDiscoverLoading(true);
          console.log("Cache miss or stale. Fetching fresh discover data...");
        }

        hasFetchedRef.current = true;
        lastDiscoverFetchDateRef.current = today;  // MOVED: closes GPS race window

        // For You: always fetch ALL 12 categories with Fine Dining + Play heroes
        // User preferences do NOT filter the For You view — it shows best-of-the-best across ALL categories
        const { cards: generatedCards, heroCards: heroCardsRaw, featuredCard, expiresAt: serverExpiresAt } = await ExperienceGenerationService.discoverExperiences(
          { lat: locationLat, lng: locationLng },
          10000, // 10km radius
          undefined,              // For You: always ALL categories (never filtered by user prefs)
          ["Fine Dining", "Play"], // For You: always these 2 hero categories
          userTravelMode,         // User's preferred travel mode (driving/walking/transit/bicycling)
        );

        if (!generatedCards || generatedCards.length === 0) {
          console.warn("[Discover] API returned no cards after retry. Preserving stale cache.");
          if (cachedData && cachedData.recommendations.length > 0) {
            // Do NOT set lastDiscoverFetchDateRef — allow retry on next foreground
            hasFetchedRef.current = false;
            return;
          }

          setDiscoverError(t('discover:errors.unable_to_load'));
          hasFetchedRef.current = false;
          return;
        }

        console.log("Discover API returned:", generatedCards.length, "cards + featured card");
        console.log("Categories returned:", Array.from(new Set(generatedCards.map((e: any) => e.category))));

        // Transform to Recommendation format - all 10 cards for grid display
        const transformed: Recommendation[] = generatedCards.map((exp: any) => ({
          id: exp.id,
          title: exp.title,
          category: exp.category,
          categoryIcon: exp.categoryIcon,
          timeAway: exp.travelTime,
          description: exp.description,
          budget: exp.priceRange,
          rating: exp.rating,
          image: exp.heroImage,
          images: exp.images?.length ? exp.images : [exp.heroImage].filter(Boolean),
          priceRange: exp.priceRange,
          distance: exp.distance,
          travelTime: exp.travelTime,
          experienceType: exp.category,
          highlights: exp.highlights || [],
          fullDescription: exp.description,
          address: exp.address,
          openingHours: exp.openingHours || null,
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
          strollData: exp.strollData,
          website: exp.website || null,
          phone: exp.phone || null,
        }));

        // Transform hero cards from server response
        const transformedHeroes: FeaturedCardData[] = (heroCardsRaw || []).map((hc: any) => ({
          id: hc.id,
          placeId: hc.placeId || hc.id,
          title: hc.title,
          experienceType: hc.category,
          description: hc.description,
          image: hc.heroImage,
          images: hc.images?.length ? hc.images : [hc.heroImage].filter(Boolean),
          priceRange: hc.priceRange,
          rating: hc.rating,
          reviewCount: hc.reviewCount,
          address: hc.address,
          travelTime: hc.travelTime,
          distance: hc.distance,
          highlights: hc.highlights || [],
          tags: hc.highlights || [],
          location: hc.lat && hc.lng ? { lat: hc.lat, lng: hc.lng } : undefined,
          openingHours: hc.openingHours || null,
          website: hc.website || null,
          phone: hc.phone || null,
        }));

        // CLIENT-SIDE FALLBACK: If server returned < 2 hero cards, extract from grid cards
        // This handles stale server caches that were built before the hero card system
        if (transformedHeroes.length < 2 && generatedCards.length > 0) {
          const TARGET_HERO_CATEGORIES = ["Fine Dining", "Play"];
          const existingHeroIds = new Set(transformedHeroes.map((h: FeaturedCardData) => h.id));
          const existingHeroCats = new Set(transformedHeroes.map((h: FeaturedCardData) => h.experienceType));

          for (const heroCategory of TARGET_HERO_CATEGORIES) {
            if (transformedHeroes.length >= 2) break;
            if (existingHeroCats.has(heroCategory)) continue;

            const candidate = generatedCards.find(
              (c: any) => c.category === heroCategory && !existingHeroIds.has(c.id)
            );
            if (candidate) {
              transformedHeroes.push({
                id: candidate.id,
                placeId: candidate.placeId || candidate.id,
                title: candidate.title,
                experienceType: candidate.category,
                description: candidate.description,
                image: candidate.heroImage,
                images: candidate.images?.length ? candidate.images : [candidate.heroImage].filter(Boolean),
                priceRange: candidate.priceRange,
                rating: candidate.rating,
                reviewCount: candidate.reviewCount,
                address: candidate.address,
                travelTime: candidate.travelTime,
                distance: candidate.distance,
                highlights: candidate.highlights || [],
                tags: candidate.highlights || [],
                location: candidate.lat && candidate.lng ? { lat: candidate.lat, lng: candidate.lng } : undefined,
                openingHours: candidate.openingHours || null,
                website: candidate.website || null,
                phone: candidate.phone || null,
              });
              existingHeroIds.add(candidate.id);
              existingHeroCats.add(heroCategory);
              console.log(`[For You] Extracted hero from grid for ${heroCategory}: "${candidate.title}"`);
            } else {
              console.log(`[For You] No grid card found for hero category: ${heroCategory}`);
            }
          }

          // If still less than 2 heroes, fill from highest-rated remaining cards
          if (transformedHeroes.length < 2) {
            const remaining = generatedCards
              .filter((c: any) => !existingHeroIds.has(c.id))
              .sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
            for (const candidate of remaining) {
              if (transformedHeroes.length >= 2) break;
              transformedHeroes.push({
                id: candidate.id,
                placeId: candidate.placeId || candidate.id,
                title: candidate.title,
                experienceType: candidate.category,
                description: candidate.description,
                image: candidate.heroImage,
                images: candidate.images?.length ? candidate.images : [candidate.heroImage].filter(Boolean),
                priceRange: candidate.priceRange,
                rating: candidate.rating,
                reviewCount: candidate.reviewCount,
                address: candidate.address,
                travelTime: candidate.travelTime,
                distance: candidate.distance,
                highlights: candidate.highlights || [],
                tags: candidate.highlights || [],
                location: candidate.lat && candidate.lng ? { lat: candidate.lat, lng: candidate.lng } : undefined,
                openingHours: candidate.openingHours || null,
                website: candidate.website || null,
                phone: candidate.phone || null,
              });
              existingHeroIds.add(candidate.id);
              console.log(`[For You] Filled hero slot with "${candidate.title}" (${candidate.category})`);
            }
          }
        }

        console.log(`[For You] Final hero cards: ${transformedHeroes.length}, categories: ${transformedHeroes.map((h: FeaturedCardData) => h.experienceType).join(', ')}`);

        // Backward compat: featuredCard = first hero
        const transformedFeatured = transformedHeroes[0] || null;

        // Build grid cards — EXCLUDE hero card IDs to avoid duplicates
        const heroIds = new Set(transformedHeroes.map((h: FeaturedCardData) => h.id));
        const gridCards: GridCardData[] = generatedCards
          .filter((exp: any) => !heroIds.has(exp.id))
          .map((exp: any) => ({
            id: exp.id,
            placeId: exp.placeId || exp.id,
            title: exp.title,
            category: exp.category,
            description: exp.description,
            image: exp.heroImage,
            images: exp.images?.length ? exp.images : [exp.heroImage].filter(Boolean),
            priceRange: exp.priceRange,
            rating: exp.rating,
            reviewCount: exp.reviewCount,
            address: exp.address,
            travelTime: exp.travelTime,
            distance: exp.distance,
            highlights: exp.highlights || [],
            tags: exp.highlights || [],
            location: exp.lat && exp.lng ? { lat: exp.lat, lng: exp.lng } : undefined,
            openingHours: exp.openingHours || null,
            website: exp.website || null,
            phone: exp.phone || null,
          }));

        const finalFeatured = transformedFeatured || (gridCards[0] ? featuredFromGridCard(gridCards[0]) : null);
        setSelectedHeroCards(transformedHeroes);
        setSelectedFeaturedCard(finalFeatured);
        setSelectedGridCards(gridCards);
        console.log("Set hero cards:", transformedHeroes.length, "grid cards:", gridCards.length);

        prefetchDiscoverImages(finalFeatured, gridCards);

        setDiscoverRecommendations(transformed);
        setHasCompletedDiscoverFetch(true);

        // Save to cache for 24-hour persistence
        saveDiscoverCache(transformed, finalFeatured, gridCards, transformedHeroes, serverExpiresAt);
        
        // Mark as loaded from cache to skip the card selection useEffect
        loadedFromCacheRef.current = true;
      } catch (error: any) {
        console.error("Error fetching Discover recommendations:", error);
        const isAuthError = error?.message?.includes('Session expired');

        if (isAuthError) {
          // Auth failure: don't set date guard, allow retry on next foreground
          console.log('[Discover] Auth error — will retry on next foreground');
          hasFetchedRef.current = false;
          const staleCache = getDiscoverCacheFromMemory();
          if (staleCache && staleCache.recommendations.length > 0) {
            // Silently keep stale cache, no error banner
            return;
          }
          setDiscoverError(t('discover:errors.session_expired'));
        } else {
          // Server/network error: set date guard to avoid hammering
          // Leave hasFetchedRef as true so the AND guard (hasFetchedRef && dateRef === today) blocks re-fetching
          lastDiscoverFetchDateRef.current = today;
          setDiscoverError(t('discover:errors.failed_recommendations'));
        }
      } finally {
        fetchingRef.current = false;
        if (!waitingForLocation) {
          setDiscoverLoading(false);
        }
      }
    };

    fetchDiscoverRecommendations();
  }, [locationLat, locationLng, user?.id, isDiscoverCacheMigrationReady, userSelectedCategories, userTravelMode, preferencesRefreshKey, discoverRetryKey]);

  // Use Discover-specific recommendations
  const recommendations = discoverRecommendations;
  const recommendationsLoading = discoverLoading;
  // Map removed — Near You tab is now a blank slate (ORCH-0436)
  const recommendationsError = discoverError;
  const hasCompletedInitialFetch = hasCompletedDiscoverFetch;

  // Transform Recommendation to FeaturedCardData
  const transformToFeaturedCard = (rec: Recommendation): FeaturedCardData => ({
    id: rec.id,
    title: rec.title,
    experienceType: rec.category,
    description: rec.description,
    image: rec.image,
    images: rec.images,
    priceRange: rec.priceRange,
    rating: rec.rating,
    reviewCount: rec.reviewCount,
    address: rec.address,
    travelTime: rec.travelTime,
    distance: rec.distance,
    highlights: rec.highlights,
    tags: rec.tags,
    location: rec.lat && rec.lng ? { lat: rec.lat, lng: rec.lng } : undefined,
    openingHours: rec.openingHours || null,
  });

  // Transform Recommendation to GridCardData
  const transformToGridCard = (rec: Recommendation): GridCardData => ({
    id: rec.id,
    title: rec.title,
    category: rec.category,
    description: rec.description,
    image: rec.image,
    images: rec.images,
    priceRange: rec.priceRange,
    rating: rec.rating,
    reviewCount: rec.reviewCount,
    address: rec.address,
    travelTime: rec.travelTime,
    distance: rec.distance,
    highlights: rec.highlights,
    tags: rec.tags,
    location: rec.lat && rec.lng ? { lat: rec.lat, lng: rec.lng } : undefined,
    openingHours: rec.openingHours || null,
    website: rec.website || null,
    phone: rec.phone || null,
  });

  // State for selected cards (to prevent re-randomization on every render)
  const [selectedHeroCards, setSelectedHeroCards] = useState<FeaturedCardData[]>([]);
  const [selectedFeaturedCard, setSelectedFeaturedCard] = useState<FeaturedCardData | null>(null);
  const [selectedGridCards, setSelectedGridCards] = useState<GridCardData[]>([]);
  const previousRecommendationsLengthRef = useRef<number>(0);

  // Organize recommendations: 1 random hero + 1 from each category
  // Only re-select when recommendations actually change (skip if loaded from cache)
  useEffect(() => {
    if (!recommendations || recommendations.length === 0) {
      setSelectedFeaturedCard(null);
      setSelectedGridCards([]);
      previousRecommendationsLengthRef.current = 0;
      return;
    }

    // Skip re-randomization if we loaded from cache (cards already restored)
    if (loadedFromCacheRef.current) {
      console.log("Skipping card selection - loaded from cache");
      previousRecommendationsLengthRef.current = recommendations.length;
      loadedFromCacheRef.current = false; // Reset flag for future updates
      return;
    }

    // Skip re-randomization if hero cards were already set by the API fetch path
    // (the fetch path sets selectedHeroCards directly — this useEffect must not overwrite them)
    if (selectedHeroCards.length > 0) {
      console.log("Skipping card selection - hero cards already set by API fetch");
      previousRecommendationsLengthRef.current = recommendations.length;
      return;
    }

    // Only re-select if recommendations changed (check by length and first ID)
    if (
      previousRecommendationsLengthRef.current === recommendations.length &&
      selectedFeaturedCard !== null
    ) {
      return; // Already selected, don't re-randomize
    }

    previousRecommendationsLengthRef.current = recommendations.length;

    // Keep all recommendations for filling categories
    const allRecommendations = [...recommendations];

    // Build a map of ALL recommendations by category for quick lookup
    const categoriesMap = new Map<string, Recommendation[]>();
    allRecommendations.forEach((rec) => {
      const category = rec.category;
      if (!categoriesMap.has(category)) {
        categoriesMap.set(category, []);
      }
      categoriesMap.get(category)!.push(rec);
    });

    // Debug: Log available categories
    const availableCategories = Array.from(categoriesMap.keys());
    console.log("Available categories from API:", availableCategories);
    console.log("Total recommendations:", allRecommendations.length);

    // Pick 1 random hero experience
    const randomIndex = Math.floor(Math.random() * allRecommendations.length);
    const heroRecommendation = allRecommendations[randomIndex];
    const featured = transformToFeaturedCard(heroRecommendation);

    // STRICT: Pick exactly 1 experience per UNIQUE category first, then fill to reach 10
    const grid: GridCardData[] = [];
    const usedIds = new Set([heroRecommendation.id]);
    const usedCategories = new Set<string>(); // Track used categories

    // FIRST PASS: Get one card per available category (maximize diversity)
    // Shuffle the available categories for randomness
    const shuffledCategories = [...availableCategories].sort(() => Math.random() - 0.5);

    for (const category of shuffledCategories) {
      if (grid.length >= 10) break;
      
      // Skip if we already have a card from this category
      if (usedCategories.has(category)) continue;
      
      const categoryRecs = categoriesMap.get(category) || [];
      const availableRecs = categoryRecs.filter((rec) => !usedIds.has(rec.id));
      
      if (availableRecs.length > 0) {
        // Pick a random one from this category
        const randomCatIndex = Math.floor(Math.random() * availableRecs.length);
        const selectedRec = availableRecs[randomCatIndex];
        grid.push(transformToGridCard(selectedRec));
        usedIds.add(selectedRec.id);
        usedCategories.add(category); // Mark this category as used
        console.log(`Added card from category: "${category}"`);
      }
    }

    console.log(`After first pass: ${grid.length} cards from ${usedCategories.size} unique categories`);

    // SECOND PASS: If we don't have 10 cards yet, fill from remaining recommendations
    // Prioritize categories with fewest cards in grid to maximize diversity
    if (grid.length < 10) {
      const remainingRecs = allRecommendations.filter((rec) => !usedIds.has(rec.id));
      console.log(`Filling remaining ${10 - grid.length} slots from ${remainingRecs.length} remaining recs`);
      
      // Count how many cards per category we have
      const categoryCount = new Map<string, number>();
      grid.forEach((card) => {
        const count = categoryCount.get(card.category) || 0;
        categoryCount.set(card.category, count + 1);
      });
      
      // Sort remaining by category count (prefer least-used categories for diversity)
      const sortedByDiversity = [...remainingRecs].sort((a, b) => {
        const countA = categoryCount.get(a.category) || 0;
        const countB = categoryCount.get(b.category) || 0;
        if (countA !== countB) return countA - countB; // Prefer less-used categories
        return Math.random() - 0.5; // Random within same count
      });
      
      for (const rec of sortedByDiversity) {
        if (grid.length >= 10) break;
        grid.push(transformToGridCard(rec));
        usedIds.add(rec.id);
        const count = categoryCount.get(rec.category) || 0;
        categoryCount.set(rec.category, count + 1);
        console.log(`Filled slot with category: ${rec.category} (now ${count + 1} cards from this category)`);
      }
    }

    console.log(`Final grid: ${grid.length} cards`);
    console.log("Categories used:", Array.from(usedCategories));

    setSelectedFeaturedCard(featured);
    setSelectedGridCards(grid);

    // CACHING DISABLED FOR TESTING
    // Save to cache for daily persistence
    // saveDiscoverCache(recommendations, featured, grid);
  }, [recommendations]);

  // Use the stable selected cards
  const featuredCard = selectedFeaturedCard;
  const gridCards = selectedGridCards;

  // Night Out: cache + fetch logic
  interface NightOutCache {
    date: string;
    venues: NightOutCardData[];
    genre: string;
  }

  // Include GPS location AND genre in cache key so changing filters gets fresh results
  const nightOutCacheKey = `${NIGHT_OUT_CACHE_KEY}_${user?.id}_${nightOutGpsLat?.toFixed(2)}_${nightOutGpsLng?.toFixed(2)}_${selectedFilters.genre}`;

  const saveNightOutCache = async (venues: NightOutCardData[]) => {
    if (!user?.id) return;
    try {
      const cacheData: NightOutCache = { date: getTodayDateString(), venues, genre: selectedFilters.genre };
      await AsyncStorage.setItem(nightOutCacheKey, JSON.stringify(cacheData));
      console.log("Saved night-out cache:", venues.length, "events");
    } catch (err) {
      console.error("Error saving night-out cache:", err);
    }
  };

  const clearNightOutCache = async () => {
    try {
      await AsyncStorage.removeItem(nightOutCacheKey);
      console.log("Cleared night-out cache");
    } catch (err) {
      console.error("Error clearing night-out cache:", err);
    }
  };

  const loadNightOutCache = async (): Promise<NightOutCache | null> => {
    if (!user?.id) return null;
    try {
      const raw = await AsyncStorage.getItem(nightOutCacheKey);
      if (raw) return JSON.parse(raw) as NightOutCache;
    } catch (err) {
      console.error("Error loading night-out cache:", err);
    }
    return null;
  };

  // Transform NightOutVenue -> NightOutCardData (types nearly match now)
  const transformNightOutVenue = (venue: NightOutVenue): NightOutCardData => ({
    id: venue.id,
    eventName: venue.eventName,
    artistName: venue.artistName,
    venueName: venue.venueName,
    image: venue.image,
    images: venue.images,
    price: venue.price,
    priceMin: venue.priceMin,
    priceMax: venue.priceMax,
    date: venue.date,
    time: venue.time,
    localDate: venue.localDate,
    location: venue.location,
    tags: venue.tags,
    genre: venue.genre || undefined,
    subGenre: venue.subGenre || undefined,
    address: venue.address,
    coordinates: venue.coordinates,
    ticketUrl: venue.ticketUrl,
    ticketStatus: venue.ticketStatus,
    distance: venue.distance,
  });

  // Debounce ref for filter changes
  const nightOutFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fetchNightOutEvents = async () => {
      if (!nightOutGpsLat || !nightOutGpsLng) return;

      setNightOutLoading(true);
      setNightOutError(null);

      try {
        // Check cache first
        const cached = await loadNightOutCache();
        if (cached && cached.date === getTodayDateString() && cached.venues.length > 0 && cached.genre === selectedFilters.genre) {
          console.log("Night-out cache hit:", cached.venues.length, "events");
          setNightOutCards(cached.venues);
          setNightOutLoading(false);
          return;
        }

        console.log("Night-out cache miss. Fetching Ticketmaster events...");
        const { startDate, endDate } = getDateRange(selectedFilters.date);
        const { events } = await NightOutExperiencesService.getEvents(
          { lat: nightOutGpsLat, lng: nightOutGpsLng },
          {
            radius: 50,
            keywords: GENRE_TO_KEYWORDS[selectedFilters.genre],
            startDate,
            endDate,
            sort: "date,asc",
          }
        );

        const cards = events.map(transformNightOutVenue);
        setNightOutCards(cards);
        saveNightOutCache(cards);
      } catch (err) {
        console.error("Error fetching night-out events:", err);
        setNightOutError(t('discover:errors.failed_events'));
      } finally {
        setNightOutLoading(false);
      }
    };

    // Debounce to avoid rapid re-fetches during filter changes
    if (nightOutFetchTimeoutRef.current) {
      clearTimeout(nightOutFetchTimeoutRef.current);
    }
    nightOutFetchTimeoutRef.current = setTimeout(() => {
      if (activeTab === "night-out" || nightOutGpsLat) {
        fetchNightOutEvents();
      }
    }, 300);

    return () => {
      if (nightOutFetchTimeoutRef.current) {
        clearTimeout(nightOutFetchTimeoutRef.current);
      }
    };
  }, [nightOutGpsLat, nightOutGpsLng, activeTab, selectedFilters.genre, selectedFilters.date]);

  // Transform FeaturedCardData to ExpandedCardData
  const handleCardPress = (card: FeaturedCardData) => {
    // Fallback: look up openingHours from recommendations if card doesn't have it
    const openingHours = card.openingHours || (
      recommendations.find(r => r.id === card.id || r.id === card.id.replace('_featured', ''))?.openingHours
    ) || null;
    const expandedCardData: ExpandedCardData = {
      id: card.id,
      placeId: card.placeId || card.id,
      title: card.title,
      category: card.experienceType,
      categoryIcon: "walk-outline",
      description: card.description,
      fullDescription: card.description,
      image: card.image,
      images: card.images?.length ? card.images : [card.image].filter(Boolean),
      rating: card.rating,
      reviewCount: card.reviewCount || 0,
      priceRange: card.priceRange,
      distance: card.distance || "",
      travelTime: card.travelTime || "",
      address: card.address || "",
      highlights: card.highlights || [],
      tags: card.tags || [],
      matchScore: 85,
      matchFactors: {
        location: 90,
        budget: 85,
        category: 80,
        time: 85,
        popularity: 88,
      },
      socialStats: {
        views: 1200,
        likes: 340,
        saves: 89,
        shares: 45,
      },
      location: card.location,
      openingHours,
      selectedDateTime: new Date(),
      website: card.website || undefined,
      phone: card.phone || undefined,
      priceTier: (card as any).priceTier as ExpandedCardData['priceTier'],
    };
    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  // Transform GridCardData to ExpandedCardData — For You grid cards
  const handleGridCardPress = (card: GridCardData) => {
    console.log(`[Discover] Grid card pressed: "${card.title}" | website=${card.website || 'NULL'} | phone=${card.phone || 'NULL'}`);
    // Fallback: look up openingHours from recommendations if card doesn't have it
    const openingHours = card.openingHours || (
      recommendations.find(r => r.id === card.id)?.openingHours
    ) || null;
    const expandedCardData: ExpandedCardData = {
      id: card.id,
      placeId: card.placeId || card.id,
      title: card.title,
      category: card.category,
      categoryIcon: categoryIcons[card.category] || "ellipse-outline",
      description: card.description,
      fullDescription: card.description,
      image: card.image,
      images: card.images?.length ? card.images : [card.image].filter(Boolean),
      rating: card.rating,
      reviewCount: card.reviewCount || 0,
      priceRange: card.priceRange,
      distance: card.distance || "",
      travelTime: card.travelTime || "",
      address: card.address || "",
      highlights: card.highlights || [],
      tags: card.tags || [],
      matchScore: 85,
      matchFactors: {
        location: 90,
        budget: 85,
        category: 80,
        time: 85,
        popularity: 88,
      },
      socialStats: {
        views: 800,
        likes: 220,
        saves: 56,
        shares: 28,
      },
      location: card.location,
      openingHours,
      selectedDateTime: new Date(),
      website: card.website || undefined,
      phone: card.phone || undefined,
      priceTier: (card as any).priceTier as ExpandedCardData['priceTier'],
    };
    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  // Transform NightOutCardData to ExpandedCardData
  const handleNightOutCardPress = (card: NightOutCardData) => {
    const expandedCardData: ExpandedCardData = {
      id: card.id,
      title: card.eventName,
      category: "Night Out",
      categoryIcon: "moon-outline",
      description: `${card.artistName} at ${card.venueName}`,
      fullDescription: `${card.artistName} at ${card.venueName} — ${card.date} at ${card.time}`,
      image: card.image,
      images: card.images?.length ? card.images : [card.image].filter(Boolean),
      rating: 0,
      reviewCount: 0,
      priceRange: card.price,
      distance: card.distance
        ? parseAndFormatDistance(`${card.distance.toFixed(1)} km`, accountPreferences?.measurementSystem)
        : "",
      travelTime: "",
      address: card.address || card.location,
      highlights: [card.venueName, card.artistName, card.price].filter(Boolean),
      tags: card.tags,
      matchScore: 0,
      matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
      location: card.coordinates,
      nightOutData: {
        eventName: card.eventName,
        venueName: card.venueName,
        artistName: card.artistName,
        date: card.date,
        time: card.time,
        price: card.price,
        genre: card.genre,
        subGenre: card.subGenre,
        tags: card.tags,
        coordinates: card.coordinates,
        ticketUrl: card.ticketUrl,
        ticketStatus: card.ticketStatus,
      },
    };
    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  const handleCloseExpandedModal = () => {
    setIsExpandedModalVisible(false);
    setSelectedCardForExpansion(null);
    expandedCardListRef.current = [];
    setExpandedCardIndex(null);
  };

  // Night Out Filter Modal handlers
  const handleOpenFilterModal = () => {
    setIsFilterModalVisible(true);
  };

  const handleCloseFilterModal = () => {
    setIsFilterModalVisible(false);
  };

  // Derive the genre label for confirmation display
  const getGenreLabel = (id: GenreFilter): string => {
    const opt = genreFilterOptions.find((o) => o.id === id);
    return opt?.label || t('discover:filters.all_genres');
  };

  // Filter night-out cards and sort by nearest date
  const filteredNightOutCards = useMemo(() => {
    let filtered = nightOutCards;

    // Price filter (client-side only — genre and date are server-side now)
    if (selectedFilters.price !== "any") {
      filtered = filtered.filter((card) => {
        if (card.priceMin === null && card.priceMax === null) return false; // TBA → hide
        const min = card.priceMin || 0;
        const max = card.priceMax || min;
        switch (selectedFilters.price) {
          case "free": return max === 0;
          case "under-25": return min < 25;
          case "25-50": return min <= 50 && max >= 25;
          case "50-100": return min <= 100 && max >= 50;
          case "over-100": return max > 100;
          default: return true;
        }
      });
    }

    // Sort by nearest date (localDate is YYYY-MM-DD)
    filtered = [...filtered].sort((a, b) => {
      const dateA = a.localDate || "9999-12-31";
      const dateB = b.localDate || "9999-12-31";
      return dateA.localeCompare(dateB);
    });

    return filtered;
  }, [nightOutCards, selectedFilters.price]);

  // Count active filters (non-default values)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedFilters.date !== "any") count++;
    if (selectedFilters.price !== "any") count++;
    if (selectedFilters.genre !== "all") count++;
    return count;
  }, [selectedFilters]);

  const handleApplyFilters = () => {
    console.log("Applying filters:", selectedFilters);
    handleCloseFilterModal();
  };

  const handleResetFilters = () => {
    setSelectedFilters({
      date: "any",
      price: "any",
      genre: "all",
    });
  };

  // Currency symbol helper
  const getCurrencySymbol = (currencyCode: string = "USD"): string => {
    const symbols: { [key: string]: string } = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
      NGN: "₦",
      CAD: "CA$",
      AUD: "A$",
    };
    return symbols[currencyCode] || "$";
  };




  const currencySymbol = getCurrencySymbol(accountPreferences?.currency);

  // Filter options
  const dateFilterOptions: { id: DateFilter; label: string }[] = [
    { id: "any", label: t('discover:filters.any_date') },
    { id: "today", label: t('discover:filters.today') },
    { id: "tomorrow", label: t('discover:filters.tomorrow') },
    { id: "weekend", label: t('discover:filters.this_weekend') },
    { id: "next-week", label: t('discover:filters.next_week') },
    { id: "month", label: t('discover:filters.this_month') },
  ];

  const cRate = getCurrencyRate(accountPreferences?.currency);
  const cp = (usd: number) => Math.round(usd * cRate).toLocaleString();

  // PRICE_TIERS already includes slug `any`; omit it here so list keys stay unique (duplicate `any` broke the filter modal).
  const priceFilterOptions: { id: PriceFilter; label: string }[] = [
    { id: "any", label: t('discover:filters.any_price') },
    ...PRICE_TIERS.filter((tier) => tier.slug !== "any").map((tier) => ({
      id: tier.slug as PriceFilter,
      label: `${t(`common:tier_${tier.slug}`)} · ${t(`common:tier_range_${tier.slug}`)}`,
    })),
  ];

  const genreFilterOptions: { id: GenreFilter; label: string }[] = [
    { id: "all", label: t('discover:filters.all_genres') },
    { id: "afrobeats", label: t('discover:filters.afrobeats') },
    { id: "dancehall", label: t('discover:filters.dancehall') },
    { id: "hiphop-rnb", label: t('discover:filters.hiphop_rnb') },
    { id: "house", label: t('discover:filters.house') },
    { id: "techno", label: t('discover:filters.techno') },
    { id: "jazz-blues", label: t('discover:filters.jazz_blues') },
    { id: "latin-salsa", label: t('discover:filters.latin_salsa') },
    { id: "reggae", label: t('discover:filters.reggae') },
    { id: "kpop", label: t('discover:filters.kpop') },
    { id: "acoustic-indie", label: t('discover:filters.acoustic_indie') },
  ];

  // ORCH-0436: mapCenterTrigger removed — map no longer rendered











  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Tabs */}
        <DiscoverTabs activeTab={activeTab} onTabChange={(tab) => {
          setActiveTab(tab);
          mixpanelService.trackTabViewed({ screen: "Discover", tab: tab === "near-you" ? "Near You" : "Night Out" });
        }} />

        {/* Content */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={[styles.contentContainer, activeTab === 'near-you' && { flex: 1, padding: 0, paddingBottom: 0 }]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={activeTab !== 'near-you'}
        >
          {activeTab === "near-you" && (
            <View style={styles.mapFullscreen}>
              {/* ORCH-0436: Blank slate — future content TBD */}
              <View style={{ flex: 1 }} />
              <ActivityStatusPicker
                currentStatus={mapSettings?.activity_status || null}
                visibility={mapSettings?.visibility_level || 'friends'}
                onVisibilityChange={async (level) => {
                  await updateMapSettings({ visibility_level: level });
                }}
                onSetStatus={async (status) => {
                  await updateMapSettings({
                    activity_status: status,
                    activity_status_expires_at: null,
                  });
                }}
              />
            </View>
          )}

          {activeTab === "night-out" && (
            <View style={styles.nightOutContent}>
              {/* Filter Button */}
              <TouchableOpacity
                style={styles.filterButton}
                onPress={handleOpenFilterModal}
                activeOpacity={0.7}
              >
                <View style={styles.filterButtonLeft}>
                  <Icon name="filter" size={18} color="#eb7825" />
                  <Text style={styles.filterButtonText}>{t('discover:filters.button')}</Text>
                  {activeFilterCount > 0 && (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                    </View>
                  )}
                </View>
                <Icon name="chevron-right" size={20} color="#6b7280" />
              </TouchableOpacity>

              {/* Active genre filter confirmation */}
              {selectedFilters.genre !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Icon name="music" size={14} color="#eb7825" />
                  <Text style={styles.activeFilterChipText}>
                    {t('discover:filters.showing', { genre: getGenreLabel(selectedFilters.genre) })}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedFilters({ ...selectedFilters, genre: "all" })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="x" size={16} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Loading State */}
              {nightOutLoading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#eb7825" />
                  <Text style={styles.loadingText}>{t('discover:loading.nightlife')}</Text>
                </View>
              )}

              {/* Error State */}
              {nightOutError && !nightOutLoading && (
                <View style={styles.emptyStateContainer}>
                  <Icon name="alert-circle-outline" size={48} color="#ef4444" />
                  <Text style={styles.emptyStateTitle}>{t('discover:error.title')}</Text>
                  <Text style={styles.emptyStateSubtitle}>{nightOutError}</Text>
                  <TouchableOpacity
                    style={{ marginTop: 12, paddingVertical: 8, paddingHorizontal: 20, backgroundColor: "#eb7825", borderRadius: 8 }}
                    onPress={async () => {
                      setNightOutLoading(true);
                      setNightOutError(null);
                      setNightOutCards([]);
                      await clearNightOutCache();
                      deviceGpsFetchedRef.current = false;
                      // Re-fetch GPS location
                      try {
                        const loc = await enhancedLocationService.getCurrentLocation();
                        if (loc) {
                          setDeviceGpsLat(loc.latitude);
                          setDeviceGpsLng(loc.longitude);
                        }
                      } catch (_) {}
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600" }}>{t('discover:error.retry')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Empty State - No data at all */}
              {!nightOutLoading && !nightOutError && nightOutCards.length === 0 && (
                <View style={styles.emptyStateContainer}>
                  <Icon name="moon-outline" size={48} color="#eb7825" />
                  <Text style={styles.emptyStateTitle}>{t('discover:empty.no_events')}</Text>
                  <Text style={styles.emptyStateSubtitle}>{t('discover:empty.no_events_nearby')}</Text>
                </View>
              )}

              {/* Empty State - Filters produced no results */}
              {!nightOutLoading && !nightOutError && nightOutCards.length > 0 && filteredNightOutCards.length === 0 && (
                <View style={styles.emptyStateContainer}>
                  <Icon name="sliders" size={48} color="#eb7825" />
                  <Text style={styles.emptyStateTitle}>{t('discover:empty.no_matching')}</Text>
                  <Text style={styles.emptyStateSubtitle}>
                    {t('discover:empty.no_matching_filters')}
                  </Text>
                  <TouchableOpacity
                    style={styles.showAllPartiesButton}
                    onPress={() => setSelectedFilters({ date: "any", price: "any", genre: "all" })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.showAllPartiesText}>{t('discover:empty.show_all_parties')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Night Out Cards (filtered) */}
              {!nightOutLoading && filteredNightOutCards.map((card) => (
                <NightOutCard
                  key={card.id}
                  card={card}
                  currency={accountPreferences?.currency}
                  onPress={() => handleNightOutCardPress(card)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Expanded Card Modal */}
      <ExpandedCardModal
        visible={isExpandedModalVisible}
        card={selectedCardForExpansion}
        onClose={handleCloseExpandedModal}
        onSave={async (card) => {
          if (!user) return;
          try {
            await savedCardsService.saveCard(user.id, card, "solo");
            prefetchQueryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            handleCloseExpandedModal();
          } catch (error: any) {
            if (error?.code === "23505") {
              handleCloseExpandedModal();
            }
            throw error;
          }
        }}
        onShare={(card) => {
          // Share not implemented for paired person view
        }}
        isSaved={mapSavedCardIds.has(selectedCardForExpansion?.id ?? "")}
        currentMode="solo"
        accountPreferences={accountPreferences}
        navigationIndex={expandedCardIndex ?? undefined}
        navigationTotal={expandedCardListRef.current.length > 1 ? expandedCardListRef.current.length : undefined}
        onNavigateNext={expandedCardIndex != null && expandedCardIndex < expandedCardListRef.current.length - 1 ? () => {
          const next = expandedCardIndex + 1;
          setExpandedCardIndex(next);
          setSelectedCardForExpansion(expandedCardListRef.current[next]);
        } : undefined}
        onNavigatePrevious={expandedCardIndex != null && expandedCardIndex > 0 ? () => {
          const prev = expandedCardIndex - 1;
          setExpandedCardIndex(prev);
          setSelectedCardForExpansion(expandedCardListRef.current[prev]);
        } : undefined}
        canAccessCurated={canAccess('curated_cards')}
        onPaywallRequired={() => {
          handleCloseExpandedModal();
          setPaywallFeature('curated_cards');
          setShowPaywall(true);
        }}
      />

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
      />

      {/* Night Out Filter Modal */}
      <Modal
        visible={isFilterModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCloseFilterModal}
      >
        <View style={styles.filterModalOverlay}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={handleCloseFilterModal}
          />
          <View style={styles.filterModalContent}>
            {/* Modal Header */}
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>{t('discover:filters.title')}</Text>
              <TouchableOpacity
                onPress={handleCloseFilterModal}
                style={styles.modalCloseButton}
              >
                <Icon name="x" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.filterModalScrollView}
              showsVerticalScrollIndicator={false}
            >
              {/* Date Filter Section */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="calendar" size={20} color="#eb7825" />
                  <Text style={styles.filterSectionTitle}>{t('discover:filters.date')}</Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {dateFilterOptions.map((option) => (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.filterOptionBadge,
                        selectedFilters.date === option.id && styles.filterOptionBadgeSelected,
                      ]}
                      onPress={() => setSelectedFilters({ ...selectedFilters, date: option.id })}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.filterOptionText,
                          selectedFilters.date === option.id && styles.filterOptionTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Price Filter Section */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="tag" size={20} color="#eb7825" />
                  <Text style={styles.filterSectionTitle}>{t('discover:filters.price_range')}</Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {priceFilterOptions.map((option) => (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.filterOptionBadge,
                        selectedFilters.price === option.id && styles.filterOptionBadgeSelected,
                      ]}
                      onPress={() => setSelectedFilters({ ...selectedFilters, price: option.id })}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.filterOptionText,
                          selectedFilters.price === option.id && styles.filterOptionTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Music Genre Filter Section */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Icon name="music" size={20} color="#eb7825" />
                  <Text style={styles.filterSectionTitle}>{t('discover:filters.music_genre')}</Text>
                </View>
                <View style={styles.filterOptionsGrid}>
                  {genreFilterOptions.map((option) => (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.filterOptionBadge,
                        selectedFilters.genre === option.id && styles.filterOptionBadgeSelected,
                      ]}
                      onPress={() => setSelectedFilters({ ...selectedFilters, genre: option.id })}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.filterOptionText,
                          selectedFilters.genre === option.id && styles.filterOptionTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.filterButtonsContainer}>
              <TouchableOpacity
                style={styles.resetFilterButton}
                onPress={handleResetFilters}
                activeOpacity={0.7}
              >
                <Text style={styles.resetFilterButtonText}>{t('discover:filters.reset')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.applyFilterButton}
                onPress={handleApplyFilters}
                activeOpacity={0.7}
              >
                <Text style={styles.applyFilterButtonText}>{t('discover:filters.apply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  heroCardsContainer: {
    marginBottom: 16,
    gap: 12,
  },
  heroCardsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  heroCard: {
    width: HERO_CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  heroCardImageContainer: {
    position: "relative",
    height: 180,
  },
  heroCardImage: {
    width: "100%",
    height: "100%",
  },
  heroCardCategoryBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  heroCardCategoryText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#eb7825",
  },
  heroCardContent: {
    padding: 12,
  },
  heroCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
    lineHeight: 20,
  },
  heroCardDescription: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 16,
    marginBottom: 8,
  },
  heroCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroCardPrice: {
    fontSize: 13,
    fontWeight: "600",
    color: "#eb7825",
  },
  heroCardRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  heroCardRatingText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1f2937",
  },
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  // Tab Header styles (for "For You" tab)
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },
  tabHeaderScrollView: {
    marginBottom: 16,
    marginHorizontal: -16,
  },
  mapFullscreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  mapHidden: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    pointerEvents: 'none' as const,
  },
  floatingPillBar: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    zIndex: 20,
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 0,
    marginHorizontal: 0,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  tabHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
    borderRadius: 20,
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  addUserButton: {
    padding: 8,
  },
  // Tabs styles
  tabsWrapper: {
    backgroundColor: "#FFFFFF",
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: "#eb7825",
  },
  tabContent: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6B7280",
  },
  tabLabelActive: {
    color: "#eb7825",
  },
  // Content styles
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  // Featured Card styles
  featuredCard: {
    backgroundColor: "white",
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 16,
  },
  cardImageContainer: {
    position: "relative",
    height: 260,
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  featuredBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "#eb7825",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  featuredBadgeText: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
  },
  travelInfoContainer: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    gap: 8,
  },
  travelInfoBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  travelInfoText: {
    color: "white",
    fontSize: 12,
    fontWeight: "500",
  },
  cardContent: {
    padding: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },
  experienceType: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: 12,
  },
  cardDescription: {
    fontSize: 15,
    color: "#374151",
    lineHeight: 22,
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceRange: {
    fontSize: 16,
    fontWeight: "600",
    color: "#eb7825",
  },
  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2937",
  },
  // Grid Cards styles
  gridCardsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 8,
  },
  gridCard: {
    width: GRID_CARD_WIDTH,
    height: 240,
    backgroundColor: "white",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 16,
  },
  gridCardImageContainer: {
    position: "relative",
    height: 130,
  },
  gridCardImage: {
    width: "100%",
    height: "100%",
  },
  categoryIconBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "white",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  gridCardContent: {
    padding: 12,
  },
  gridCardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
    lineHeight: 18,
    minHeight: 36, // Reserve space for 2 lines (18 * 2)
  },
  gridCardCategory: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: 8,
  },
  gridCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  gridCardPrice: {
    fontSize: 11,
    fontWeight: "400",
    color: "#eb7825",
  },
  gridCardRatingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  gridCardRatingText: {
    fontSize: 11,
    fontWeight: "400",
    color: "#1f2937",
  },
  gridCardArrowButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  // Night out content styles
  nightOutContent: {
    flex: 1,
    gap: 16,
  },
  // Filter Button styles
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  filterButtonLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filterButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  filterBadge: {
    backgroundColor: "#eb7825",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  filterBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  activeFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  activeFilterChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: "#9A3412",
  },
  showAllPartiesButton: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: "#eb7825",
    borderRadius: 10,
  },
  showAllPartiesText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  // Night Out Card styles
  nightOutCard: {
    backgroundColor: "white",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    marginBottom: 10,
  },
  nightOutCardRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    gap: 10,
  },
  nightOutThumbWrap: {
    position: "relative",
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "hidden",
  },
  nightOutThumb: {
    width: "100%",
    height: "100%",
  },
  nightOutStatusDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "white",
  },
  nightOutInfo: {
    flex: 1,
    gap: 2,
  },
  nightOutTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  nightOutArtist: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  nightOutMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 1,
  },
  nightOutMetaText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6b7280",
    flexShrink: 1,
  },
  nightOutMetaDot: {
    fontSize: 11,
    color: "#d1d5db",
    marginHorizontal: 2,
  },
  nightOutRight: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 4,
    paddingLeft: 4,
    minWidth: 60,
  },
  nightOutPrice: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
    textAlign: "right",
  },
  nightOutStatusLabel: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "right",
  },
  nightOutTagStrip: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 8,
    paddingTop: 0,
  },
  nightOutTagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FEF3E7",
    borderWidth: 1,
    borderColor: "#fcd9b6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  nightOutTagLabel: {
    fontSize: 10,
    fontWeight: "500",
    color: "#eb7825",
  },
  matchBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  matchBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  nightOutPriceBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "#eb7825",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  nightOutPriceBadgeText: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
  },
  placeInfoStack: {
    position: "absolute",
    bottom: 10,
    left: 12,
    right: 12,
    gap: 4,
  },
  placeNameText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  dateTimeRow: {
    flexDirection: "row",
    gap: 8,
  },
  infoBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  infoBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "500",
  },
  emptyStateContainer: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1f2937",
    marginTop: 8,
  },
  emptyStateSubtitle: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 8,
  },
  // Saved People Pills styles
  peoplePillsContainer: {
    marginBottom: 16,
    marginHorizontal: -16,
  },
  peoplePillsContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  personPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e5e7eb",
    borderColor: "#d1d5db",
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  personPillSelected: {
    backgroundColor: "#FEF3E7",
    borderColor: "#eb7825",
  },
  personPillAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  linkedBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
  },
  personPillAvatarSelected: {
    backgroundColor: "#eb7825",
    borderRadius: 14,
  },
  personPillInitials: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
  },
  personPillInitialsSelected: {
    color: "white",
  },
  personPillName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    maxWidth: 80,
  },
  personPillNameSelected: {
    color: "#eb7825",
  },
  // Orange gradient selected styles
  personPillSelectedGradient: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  personPillAvatarSelectedGradient: {
    backgroundColor: "#eb7825",
  },
  personPillNameSelectedGradient: {
    color: "white",
  },
  addUserButtonPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEF3E7",
    borderWidth: 2,
    borderColor: "#fcd9b6",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 4,
    marginRight: 4,
  },
  personPillTouchable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  personPillRemoveButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 4,
  },
  personPillRemoveButtonSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  pillAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  pendingPillBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingPillBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f97316',
  },
  incomingRequestPill: {
    borderWidth: 2,
    borderColor: '#fb923c',
  },
  incomingDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: s(10),
    height: s(10),
    borderRadius: s(5),
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  // Error styles
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
  },
  addPersonInputError: {
    borderColor: "#ef4444",
  },
  addPersonBottomSheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  addPersonBottomSheetContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    width: "100%",
    maxHeight: "90%",
  },
  addPersonSheetHandleContainer: {
    alignItems: "center",
    marginBottom: 12,
  },
  addPersonSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  // Add Person Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  addPersonModalContent: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  addPersonModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    marginBottom: 16,
  },
  addPersonHeaderCenter: {
    flex: 1,
    alignItems: "center",
  },
  addPersonModalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  addPersonModalSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginTop: 2,
  },
  addPersonDescription: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
    marginBottom: 20,
  },
  modalCloseButton: {
    padding: 4,
  },
  addPersonCloseButtonPlaceholder: {
    width: 32,
    height: 32,
  },
  customDayCloseButtonPlaceholder: {
    width: 32,
    height: 32,
  },
  addPersonFieldContainer: {
    marginBottom: 20,
  },
  addPersonFieldLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 8,
  },
  addPersonInput: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#eb7825",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#111827",
  },
  addPersonBirthdayInput: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  birthdayText: {
    fontSize: 16,
    color: "#111827",
  },
  birthdayPlaceholder: {
    fontSize: 16,
    color: "#9ca3af",
  },
  datePickerContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  datePickerDoneButton: {
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#eb7825",
  },
  genderOptionsContainer: {
    flexDirection: "row",
    gap: 12,
  },
  genderOption: {
    flex: 1,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: "center",
  },
  genderOptionSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  genderOptionText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  genderOptionTextSelected: {
    color: "white",
  },
  personDescriptionInput: {
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 14,
    color: "#FFFFFF",
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: "#374151",
  },
  addPersonHint: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 8,
  },
  charCount: {
    fontSize: 11,
    color: "#6B7280",
    textAlign: "right" as const,
    marginTop: 4,
  },
  addPersonButtonsContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  addPersonButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  addPersonButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  // Add Custom Day Modal styles
  customDayModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    marginBottom: 20,
  },
  customDayHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    justifyContent: "center",
  },
  customDayHeaderTextCenter: {
    alignItems: "center",
  },
  customDayIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  requiredAsterisk: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "600",
  },
  descriptionInput: {
    height: 80,
    paddingTop: 12,
  },
  customDayDescriptionInput: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    height: 80,
    textAlignVertical: "top",
  },
  customDayCategoryHint: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
  },
  customDayCategoryPillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  customDayCategoryPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  customDayCategoryPillSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  customDayCategoryPillText: {
    fontSize: 13,
    color: "#374151",
    fontWeight: "500",
  },
  customDayCategoryPillTextSelected: {
    color: "#eb7825",
    fontWeight: "600",
  },
  customDayBottomSheetContent: {
    height: "88%",
  },
  customDayModalScrollContent: {
    paddingBottom: 12,
  },
  addCustomDayButton: {
    flexDirection: "row",
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  addCustomDayButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  categoryPickerContainer: {
    marginTop: 8,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  categoryPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  categoryPickerItemSelected: {
    backgroundColor: "#fff7ed",
  },
  categoryPickerItemText: {
    fontSize: 14,
    color: "#374151",
  },
  categoryPickerItemTextSelected: {
    color: "#eb7825",
    fontWeight: "600",
  },
  // Filter Modal styles
  filterModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  filterModalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    width: "100%",
    maxHeight: "80%",
  },
  filterModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  filterModalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  filterModalScrollView: {
    flexGrow: 0,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  filterOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  filterOptionBadge: {
    width: "48%",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  filterOptionBadgeSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  filterOptionText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  filterOptionTextSelected: {
    color: "white",
  },
  filterButtonsContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
    paddingTop: 16,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  resetFilterButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  resetFilterButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  applyFilterButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  applyFilterButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  // Person-specific view styles
  showingRecommendationsText: {
    fontSize: 12,
    color: "#374151",
    textAlign: "center",
    marginBottom: 16,
  },
  showingRecommendationsName: {
    fontWeight: "600",
    color: "#eb7825",
  },
  // Birthday Hero Card styles
  birthdayHeroCard: {
    backgroundColor: "#eb7825",
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  birthdayHeroContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  birthdayHeroLeft: {
    flex: 1,
  },
  birthdayHeroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "white",
    marginBottom: 4,
  },
  birthdayHeroSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.9)",
  },
  birthdayHeroDaysContainer: {
    alignItems: "flex-end",
  },
  birthdayHeroDaysNumber: {
    fontSize: 36,
    fontWeight: "700",
    color: "white",
    lineHeight: 40,
  },
  birthdayHeroDaysText: {
    fontSize: 16,
    fontWeight: "700",
    color: "white",
    lineHeight: 24,
    marginTop: 4
  },
  birthdayHeroDaysLabel: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.9)",
  },
  birthdayAgeHint: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.9)",
    marginBottom: 12,
  },
  birthdayRecommendationCard: {
    backgroundColor: "white",
    borderRadius: 12,
    overflow: "hidden",
    flexDirection: "row",
    padding: 10,
    alignItems: "center",
  },
  birthdayRecommendationImageContainer: {
    position: "relative",
    width: 80,
    height: 80,
  },
  birthdayRecommendationImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  birthdayRecommendationRatingBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  birthdayRecommendationContent: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  birthdayRecommendationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  birthdayRecommendationRatingText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#111827",
  },
  birthdayRecommendationTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
  },
  birthdayRecommendationPrice: {
    fontSize: 12,
    fontWeight: "500",
    color: "#eb7825",
  },
  birthdayRecommendationDescription: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 16,
    marginBottom: 4,
  },
  birthdayRecommendationLocation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  birthdayRecommendationLocationText: {
    fontSize: 11,
    color: "#6b7280",
  },
  // Upcoming Holidays styles
  upcomingHolidaysSection: {
    marginBottom: 24,
  },
  upcomingHolidaysHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  upcomingHolidaysTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  upcomingHolidaysAddButton: {
    padding: 4,
  },
  holidayItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  holidayItemLeft: {
    flex: 1,
  },
  holidayItemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
  },
  holidayItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  holidayArchiveButton: {
    padding: 2,
  },
  holidayDeleteButton: {
    padding: 2,
  },
  holidayItemName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  holidayItemDate: {
    fontSize: 13,
    fontWeight: "500",
    color: "#eb7825",
    marginBottom: 4,
  },
  holidayItemDescription: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 6,
  },
  holidayCategoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef3eb",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
    gap: 4,
  },
  holidayCategoryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#eb7825",
  },
  holidayItemRight: {
    alignItems: "flex-end",
    marginLeft: 16,
  },
  holidayItemDays: {
    fontSize: 20,
    fontWeight: "700",
    color: "#eb7825",
  },
  holidayItemDaysText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#eb7825",
  },
  holidayItemDaysLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
  },
  // Holiday loading state
  holidayLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 12,
  },
  holidayLoadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  // Expandable Holiday Dropdown styles
  holidayItemContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    overflow: "hidden",
  },
  holidayCardsContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    backgroundColor: "#fafafa",
  },
  holidayNavButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  holidayCardsScrollContent: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 12,
  },
  holidayMiniCard: {
    width: 140,
    backgroundColor: "white",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  holidayMiniCardImage: {
    width: "100%",
    height: 80,
  },
  holidayMiniCardContent: {
    padding: 8,
  },
  holidayMiniCardTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
    lineHeight: 15,
  },
  holidayMiniCardDescription: {
    fontSize: 10,
    color: "#6b7280",
    lineHeight: 13,
    marginBottom: 6,
  },
  holidayMiniCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  holidayMiniCardPrice: {
    fontSize: 11,
    fontWeight: "600",
    color: "#eb7825",
  },
  holidayMiniCardRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  holidayMiniCardRatingText: {
    fontSize: 10,
    fontWeight: "500",
    color: "#1f2937",
  },
  archivedHolidaysSection: {
    marginBottom: 8,
  },
  archivedHolidaysToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
  },
  archivedHolidaysToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  archivedHolidaysToggleTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  archivedHolidaysToggleCount: {
    fontSize: 14,
    color: "#6b7280",
  },
  archivedHolidaysEmptyState: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  archivedHolidaysEmptyText: {
    fontSize: 13,
    color: "#6b7280",
  },
  archivedHolidayItem: {
    marginTop: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  archivedHolidayTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  archivedHolidayName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  archivedHolidayMeta: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 3,
  },
  archivedHolidayActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  archivedHolidayActionButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
  },
  // Person holiday container
  personHolidayContainer: {
    flex: 1,
  },
  // Holiday empty states
  holidayEmptyState: {
    paddingVertical: 24,
    alignItems: "center",
  },
  holidayEmptyStateText: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 8,
  },
  holidayEmptyStateAction: {
    marginTop: 12,
  },
  holidayEmptyStateActionText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  holidayCardsEmptyState: {
    paddingVertical: 16,
    alignItems: "center",
    flex: 1,
  },
  holidayCardsEmptyText: {
    fontSize: 13,
    color: "#9ca3af",
  },
  holidayMiniCardImagePlaceholder: {
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
    alignItems: "center",
  },
  retryButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

