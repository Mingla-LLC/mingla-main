import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  Modal,
  TextInput,
  Platform,
  Animated,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatPriceRange, parseAndFormatDistance, getCurrencyRate } from "./utils/formatters";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { useRecommendations, Recommendation } from "../contexts/RecommendationsContext";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { HolidayExperiencesService, HolidayExperience } from "../services/holidayExperiencesService";
import { NightOutExperiencesService, NightOutVenue } from "../services/nightOutExperiencesService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useUserLocation } from "../hooks/useUserLocation";
import { useCalendarHolidays, CalendarHoliday } from "../hooks/useCalendarHolidays";
import { enhancedLocationService } from "../services/enhancedLocationService";
import { PreferencesService } from "../services/preferencesService";
import { mixpanelService } from "../services/mixpanelService";
import { usePairingPills, useIncomingPairRequests, useSendPairRequest, useCancelPairRequest, useCancelPairInvite, useUnpair, pairingKeys } from "../hooks/usePairings";
import type { PairingPill, PairRequest } from "../services/pairingService";
import PairRequestModal from "./PairRequestModal";
import PairingInfoCard from "./PairingInfoCard";
import IncomingPairRequestCard from "./IncomingPairRequestCard";
import PairedPeopleRow from "./PairedPeopleRow";
import PersonHolidayView from "./PersonHolidayView";
import CustomHolidayModal from "./CustomHolidayModal";
import { STANDARD_HOLIDAYS } from "../constants/holidays";

// Storage key for custom holidays
const CUSTOM_HOLIDAYS_STORAGE_KEY = "mingla_custom_holidays";

// Storage key for archived holiday visibility per person
const HOLIDAY_ARCHIVE_STORAGE_KEY = "mingla_archived_holidays";

// Storage key for cached discover experiences (refreshes daily)
const DISCOVER_CACHE_KEY = "mingla_discover_cache_v5";
const DISCOVER_DAILY_CACHE_KEY = "mingla_discover_cache_daily_v4";
const DISCOVER_CACHE_MIGRATION_KEY = "mingla_discover_cache_migration";
const DISCOVER_CACHE_MIGRATION_VERSION = "2026-03-02-per-category-diversity-v5";

// Storage key for cached night-out venues (refreshes daily)
const NIGHT_OUT_CACHE_KEY = "mingla_night_out_cache";

// Custom Holiday interface (user-created holidays attached to a person)
interface CustomHoliday {
  id: string;
  personId: string; // The person this holiday is attached to
  name: string;
  date: string; // "MM-DD" format (recurring yearly)
  description: string;
  category: string;
  categories?: string[];
  createdAt: string;
  year?: number; // Original year the event occurred
}

import { SCREEN_WIDTH, s } from "../utils/responsive";
import { PriceTierSlug, PRICE_TIERS, googleLevelToTierSlug, tierLabel, tierRangeLabel, TIER_BY_SLUG } from '../constants/priceTiers';

const CARD_WIDTH = SCREEN_WIDTH - s(32); // 16px padding on each side
const GRID_CARD_WIDTH = (SCREEN_WIDTH - s(48)) / 2; // 16px padding + 16px gap between cards
const HERO_CARD_WIDTH = (SCREEN_WIDTH - s(44)) / 2; // 16px padding + 12px gap between hero cards
const ANIMATION_DURATION = 400;

// Month names for custom day picker
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Get max days for a given month (29 for Feb to allow leap year dates)
const getDaysInMonth = (month: number): number => {
  const daysPerMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysPerMonth[month - 1] || 31;
};

// Calculate next occurrence of a MM-DD date from today
const getNextOccurrence = (dateStr: string): { date: Date; daysAway: number } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let month: number, day: number;
  if (dateStr.match(/^\d{2}-\d{2}$/)) {
    // MM-DD format
    [month, day] = dateStr.split("-").map(Number);
  } else {
    // Legacy ISO format - extract month and day
    const legacyDate = new Date(dateStr);
    month = legacyDate.getMonth() + 1;
    day = legacyDate.getDate();
  }
  
  let holidayDate = new Date(today.getFullYear(), month - 1, day);
  holidayDate.setHours(0, 0, 0, 0);
  if (holidayDate < today) {
    holidayDate.setFullYear(holidayDate.getFullYear() + 1);
  }
  
  const diffTime = holidayDate.getTime() - today.getTime();
  const daysAway = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return { date: holidayDate, daysAway };
};

// Category icons mapping (v3 category system)
const categoryIcons: { [key: string]: string } = {
  "Nature": "leaf-outline",
  "First Meet": "chatbubbles-outline",
  "Picnic": "basket-outline",
  "Drink": "wine-outline",
  "Casual Eats": "fast-food-outline",
  "Fine Dining": "restaurant-outline",
  "Watch": "film-outline",
  "Creative & Arts": "color-palette-outline",
  "Play": "game-controller-outline",
  "Wellness": "body-outline",
  "Groceries & Flowers": "cart-outline",
  "Work & Business": "briefcase-outline",
};

// All experience categories (v3 category system — matches categoryPlaceTypes.ts)
const ALL_CATEGORIES = [
  "Nature",
  "First Meet",
  "Picnic",
  "Drink",
  "Casual Eats",
  "Fine Dining",
  "Watch",
  "Creative & Arts",
  "Play",
  "Wellness",
  "Groceries & Flowers",
  "Work & Business",
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
  lng: number | null
): string => `${DISCOVER_CACHE_KEY}_${userId}_${lat?.toFixed(2)}_${lng?.toFixed(2)}`;

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

// HARDCODED: Holiday name to experience categories mapping (v3 category names)
// This maps each holiday to the categories of experiences that should display in its dropdown
const HOLIDAY_CATEGORY_MAP: { [holidayName: string]: string[] } = {
  // New Year's Day -> Wellness + Fine Dining
  "new year's day": ["Wellness", "Fine Dining", "Casual Eats"],
  "new year": ["Wellness", "Fine Dining", "Casual Eats"],
  // Valentine's Day -> Fine Dining only
  "valentine's day": ["Fine Dining", "Casual Eats"],
  "valentine": ["Fine Dining", "Casual Eats"],
  // International Women's Day -> Fine Dining
  "international women's day": ["Fine Dining", "Casual Eats"],
  "women's day": ["Fine Dining", "Casual Eats"],
  // First Day of Spring -> Nature + Fine Dining
  "first day of spring": ["Nature", "Fine Dining", "Casual Eats"],
  "spring": ["Nature", "Fine Dining", "Casual Eats"],
  // Mother's Day -> Fine Dining
  "mother's day": ["Fine Dining", "Casual Eats"],
  // Father's Day -> Fine Dining
  "father's day": ["Fine Dining", "Casual Eats"],
  // Juneteenth / Summer -> Nature + Fine Dining
  "juneteenth": ["Nature", "Fine Dining", "Casual Eats"],
  "start of summer": ["Nature", "Fine Dining", "Casual Eats"],
  "summer": ["Nature", "Fine Dining", "Casual Eats"],
  // International Day of Peace -> Picnic + Fine Dining
  "international day of peace": ["Picnic", "Fine Dining", "Casual Eats"],
  "day of peace": ["Picnic", "Fine Dining", "Casual Eats"],
  "peace": ["Picnic", "Fine Dining", "Casual Eats"],
  // Sweetest Day -> Drink + Fine Dining
  "sweetest day": ["Drink", "Fine Dining", "Casual Eats"],
  "sweetest": ["Drink", "Fine Dining", "Casual Eats"],
  // Halloween -> Watch + Fine Dining
  "halloween": ["Watch", "Fine Dining", "Casual Eats"],
  // International Men's Day -> Play + Fine Dining
  "international men's day": ["Play", "Fine Dining", "Casual Eats"],
  "men's day": ["Play", "Fine Dining", "Casual Eats"],
  // Thanksgiving -> Play + Fine Dining
  "thanksgiving": ["Play", "Fine Dining", "Casual Eats"],
  // Christmas Eve -> Creative & Arts + Fine Dining
  "christmas eve": ["Creative & Arts", "Fine Dining", "Casual Eats"],
  // Christmas Day -> Nature + Fine Dining
  "christmas day": ["Nature", "Fine Dining", "Casual Eats"],
  "christmas": ["Nature", "Fine Dining", "Casual Eats"],
  // New Year's Eve -> Fine Dining
  "new year's eve": ["Fine Dining", "Casual Eats"],
};

// Helper to get categories for a holiday by name
const getCategoriesForHolidayName = (holidayName: string): string[] => {
  const nameLower = holidayName.toLowerCase();
  
  // Try exact match first
  if (HOLIDAY_CATEGORY_MAP[nameLower]) {
    return HOLIDAY_CATEGORY_MAP[nameLower];
  }
  
  // Try partial match
  for (const [key, categories] of Object.entries(HOLIDAY_CATEGORY_MAP)) {
    if (nameLower.includes(key) || key.includes(nameLower)) {
      return categories;
    }
  }
  
  // Default fallback: Fine Dining + Casual Eats (works for most holidays)
  return ["Fine Dining", "Casual Eats"];
};

// Tab types for Discover screen
export type DiscoverTab = "for-you" | "night-out";

interface DiscoverTabsProps {
  activeTab: DiscoverTab;
  onTabChange: (tab: DiscoverTab) => void;
}

// Extended calendar holiday with custom + categories fields
type ExtendedHoliday = CalendarHoliday & { isCustom?: boolean; categories?: string[] };

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
type PriceFilter = "any" | "chill" | "comfy" | "bougie" | "lavish";
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
  onAddFriend?: () => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  preferencesRefreshKey?: number; // Incremented when user saves preferences
}

// Tabs component similar to BoardTabs
const DiscoverTabs: React.FC<DiscoverTabsProps> = ({
  activeTab,
  onTabChange,
}) => {
  const tabs: Array<{ id: DiscoverTab; label: string; icon: string }> = [
    { id: "for-you", label: "For you", icon: "map-pin" },
    { id: "night-out", label: "Night out", icon: "music" },
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
                <Feather
                  name={tab.icon as any}
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
          <Text style={styles.featuredBadgeText}>Featured</Text>
        </View>
        {/* Travel Info Badges */}
        <View style={styles.travelInfoContainer}>
          {formattedDistance ? (
            <View style={styles.travelInfoBadge}>
              <Ionicons name="location-outline" size={14} color="white" />
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
            <Ionicons name="star" size={16} color="#eb7825" />
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
          <Ionicons name={categoryIcon as any} size={14} color="#eb7825" />
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
            <Ionicons name="star" size={13} color="#eb7825" />
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
          <Ionicons name={categoryIcon as any} size={16} color="#eb7825" />
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
            <Feather name="chevron-right" size={14} color="white" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Night Out Card Component — compact horizontal layout
const NightOutCard: React.FC<NightOutCardProps> = ({ card, currency = "USD", onPress }) => {
  const formattedPrice = formatPriceRange(card.price, currency);
  const displayPrice = formattedPrice || card.price || "TBA";
  const statusColor = card.ticketStatus === "onsale" ? "#10B981" : card.ticketStatus === "offsale" ? "#EF4444" : "#F59E0B";
  const statusLabel = card.ticketStatus === "onsale" ? "On Sale" : card.ticketStatus === "offsale" ? "Sold Out" : "Soon";

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
            <Feather name="calendar" size={12} color="#eb7825" />
            <Text style={styles.nightOutMetaText}>{card.date}</Text>
            <Text style={styles.nightOutMetaDot}>·</Text>
            <Feather name="clock" size={12} color="#eb7825" />
            <Text style={styles.nightOutMetaText}>{card.time}</Text>
          </View>

          {/* Venue row */}
          <View style={styles.nightOutMetaRow}>
            <Ionicons name="location-outline" size={12} color="#eb7825" />
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
              <Ionicons name="musical-notes-outline" size={10} color="#eb7825" />
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
  onAddFriend,
  accountPreferences,
  preferencesRefreshKey,
}: DiscoverScreenProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<DiscoverTab>("for-you");
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] = useState<ExpandedCardData | null>(null);
  
  // Entrance animation values
  const featuredCardOpacity = useRef(new Animated.Value(0)).current;
  const featuredCardSlide = useRef(new Animated.Value(40)).current;
  const gridCardsLeftOpacity = useRef(new Animated.Value(0)).current;
  const gridCardsLeftSlide = useRef(new Animated.Value(30)).current;
  const gridCardsRightOpacity = useRef(new Animated.Value(0)).current;
  const gridCardsRightSlide = useRef(new Animated.Value(30)).current;

  // Birthday hero recommendation animation values
  const birthdayHeroOpacity = useRef(new Animated.Value(0)).current;
  const birthdayHeroSlide = useRef(new Animated.Value(30)).current;

  // Holiday items staggered animation values (up to 20 holidays for full year)
  const holidayItemAnimations = useRef(
    Array.from({ length: 20 }, () => ({
      opacity: new Animated.Value(0),
      translateX: new Animated.Value(-50),
    }))
  ).current;

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
  
  // Pairing modal state
  const [isPairModalVisible, setIsPairModalVisible] = useState(false);
  const [infoPill, setInfoPill] = useState<PairingPill | null>(null);
  const [incomingRequestPill, setIncomingRequestPill] = useState<PairRequest | null>(null);

  // Auto-close incoming request sheet if the request vanishes (e.g. sender cancelled)
  useEffect(() => {
    if (incomingRequestPill && !incomingPairRequests.some((r) => r.id === incomingRequestPill.id)) {
      setIncomingRequestPill(null);
    }
  }, [incomingPairRequests, incomingRequestPill]);

  // Pairing selector
  const [selectedPillId, setSelectedPillId] = useState<string>("for-you");
  // Person experiences removed — replaced by pairing system

  // Expanded holidays state (track which holiday dropdowns are open)
  const [expandedHolidayIds, setExpandedHolidayIds] = useState<Set<string>>(new Set());
  const [holidayCardsById, setHolidayCardsById] = useState<Record<string, GridCardData[]>>({});
  const [holidayCardsLoadingById, setHolidayCardsLoadingById] = useState<Record<string, boolean>>({});

  // Custom holidays state
  const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);
  const [archivedHolidayKeysByPerson, setArchivedHolidayKeysByPerson] = useState<Record<string, string[]>>({});
  const [isArchivedHolidaysExpanded, setIsArchivedHolidaysExpanded] = useState(false);
  
  // Add Custom Day Modal state
  const [isAddCustomDayModalVisible, setIsAddCustomDayModalVisible] = useState(false);

  // Toggle holiday expansion
  const toggleHolidayExpansion = (holidayId: string) => {
    setExpandedHolidayIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(holidayId)) {
        newSet.delete(holidayId);
      } else {
        newSet.add(holidayId);
      }
      return newSet;
    });
  };

  // Reset holiday expansion/cards when selected person changes
  useEffect(() => {
    setExpandedHolidayIds(new Set());
    setHolidayCardsById({});
    setHolidayCardsLoadingById({});
  }, [selectedPillId]);

  // ScrollView refs for holiday card navigation
  const holidayScrollRefs = useRef<{ [key: string]: ScrollView | null }>({});
  const [holidayScrollPositions, setHolidayScrollPositions] = useState<{ [key: string]: number }>({});

  // Handle holiday card scroll navigation
  const scrollHolidayCards = (holidayId: string, direction: 'left' | 'right') => {
    const scrollRef = holidayScrollRefs.current[holidayId];
    if (!scrollRef) return;
    
    const currentPosition = holidayScrollPositions[holidayId] || 0;
    const scrollAmount = 160; // About 1.5 cards width
    const newPosition = direction === 'right' 
      ? currentPosition + scrollAmount 
      : Math.max(0, currentPosition - scrollAmount);
    
    scrollRef.scrollTo({ x: newPosition, animated: true });
  };

  // Track scroll position for each holiday
  const handleHolidayScroll = (holidayId: string, event: any) => {
    const position = event.nativeEvent.contentOffset.x;
    setHolidayScrollPositions((prev) => ({
      ...prev,
      [holidayId]: position,
    }));
  };

  // Get auth for Discover features
  const { user } = useAuthSimple();
  const { data: pairingPills = [] } = usePairingPills(user?.id);
  const { data: incomingPairRequests = [] } = useIncomingPairRequests(user?.id);

  // Pairing mutation hooks
  const cancelRequestMutation = useCancelPairRequest();
  const cancelInviteMutation = useCancelPairInvite();
  const unpairMutation = useUnpair();

  const handleUnpair = (pairingId: string) => {
    unpairMutation.mutate(pairingId, {
      onSuccess: () => {
        setSelectedPillId("for-you");
      },
    });
  };

  // Get the currently selected pill (null if "for-you" is selected)
  const selectedPill = useMemo(() => {
    if (selectedPillId === "for-you") return null;
    return pairingPills?.find((p) => p.id === selectedPillId) || null;
  }, [selectedPillId, pairingPills]);

  // Animate birthday hero section when paired pill is selected
  useEffect(() => {
    if (selectedPill?.pillState === 'active') {
      // Reset animation values
      birthdayHeroOpacity.setValue(0);
      birthdayHeroSlide.setValue(30);

      // Run slide-up and fade-in animation with slight delay
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(birthdayHeroOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(birthdayHeroSlide, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200);
    }
  }, [selectedPill, birthdayHeroOpacity, birthdayHeroSlide]);

  // Memoized birthday countdown for the selected paired person
  const birthdayInfo = useMemo(() => {
    if (!selectedPill?.birthday) return null;
    const bDate = new Date(selectedPill.birthday);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisYear = today.getFullYear();
    let nextBday = new Date(thisYear, bDate.getMonth(), bDate.getDate());
    nextBday.setHours(0, 0, 0, 0);
    if (nextBday < today) nextBday = new Date(thisYear + 1, bDate.getMonth(), bDate.getDate());
    const daysAway = Math.ceil((nextBday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { daysAway, label: `${MONTH_NAMES[bDate.getMonth()]} ${bDate.getDate()}` };
  }, [selectedPill?.birthday]);

  // Holiday detection helper - checks for upcoming holidays relevant to selected pill
  const getUpcomingHolidays = useCallback((pill: PairingPill | null): string[] => {
    const holidays: string[] = [];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    // Check for Valentine's Day (Feb 14) - within 2 weeks before
    if (currentMonth === 1 && currentDay >= 1 && currentDay <= 14) {
      holidays.push("valentines");
    }

    // Check for Mother's Day (2nd Sunday of May) - within 2 weeks before
    if (currentMonth === 4 && currentDay >= 1 && currentDay <= 14 && pill?.gender === "woman") {
      holidays.push("mothers-day");
    }

    // Check for Father's Day (3rd Sunday of June) - within 2 weeks before
    if (currentMonth === 5 && currentDay >= 7 && currentDay <= 21 && pill?.gender === "man") {
      holidays.push("fathers-day");
    }

    // Check if paired user's birthday is upcoming (within 2 weeks)
    if (pill?.birthday) {
      const birthday = new Date(pill.birthday);
      const birthdayThisYear = new Date(now.getFullYear(), birthday.getMonth(), birthday.getDate());
      const diffDays = Math.ceil((birthdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 14) {
        holidays.push("birthday");
      }
    }

    // Christmas (Dec 25) - within 3 weeks before
    if (currentMonth === 11 && currentDay >= 4 && currentDay <= 25) {
      holidays.push("christmas");
    }

    // New Year (Jan 1) - within 2 weeks before
    if ((currentMonth === 11 && currentDay >= 18) || (currentMonth === 0 && currentDay <= 1)) {
      holidays.push("new-year");
    }

    return holidays;
  }, []);

  // Get holiday-themed tags based on upcoming holidays
  const getHolidayTags = useCallback((holidays: string[]): string[] => {
    const tags: string[] = [];
    if (holidays.includes("valentines")) tags.push("Romantic", "Date Night", "Couples");
    if (holidays.includes("mothers-day")) tags.push("Wellness", "Spa", "Brunch", "Family");
    if (holidays.includes("fathers-day")) tags.push("Sports", "Outdoor", "BBQ", "Family");
    if (holidays.includes("birthday")) tags.push("Celebration", "Special Occasion", "Party");
    if (holidays.includes("christmas")) tags.push("Festive", "Holiday", "Family", "Cozy");
    if (holidays.includes("new-year")) tags.push("Party", "Celebration", "New Beginnings");
    return tags;
  }, []);

  // Get gender-appropriate categories
  const getGenderCategories = useCallback((gender: string | null): string[] | null => {
    if (!gender) return null;
    // Return categories that tend to resonate more with specific genders
    // null means no filter (show all)
    if (gender === "woman") {
      return ["Wellness", "Drink", "Creative & Arts", "Fine Dining", "Picnic"];
    }
    if (gender === "man") {
      return ["Play", "Casual Eats", "Fine Dining", "Drink", "Watch"];
    }
    return null; // all other genders - show all
  }, []);

  // ── User preference categories (drives which categories the Discover API fetches) ──
  const [userSelectedCategories, setUserSelectedCategories] = useState<string[] | null>(null);
  const prevRefreshKeyRef = useRef<number | undefined>(undefined);

  // Stable fingerprint of user's selected categories — used to partition caches per preference set
  const prefsFingerprint = useMemo(() => {
    if (!userSelectedCategories || userSelectedCategories.length === 0) return 'all';
    return [...userSelectedCategories].sort().join(',');
  }, [userSelectedCategories]);

  useEffect(() => {
    const loadUserCategories = async () => {
      if (!user?.id) return;
      try {
        const prefs = await PreferencesService.getUserPreferences(user.id);
        if (prefs?.categories && prefs.categories.length > 0) {
          // Filter out intent IDs – keep only actual category names/IDs
          const intentIds = new Set([
            "adventurous", "first-date", "romantic", "friendly", "group-fun", "picnic-dates", "take-a-stroll",
          ]);
          const categories = prefs.categories.filter((c: string) => !intentIds.has(c));
          setUserSelectedCategories(categories.length > 0 ? categories : null);
          console.log("[Discover] Loaded user categories:", categories);
        } else {
          setUserSelectedCategories(null);
        }
      } catch (err) {
        console.warn("[Discover] Failed to load user categories:", err);
        setUserSelectedCategories(null);
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
  const { data: userLocationData } = useUserLocation(user?.id, "solo", undefined);
  const fallbackLat = userLocationData?.lat;
  const fallbackLng = userLocationData?.lng;

  // Device GPS location - used by BOTH "For You" and "Night Out" tabs
  const [deviceGpsLat, setDeviceGpsLat] = useState<number | null>(null);
  const [deviceGpsLng, setDeviceGpsLng] = useState<number | null>(null);
  const deviceGpsFetchedRef = useRef(false);

  useEffect(() => {
    const fetchDeviceGps = async () => {
      if (deviceGpsFetchedRef.current) return;
      deviceGpsFetchedRef.current = true;

      // Fast path: use saved/fallback location immediately so Discover can load without waiting for GPS
      if (fallbackLat && fallbackLng) {
        setDeviceGpsLat(fallbackLat);
        setDeviceGpsLng(fallbackLng);
      }

      try {
        const loc = await enhancedLocationService.getCurrentLocation();
        if (loc) {
          setDeviceGpsLat(loc.latitude);
          setDeviceGpsLng(loc.longitude);
          console.log("[Discover] Device GPS:", loc.latitude, loc.longitude);
        } else {
          console.log("[Discover] GPS unavailable, falling back to preference location");
          if (fallbackLat && fallbackLng) {
            setDeviceGpsLat(fallbackLat);
            setDeviceGpsLng(fallbackLng);
          }
        }
      } catch (err) {
        console.error("[Discover] GPS error, falling back:", err);
        if (fallbackLat && fallbackLng) {
          setDeviceGpsLat(fallbackLat);
          setDeviceGpsLng(fallbackLng);
        }
      }
    };
    fetchDeviceGps();
  }, [fallbackLat, fallbackLng]);

  // locationLat/locationLng now come from device GPS (not saved preference)
  const locationLat = deviceGpsLat;
  const locationLng = deviceGpsLng;

  // Note: Saved people migration removed — replaced by pairing system

  // Save custom holidays to AsyncStorage
  const saveCustomHolidaysToStorage = async (holidays: CustomHoliday[]) => {
    if (!user?.id) {
      console.warn("Cannot save custom holidays: no user ID available");
      return;
    }
    try {
      const userStorageKey = `${CUSTOM_HOLIDAYS_STORAGE_KEY}_${user.id}`;
      await AsyncStorage.setItem(userStorageKey, JSON.stringify(holidays));
    } catch (error) {
      console.error("Error saving custom holidays to storage:", error);
    }
  };

  // Load custom holidays from AsyncStorage
  const loadCustomHolidaysFromStorage = async () => {
    if (!user?.id) {
      setCustomHolidays([]);
      return;
    }
    try {
      const userStorageKey = `${CUSTOM_HOLIDAYS_STORAGE_KEY}_${user.id}`;
      const stored = await AsyncStorage.getItem(userStorageKey);
      if (stored) {
        const holidays = JSON.parse(stored) as CustomHoliday[];
        setCustomHolidays(holidays);
      } else {
        setCustomHolidays([]);
      }
    } catch (error) {
      console.error("Error loading custom holidays from storage:", error);
      setCustomHolidays([]);
    }
  };

  // Save archived holiday keys by person to AsyncStorage
  const saveArchivedHolidaysToStorage = async (archiveMap: Record<string, string[]>) => {
    if (!user?.id) {
      console.warn("Cannot save archived holidays: no user ID available");
      return;
    }
    try {
      const userStorageKey = `${HOLIDAY_ARCHIVE_STORAGE_KEY}_${user.id}`;
      await AsyncStorage.setItem(userStorageKey, JSON.stringify(archiveMap));
    } catch (error) {
      console.error("Error saving archived holidays to storage:", error);
    }
  };

  // Load archived holiday keys by person from AsyncStorage
  const loadArchivedHolidaysFromStorage = async () => {
    if (!user?.id) {
      setArchivedHolidayKeysByPerson({});
      return;
    }
    try {
      const userStorageKey = `${HOLIDAY_ARCHIVE_STORAGE_KEY}_${user.id}`;
      const stored = await AsyncStorage.getItem(userStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string[]>;
        setArchivedHolidayKeysByPerson(parsed || {});
      } else {
        setArchivedHolidayKeysByPerson({});
      }
    } catch (error) {
      console.error("Error loading archived holidays from storage:", error);
      setArchivedHolidayKeysByPerson({});
    }
  };

  // Load custom holidays on mount or when user changes
  useEffect(() => {
    loadCustomHolidaysFromStorage();
    loadArchivedHolidaysFromStorage();
  }, [user?.id]);

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
  const [isDiscoverCacheMigrationReady, setIsDiscoverCacheMigrationReady] = useState(false);
  const hasFetchedRef = useRef(false);
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
            key.startsWith(`mingla_discover_cache_daily_v1_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v2_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v3_${user.id}`) ||
            key.startsWith(`mingla_discover_cache_daily_v4_${user.id}`)
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
      const exactCacheKey = getDiscoverExactCacheKey(user.id, locationLat, locationLng);
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
      const exactCacheKey = getDiscoverExactCacheKey(user.id, locationLat, locationLng);
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

    const exactCacheKey = getDiscoverExactCacheKey(user.id, locationLat, locationLng);
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
    images: card.images || [card.image],
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
  });

  const featuredFromRecommendation = (rec: Recommendation): FeaturedCardData => ({
    id: `${rec.id}_featured_fallback`,
    title: rec.title,
    experienceType: rec.category,
    description: rec.description,
    image: rec.image,
    images: rec.images || [rec.image],
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
  });

  const gridFromRecommendation = (rec: Recommendation): GridCardData => ({
    id: rec.id,
    title: rec.title,
    category: rec.category,
    description: rec.description,
    image: rec.image,
    images: rec.images || [rec.image],
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
      if (!user?.id) {
        return;
      }

      if (!isDiscoverCacheMigrationReady) {
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

        // For You: always fetch ALL 12 categories with Fine Dining + Play heroes
        // User preferences do NOT filter the For You view — it shows best-of-the-best across ALL categories
        const { cards: generatedCards, heroCards: heroCardsRaw, featuredCard, expiresAt: serverExpiresAt } = await ExperienceGenerationService.discoverExperiences(
          { lat: locationLat, lng: locationLng },
          10000, // 10km radius
          undefined,              // For You: always ALL categories (never filtered by user prefs)
          ["Fine Dining", "Play"], // For You: always these 2 hero categories
        );

        if (!generatedCards || generatedCards.length === 0) {
          console.warn("Discover API returned no cards. Preserving existing discover cards.");
          if (cachedData && cachedData.recommendations.length > 0) {
            lastDiscoverFetchDateRef.current = today;
            return;
          }

          setDiscoverError("Unable to load experiences right now. Please try again.");
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
          images: exp.images || [exp.heroImage],
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
        }));

        // Transform hero cards from server response
        const transformedHeroes: FeaturedCardData[] = (heroCardsRaw || []).map((hc: any) => ({
          id: hc.id,
          placeId: hc.placeId || hc.id,
          title: hc.title,
          experienceType: hc.category,
          description: hc.description,
          image: hc.heroImage,
          images: hc.images || [hc.heroImage],
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
                images: candidate.images || [candidate.heroImage],
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
                images: candidate.images || [candidate.heroImage],
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
            images: exp.images || [exp.heroImage],
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
          }));

        const finalFeatured = transformedFeatured || (gridCards[0] ? featuredFromGridCard(gridCards[0]) : null);
        setSelectedHeroCards(transformedHeroes);
        setSelectedFeaturedCard(finalFeatured);
        setSelectedGridCards(gridCards);
        console.log("Set hero cards:", transformedHeroes.length, "grid cards:", gridCards.length);

        prefetchDiscoverImages(finalFeatured, gridCards);

        setDiscoverRecommendations(transformed);
        setHasCompletedDiscoverFetch(true);
        lastDiscoverFetchDateRef.current = today;
        
        // Save to cache for 24-hour persistence
        saveDiscoverCache(transformed, finalFeatured, gridCards, transformedHeroes, serverExpiresAt);
        
        // Mark as loaded from cache to skip the card selection useEffect
        loadedFromCacheRef.current = true;
      } catch (error) {
        console.error("Error fetching Discover recommendations:", error);
        setDiscoverError("Failed to load recommendations");
        hasFetchedRef.current = false; // Allow retry on error
      } finally {
        if (!waitingForLocation) {
          setDiscoverLoading(false);
        }
      }
    };

    fetchDiscoverRecommendations();
  }, [locationLat, locationLng, user?.id, isDiscoverCacheMigrationReady, userSelectedCategories, preferencesRefreshKey]);

  // Use Discover-specific recommendations
  const recommendations = discoverRecommendations;
  const recommendationsLoading = discoverLoading;
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
        setNightOutError("Failed to load events");
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
      categoryIcon: "walk",
      description: card.description,
      fullDescription: card.description,
      image: card.image,
      images: card.images || [card.image],
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
    };
    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  // Transform GridCardData to ExpandedCardData
  const handleGridCardPress = (card: GridCardData) => {
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
      images: card.images || [card.image],
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
      images: card.images || [card.image],
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
    return opt?.label || "All Genres";
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

  // Calculate days until birthday
  const getDaysUntilBirthday = (birthdayString: string | null): number => {
    if (!birthdayString) return -1;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset to midnight for accurate day comparison
    const birthday = new Date(birthdayString);
    const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
    thisYearBirthday.setHours(0, 0, 0, 0);
    
    // If birthday has passed this year, check next year
    if (thisYearBirthday < today) {
      thisYearBirthday.setFullYear(today.getFullYear() + 1);
    }
    
    const diffTime = thisYearBirthday.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Calculate age person is turning
  const getAgeTurning = (birthdayString: string | null): number => {
    if (!birthdayString) return -1;
    const today = new Date();
    const birthday = new Date(birthdayString);
    let age = today.getFullYear() - birthday.getFullYear();
    const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
    
    // If birthday hasn't happened yet this year, they're turning that age
    // If birthday has passed, they're turning age + 1 next year
    if (thisYearBirthday <= today) {
      age = age + 1;
    }
    return age;
  };

  // Format birthday date for display (e.g., "September 10")
  const formatBirthdayDate = (birthdayString: string | null): string => {
    if (!birthdayString) return "";
    const birthday = new Date(birthdayString);
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    return `${months[birthday.getMonth()]} ${birthday.getDate()}`;
  };

  // Use the calendar holidays hook for dynamic holidays from device calendar (365 days ahead - rest of year)
  const { 
    holidays: calendarHolidays, 
    loading: holidaysLoading, 
    hasCalendarAccess 
  } = useCalendarHolidays(365);

  // Get experiences filtered by multiple categories (with variety for different holidays)
  const getExperiencesForCategories = useCallback((categories: string[], holidayId?: string): GridCardData[] => {
    const minCards = 2;
    const maxCards = 3;
    
    // Normalize categories for matching
    const normalizedCategories = categories.map(c => c.toLowerCase().trim());
    
    // Filter gridCards by any of the categories
    let filteredCards = gridCards.filter((card) => {
      const cardCat = card.category.toLowerCase().trim();
      // Check for exact match with any category
      if (normalizedCategories.includes(cardCat)) return true;
      // Check for partial match (e.g., "Stroll" matches "Take a Stroll")
      return normalizedCategories.some(nc => cardCat.includes(nc) || nc.includes(cardCat));
    });
    
    // If we have enough cards, return them prioritized by category order
    if (filteredCards.length >= minCards) {
      // Sort to prioritize cards matching earlier categories
      filteredCards.sort((a, b) => {
        const aIndex = normalizedCategories.findIndex(nc => {
          const aCat = a.category.toLowerCase().trim();
          return aCat === nc || aCat.includes(nc) || nc.includes(aCat);
        });
        const bIndex = normalizedCategories.findIndex(nc => {
          const bCat = b.category.toLowerCase().trim();
          return bCat === nc || bCat.includes(nc) || nc.includes(bCat);
        });
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
      return filteredCards.slice(0, Math.min(maxCards, filteredCards.length));
    }
    
    // If not enough cards, fill with deterministic selection from other cards
    const seed = (categories.join("") + (holidayId || "")).split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const allCards = [...gridCards];
    allCards.sort((a, b) => {
      const aHash = (a.id.charCodeAt(0) + seed) % 100;
      const bHash = (b.id.charCodeAt(0) + seed) % 100;
      return aHash - bHash;
    });
    
    const otherCards = allCards.filter(
      (card) => !filteredCards.find((fc) => fc.id === card.id)
    );
    const combined = [...filteredCards, ...otherCards];
    return combined.slice(0, Math.min(maxCards, Math.max(minCards, combined.length)));
  }, [gridCards]);

  const currencySymbol = getCurrencySymbol(accountPreferences?.currency);

  // Filter options
  const dateFilterOptions: { id: DateFilter; label: string }[] = [
    { id: "any", label: "Any Date" },
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "weekend", label: "This Weekend" },
    { id: "next-week", label: "Next Week" },
    { id: "month", label: "This Month" },
  ];

  const cRate = getCurrencyRate(accountPreferences?.currency);
  const cp = (usd: number) => Math.round(usd * cRate).toLocaleString();

  const priceFilterOptions: { id: PriceFilter; label: string }[] = [
    { id: "any", label: "Any Price" },
    ...PRICE_TIERS.map(tier => ({ id: tier.slug as PriceFilter, label: `${tier.label} · ${tier.rangeLabel}` })),
  ];

  const genreFilterOptions: { id: GenreFilter; label: string }[] = [
    { id: "all", label: "All Genres" },
    { id: "afrobeats", label: "Afrobeats" },
    { id: "dancehall", label: "Dancehall / Soca" },
    { id: "hiphop-rnb", label: "Hip-Hop / R&B" },
    { id: "house", label: "House / Electronic" },
    { id: "techno", label: "Techno / Electronic" },
    { id: "jazz-blues", label: "Jazz / Blues" },
    { id: "latin-salsa", label: "Latin / Salsa" },
    { id: "reggae", label: "Reggae" },
    { id: "kpop", label: "K-Pop" },
    { id: "acoustic-indie", label: "Acoustic / Indie" },
  ];

  // Handle pill selection ("for-you" or pill.id)
  const handlePillSelect = (pillId: string) => {
    setSelectedPillId(pillId);
  };

  // Handle "For You" selection
  const handleForYouSelect = () => {
    setSelectedPillId("for-you");
  };

  const handleBirthdayChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowBirthdayPicker(false);
    }
    if (selectedDate) {
      setPersonBirthday(selectedDate);
    }
  };

  const formatBirthdayForDisplay = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  // Add Custom Day Modal handlers
  const handleOpenAddCustomDayModal = () => {
    if (selectedPillId === "for-you") return;
    setIsAddCustomDayModalVisible(true);
  };

  const handleCloseAddCustomDayModal = () => {
    setIsAddCustomDayModalVisible(false);
  };

  // Handle save from CustomHolidayModal
  const handleCustomHolidaySave = useCallback(
    async (holiday: { name: string; month: number; day: number; year: number }) => {
      if (selectedPillId === "for-you") return; // Guard: no person selected
      const dateStr = `${String(holiday.month).padStart(2, "0")}-${String(holiday.day).padStart(2, "0")}`;

      const newCustomHoliday: CustomHoliday = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        personId: selectedPillId,
        name: holiday.name,
        date: dateStr,
        description: "",
        category: "Fine Dining",
        categories: ["Fine Dining"],
        createdAt: new Date().toISOString(),
        year: holiday.year,
      };

      const updatedHolidays = [...customHolidays, newCustomHoliday];
      setCustomHolidays(updatedHolidays);
      await saveCustomHolidaysToStorage(updatedHolidays);

      mixpanelService.trackDiscoverCustomHolidayAdded({
        holidayName: holiday.name,
        date: dateStr,
        categories: ["Fine Dining"],
        personId: selectedPillId,
      });
      // Note: CustomHolidayModal calls onClose() after onSave(), so no manual close needed
    },
    [customHolidays, selectedPillId, saveCustomHolidaysToStorage]
  );

  // Location for PersonHolidayView — use GPS first, fall back to saved preference
  // Returns {0,0} when neither source is available yet; CardRow will show
  // a "Getting your location" state and the query won't fire until real coords arrive.
  const personViewLocation = useMemo(
    () => ({
      latitude: deviceGpsLat ?? fallbackLat ?? 0,
      longitude: deviceGpsLng ?? fallbackLng ?? 0,
    }),
    [deviceGpsLat, deviceGpsLng, fallbackLat, fallbackLng]
  );

  // Transform custom holidays from DiscoverScreen format to PersonHolidayView format
  const personCustomHolidays = useMemo(() => {
    if (selectedPillId === "for-you") return undefined;
    const filtered = customHolidays.filter((h) => h.personId === selectedPillId);
    if (filtered.length === 0) return undefined;
    return filtered.map((h) => {
      const [month, day] = h.date.split("-").map(Number);
      return {
        id: h.id,
        name: h.name,
        month: month || 1,
        day: day || 1,
        year: h.year ?? new Date().getFullYear(),
      };
    });
  }, [customHolidays, selectedPillId]);

  // Archive/unarchive handlers for PersonHolidayView (persisted via AsyncStorage)
  // Migrates old-format keys (calendar:valentine's day:02-14) to holiday IDs (valentines_day)
  const personArchivedHolidayIds = useMemo(() => {
    if (selectedPillId === "for-you") return [];
    const raw = archivedHolidayKeysByPerson[selectedPillId] ?? [];
    if (raw.length === 0) return raw;

    // Build reverse lookup: normalized "name:MM-DD" → holiday ID
    const oldKeyToId = new Map<string, string>();
    for (const h of STANDARD_HOLIDAYS) {
      const yr = new Date().getFullYear();
      const d = h.getDate(yr);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const normName = h.name.trim().toLowerCase();
      oldKeyToId.set(`calendar:${normName}:${mm}-${dd}`, h.id);
    }

    return raw.map((key) => {
      // Already a holiday ID (new format)? Keep as-is.
      if (!key.startsWith("calendar:") && !key.startsWith("custom:")) return key;
      // Old format → look up matching holiday ID
      return oldKeyToId.get(key) ?? key;
    });
  }, [archivedHolidayKeysByPerson, selectedPillId]);

  const handlePersonArchiveHoliday = useCallback(async (holidayId: string) => {
    if (selectedPillId === "for-you") return;
    const current = archivedHolidayKeysByPerson[selectedPillId] || [];
    if (current.includes(holidayId)) return;
    const nextMap = {
      ...archivedHolidayKeysByPerson,
      [selectedPillId]: [...current, holidayId],
    };
    setArchivedHolidayKeysByPerson(nextMap);
    await saveArchivedHolidaysToStorage(nextMap);
  }, [archivedHolidayKeysByPerson, selectedPillId]);

  const handlePersonUnarchiveHoliday = useCallback(async (holidayId: string) => {
    if (selectedPillId === "for-you") return;
    const current = archivedHolidayKeysByPerson[selectedPillId] || [];
    if (!current.includes(holidayId)) return;
    const nextMap = {
      ...archivedHolidayKeysByPerson,
      [selectedPillId]: current.filter((k) => k !== holidayId),
    };
    setArchivedHolidayKeysByPerson(nextMap);
    await saveArchivedHolidaysToStorage(nextMap);
  }, [archivedHolidayKeysByPerson, selectedPillId]);

  // Handle card press from PersonHolidayView — open ExpandedCardModal
  const handlePersonCardPress = useCallback(
    (card: {
      id: string;
      title: string;
      category: string;
      imageUrl: string | null;
      rating: number | null;
      address: string | null;
      priceRange: string | null;
      cardType: "single" | "curated";
      experienceType: string | null;
    }) => {
      const expanded: ExpandedCardData = {
        id: card.id,
        placeId: card.id,
        title: card.title,
        category: card.category,
        categoryIcon: categoryIcons[card.category] || "ellipse-outline",
        description: "",
        fullDescription: "",
        image: card.imageUrl || "",
        images: card.imageUrl ? [card.imageUrl] : [],
        rating: card.rating ?? 0,
        reviewCount: 0,
        priceRange: card.priceRange || "",
        distance: "",
        travelTime: "",
        address: card.address || "",
        highlights: [],
        tags: [],
        matchScore: 0,
        matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
        socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
        selectedDateTime: new Date(),
        ...(card.cardType === "curated" ? { cardType: "curated" as const } : {}),
      };
      setSelectedCardForExpansion(expanded);
      setIsExpandedModalVisible(true);
    },
    []
  );

  // Transform discover recommendations into fallback cards for PersonHolidayView
  // These are real Google Places that already loaded on the For You tab
  const fallbackCardsForPerson = useMemo(() => {
    if (discoverRecommendations.length === 0) return undefined;
    return discoverRecommendations.slice(0, 30).map((rec) => ({
      id: rec.id,
      title: rec.title,
      category: rec.category,
      image: rec.image,
      rating: rec.rating,
      address: rec.address,
      priceRange: rec.priceRange,
    }));
  }, [discoverRecommendations]);

  // Delete a custom holiday
  const handleDeleteCustomHoliday = async (holidayId: string) => {
    const deletedHoliday = customHolidays.find((h) => h.id === holidayId);
    const updatedHolidays = customHolidays.filter((h) => h.id !== holidayId);
    setCustomHolidays(updatedHolidays);
    await saveCustomHolidaysToStorage(updatedHolidays);

    if (deletedHoliday) {
      const archiveKeyToRemove = `custom:${holidayId}`;
      const personArchiveKeys = archivedHolidayKeysByPerson[deletedHoliday.personId] || [];
      if (personArchiveKeys.includes(archiveKeyToRemove)) {
        const nextArchiveMap = {
          ...archivedHolidayKeysByPerson,
          [deletedHoliday.personId]: personArchiveKeys.filter((key) => key !== archiveKeyToRemove),
        };
        setArchivedHolidayKeysByPerson(nextArchiveMap);
        await saveArchivedHolidaysToStorage(nextArchiveMap);
      }
    }
  };

  const handleConfirmDeleteCustomHoliday = (holidayId: string, holidayName: string) => {
    Alert.alert(
      "Delete custom holiday?",
      `Delete \"${holidayName}\"? This can’t be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void handleDeleteCustomHoliday(holidayId);
          },
        },
      ]
    );
  };

  const getHolidayArchiveKey = useCallback((holiday: CalendarHoliday & { isCustom?: boolean }): string => {
    if ((holiday as ExtendedHoliday).isCustom) {
      return `custom:${holiday.id}`;
    }

    const holidayDate = new Date(holiday.date);
    const month = String(holidayDate.getMonth() + 1).padStart(2, "0");
    const day = String(holidayDate.getDate()).padStart(2, "0");
    const normalizedName = (holiday.name || "").trim().toLowerCase();
    return `calendar:${normalizedName}:${month}-${day}`;
  }, []);

  const handleArchiveHoliday = useCallback(async (holiday: CalendarHoliday & { isCustom?: boolean }) => {
    if (selectedPillId === "for-you") return;

    const holidayKey = getHolidayArchiveKey(holiday);
    const currentPersonKeys = archivedHolidayKeysByPerson[selectedPillId] || [];
    if (currentPersonKeys.includes(holidayKey)) return;

    const nextArchiveMap = {
      ...archivedHolidayKeysByPerson,
      [selectedPillId]: [...currentPersonKeys, holidayKey],
    };

    setArchivedHolidayKeysByPerson(nextArchiveMap);
    await saveArchivedHolidaysToStorage(nextArchiveMap);

    setExpandedHolidayIds((prev) => {
      const next = new Set(prev);
      next.delete(holiday.id);
      return next;
    });
  }, [archivedHolidayKeysByPerson, getHolidayArchiveKey, selectedPillId]);

  const handleUnarchiveHoliday = useCallback(async (holiday: CalendarHoliday & { isCustom?: boolean }) => {
    if (selectedPillId === "for-you") return;

    const holidayKey = getHolidayArchiveKey(holiday);
    const currentPersonKeys = archivedHolidayKeysByPerson[selectedPillId] || [];
    if (!currentPersonKeys.includes(holidayKey)) return;

    const nextArchiveMap = {
      ...archivedHolidayKeysByPerson,
      [selectedPillId]: currentPersonKeys.filter((key) => key !== holidayKey),
    };

    setArchivedHolidayKeysByPerson(nextArchiveMap);
    await saveArchivedHolidaysToStorage(nextArchiveMap);
  }, [archivedHolidayKeysByPerson, getHolidayArchiveKey, selectedPillId]);

  const formatHolidayDateForDisplay = useCallback((dateValue: Date | string): string => {
    const holidayDate = new Date(dateValue);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${monthNames[holidayDate.getMonth()]} ${holidayDate.getDate()}`;
  }, []);

  // Get custom holidays for the currently selected person, formatted as CalendarHoliday
  const getPersonCustomHolidays = useMemo((): CalendarHoliday[] => {
    if (selectedPillId === "for-you") return [];
    
    const personHolidays = customHolidays.filter((h) => h.personId === selectedPillId);
    
    return personHolidays.map((h) => {
      // Calculate next occurrence - treats date as recurring (MM-DD or legacy ISO)
      const { date: holidayDate, daysAway } = getNextOccurrence(h.date);

      const selectedCategories = (h.categories && h.categories.length > 0)
        ? h.categories
        : (h.category ? [h.category] : ["Fine Dining"]);
      
      // Custom holidays show primary category + Fine Dining
      const categories = Array.from(new Set([...selectedCategories, "Fine Dining"]));
      
      return {
        id: h.id,
        name: h.name,
        description: h.description,
        date: holidayDate,
        daysAway,
        category: selectedCategories[0],
        categories: categories,
        isFromCalendar: false,
        isCustom: true, // Mark as custom holiday
      } as ExtendedHoliday;
    });
  }, [customHolidays, selectedPillId]);

  // Transform HolidayExperience to GridCardData for display
  const transformHolidayExperienceToCard = useCallback((exp: HolidayExperience): GridCardData => {
    // Map priceLevel to actual dollar ranges (matches discover-experiences edge function)
    const priceTier = googleLevelToTierSlug(exp.priceLevel);

    return {
      id: exp.id,
      title: exp.name,
      category: exp.category,
      description: exp.address || "",
      image: exp.imageUrl || "",
      images: exp.images,
      priceRange: `${tierLabel(priceTier)} · ${tierRangeLabel(priceTier)}`,
      rating: exp.rating,
      reviewCount: exp.reviewCount,
      address: exp.address,
      location: exp.location,
      openingHours: exp.openingHours || null,
    };
  }, []);

  // Load cards for a single holiday only when user expands it
  const loadHolidayCardsOnDemand = useCallback(async (
    holiday: {
      id: string;
      name: string;
      daysAway: number;
      categories?: string[];
      category?: string;
      isCustom?: boolean;
    }
  ) => {
    if (holidayCardsById[holiday.id] || holidayCardsLoadingById[holiday.id]) {
      return;
    }

    setHolidayCardsLoadingById((prev) => ({ ...prev, [holiday.id]: true }));

    const holidayCategories = holiday.categories || (holiday.category ? [holiday.category] : getCategoriesForHolidayName(holiday.name));

    try {
      let cards: GridCardData[] = [];

      if (locationLat && locationLng && selectedPillId !== "for-you") {
        const personGender = selectedPill?.gender;
        const gender: "man" | "woman" | null =
          personGender === "man" || personGender === "woman" ? personGender : null;

        const personCustomHolidays = customHolidays
          .filter((h) => h.personId === selectedPillId)
          .map((h) => ({
            id: h.id,
            name: h.name,
            description: h.description,
            date: h.date,
            category: h.category,
            categories: h.categories,
          }));

        const response = await HolidayExperiencesService.getHolidayExperiences({
          location: { lat: locationLat, lng: locationLng },
          radius: 10000,
          gender,
          days: Math.min(365, Math.max(7, (holiday.daysAway || 0) + 2)),
          customHolidays: personCustomHolidays,
        });

        const merged = [...response.holidays, ...(response.customHolidays || [])];
        const matchedHoliday = merged.find(
          (h) => h.id === holiday.id || h.name.toLowerCase() === holiday.name.toLowerCase()
        );

        if (matchedHoliday?.experiences?.length) {
          cards = matchedHoliday.experiences
            .map(transformHolidayExperienceToCard)
            .slice(0, 3);
        }
      }

      if (cards.length === 0) {
        cards = getExperiencesForCategories(holidayCategories, holiday.id).slice(0, 3);
      }

      setHolidayCardsById((prev) => ({ ...prev, [holiday.id]: cards }));
    } catch (error) {
      console.error("Error loading holiday cards on demand:", error);
      const fallbackCards = getExperiencesForCategories(holidayCategories, holiday.id).slice(0, 3);
      setHolidayCardsById((prev) => ({ ...prev, [holiday.id]: fallbackCards }));
    } finally {
      setHolidayCardsLoadingById((prev) => ({ ...prev, [holiday.id]: false }));
    }
  }, [
    customHolidays,
    getExperiencesForCategories,
    holidayCardsById,
    holidayCardsLoadingById,
    locationLat,
    locationLng,
    selectedPill?.gender,
    selectedPillId,
    transformHolidayExperienceToCard,
  ]);

  // Merge calendar holidays with custom holidays for display, filtered by selected person's gender
  const allHolidays = useMemo(() => {
    const customHolidaysList = getPersonCustomHolidays.map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description,
      date: new Date(h.date),
      daysAway: h.daysAway,
      category: h.category,
      categories: (h as ExtendedHoliday).categories || [h.category],
      isFromCalendar: false,
      isCustom: true,
    }));

    const calendar = calendarHolidays || [];
    const custom = getPersonCustomHolidays;
    
    // Get selected person's gender for filtering
    const personGender = selectedPill?.gender || null;
    
    // Combine and filter
    return [...calendar, ...custom]
      .filter((h) => {
        // Only show upcoming holidays (within 365 days - rest of year)
        if (h.daysAway < 0 || h.daysAway > 365) return false;
        
        // Filter by gender if holiday is gender-specific
        const holidayGender = (h as any).gender;
        if (holidayGender && personGender && holidayGender !== personGender) {
          return false;
        }
        
        return true;
      })
      .sort((a, b) => a.daysAway - b.daysAway);
  }, [calendarHolidays, getPersonCustomHolidays, selectedPill?.gender]);

  const visibleHolidays = useMemo(() => {
    if (selectedPillId === "for-you") {
      return allHolidays;
    }

    const archivedKeys = new Set(archivedHolidayKeysByPerson[selectedPillId] || []);
    return allHolidays.filter(
      (holiday) => !archivedKeys.has(getHolidayArchiveKey(holiday as ExtendedHoliday))
    );
  }, [allHolidays, archivedHolidayKeysByPerson, getHolidayArchiveKey, selectedPillId]);

  const archivedHolidays = useMemo(() => {
    if (selectedPillId === "for-you") {
      return [] as CalendarHoliday[];
    }

    const archivedKeys = new Set(archivedHolidayKeysByPerson[selectedPillId] || []);
    return allHolidays.filter((holiday) =>
      archivedKeys.has(getHolidayArchiveKey(holiday as ExtendedHoliday))
    );
  }, [allHolidays, archivedHolidayKeysByPerson, getHolidayArchiveKey, selectedPillId]);

  // Animate holiday items with staggered entrance when holidays are available
  useEffect(() => {
    if (selectedPill?.pillState === 'active' && visibleHolidays.length > 0 && !holidaysLoading) {
      // Reset all holiday animations
      holidayItemAnimations.forEach((anim) => {
        anim.opacity.setValue(0);
        anim.translateX.setValue(-50);
      });

      // Staggered animation - each holiday pops in 100ms after the previous
      const staggerDelay = 100;
      const baseDelay = 400; // Start after birthday hero animation

      visibleHolidays.slice(0, 20).forEach((_, index) => {
        if (!holidayItemAnimations[index]) return; // Skip if no animation slot
        setTimeout(() => {
          Animated.parallel([
            Animated.spring(holidayItemAnimations[index].opacity, {
              toValue: 1,
              useNativeDriver: true,
              tension: 50,
              friction: 8,
            }),
            Animated.spring(holidayItemAnimations[index].translateX, {
              toValue: 0,
              useNativeDriver: true,
              tension: 50,
              friction: 8,
            }),
          ]).start();
        }, baseDelay + index * staggerDelay);
      });
    }
  }, [selectedPill, visibleHolidays, holidaysLoading, holidayItemAnimations]);

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Tabs */}
        <DiscoverTabs activeTab={activeTab} onTabChange={(tab) => {
          setActiveTab(tab);
          mixpanelService.trackTabViewed({ screen: "Discover", tab: tab === "for-you" ? "For You" : "Night Out" });
        }} />

        {/* Content */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "for-you" && (
            <>
              {/* For You Tab Header with People Pills */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tabHeaderScrollView}
                contentContainerStyle={styles.tabHeaderContent}
              >
                {/* For You Pill - Always First */}
                <TouchableOpacity
                  style={[
                    styles.personPill,
                    selectedPillId === "for-you" && styles.personPillSelectedGradient,
                  ]}
                  onPress={handleForYouSelect}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.personPillName,
                      selectedPillId === "for-you" && styles.personPillNameSelectedGradient,
                    ]}
                  >
                    For You
                  </Text>
                </TouchableOpacity>

                {/* Add Pair Button */}
                <TouchableOpacity
                  style={styles.addUserButtonPill}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsPairModalVisible(true); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="person-add-outline" size={18} color="#eb7825" />
                </TouchableOpacity>

                {/* Incoming Pair Request Pills */}
                {incomingPairRequests.map((request) => {
                  const initials = request.senderName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <TouchableOpacity
                      key={`incoming-${request.id}`}
                      style={[styles.personPill, styles.incomingRequestPill]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIncomingRequestPill(request);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.personPillAvatar}>
                        {request.senderAvatar ? (
                          <Image source={{ uri: request.senderAvatar }} style={styles.pillAvatarImage} />
                        ) : (
                          <Text style={styles.personPillInitials}>{initials}</Text>
                        )}
                      </View>
                      {/* Notification dot */}
                      <View style={styles.incomingDot} />
                    </TouchableOpacity>
                  );
                })}

                {/* Pairing Pills */}
                {pairingPills.map((pill) => {
                  const isSelected = selectedPillId === pill.id;
                  const isGreyed = pill.pillState.startsWith('greyed');
                  const isPending = pill.pillState === 'pending_active';

                  return (
                    <TouchableOpacity
                      key={pill.id}
                      style={[
                        styles.personPill,
                        isSelected && !isGreyed && styles.personPillSelectedGradient,
                        isGreyed && { opacity: 0.4 },
                      ]}
                      onPress={() => {
                        if (pill.pillState === 'active') {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSelectedPillId(pill.id);
                        } else {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setInfoPill(pill);
                        }
                      }}
                      onLongPress={() => {
                        if (pill.pillState === 'active') {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          Alert.alert(
                            "Unpair",
                            `Unpair from ${pill.displayName}? Custom holidays and saved cards for them will be removed.`,
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Unpair", style: "destructive", onPress: () => handleUnpair(pill.pairingId!) },
                            ]
                          );
                        } else {
                          setInfoPill(pill);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.personPillAvatar,
                          isSelected && !isGreyed && styles.personPillAvatarSelectedGradient,
                        ]}
                      >
                        {pill.avatarUrl ? (
                          <Image source={{ uri: pill.avatarUrl }} style={styles.pillAvatarImage} />
                        ) : (
                          <Text
                            style={[
                              styles.personPillInitials,
                              isSelected && styles.personPillInitialsSelected,
                            ]}
                          >
                            {pill.initials}
                          </Text>
                        )}
                      </View>
                      {isPending && (
                        <View style={styles.pendingPillBadge}>
                          <View style={styles.pendingPillBadgeDot} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Person-specific view when a person is selected */}
              {selectedPill?.pillState === 'active' && user?.id ? (
                <PersonHolidayView
                  pairedUserId={selectedPill.pairedUserId!}
                  pairingId={selectedPill.pairingId!}
                  displayName={selectedPill.displayName}
                  birthday={selectedPill.birthday}
                  gender={selectedPill.gender}
                  location={personViewLocation}
                  userId={user.id}
                  customHolidays={personCustomHolidays}
                  onAddCustomDay={handleOpenAddCustomDayModal}
                  fallbackCards={fallbackCardsForPerson}
                  archivedHolidayIds={personArchivedHolidayIds}
                  onArchiveHoliday={handlePersonArchiveHoliday}
                  onUnarchiveHoliday={handlePersonUnarchiveHoliday}
                  onCardPress={handlePersonCardPress}
                />
              ) : (
                <>
                  {/* Paired People Row — horizontal scroll of paired people cards */}
                  <PairedPeopleRow
                    people={pairingPills
                      .filter((p) => p.pillState === "active" && p.pairedUserId)
                      .map((p) => ({
                        pairedUserId: p.pairedUserId!,
                        pairingId: p.pairingId!,
                        displayName: p.displayName,
                        firstName: p.firstName,
                        avatarUrl: p.avatarUrl,
                        initials: p.initials,
                        birthday: p.birthday,
                        gender: p.gender,
                      }))}
                    onSelectPerson={(person) => {
                      // Find the matching pill and select it
                      const pill = pairingPills.find(
                        (p) => p.pairedUserId === person.pairedUserId
                      );
                      if (pill) {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedPillId(pill.id);
                      }
                    }}
                  />

                  {/* Loading State */}
                  {recommendationsLoading && !hasCompletedInitialFetch && (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="large" color="#eb7825" />
                      <Text style={styles.loadingText}>Discovering experiences for you...</Text>
                    </View>
                  )}

                  {/* Error State */}
                  {recommendationsError && !recommendationsLoading && (
                    <View style={styles.emptyStateContainer}>
                      <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
                      <Text style={styles.emptyStateTitle}>Something went wrong</Text>
                      <Text style={styles.emptyStateSubtitle}>{recommendationsError}</Text>
                    </View>
                  )}

                  {/* Empty State */}
                  {!recommendationsLoading && !recommendationsError && !featuredCard && gridCards.length === 0 && recommendations.length === 0 && hasCompletedInitialFetch && (
                    <View style={styles.emptyStateContainer}>
                      <Ionicons name="compass-outline" size={48} color="#eb7825" />
                      <Text style={styles.emptyStateTitle}>No experiences found</Text>
                      <Text style={styles.emptyStateSubtitle}>
                        Try adjusting your preferences to discover new activities
                      </Text>
                    </View>
                  )}

                  {/* Content - Hero Cards and Grid */}
                  {(selectedHeroCards.length > 0 || featuredCard || gridCards.length > 0) && (
                    <>
                      {/* Hero Cards — 2 side-by-side at the top (Fine Dining + Play) */}
                      {selectedHeroCards.length > 0 ? (
                        <Animated.View
                          style={{
                            opacity: featuredCardOpacity,
                            transform: [{ translateY: featuredCardSlide }],
                          }}
                        >
                          <View style={styles.heroCardsRow}>
                            {selectedHeroCards.slice(0, 2).map((heroCard) => (
                              <HeroCard
                                key={heroCard.id}
                                card={heroCard}
                                currency={accountPreferences?.currency}
                                measurementSystem={accountPreferences?.measurementSystem}
                                onPress={() => handleCardPress(heroCard)}
                              />
                            ))}
                          </View>
                        </Animated.View>
                      ) : featuredCard ? (
                        <Animated.View
                          style={{
                            opacity: featuredCardOpacity,
                            transform: [{ translateY: featuredCardSlide }],
                          }}
                        >
                          <FeaturedCard
                            card={featuredCard}
                            currency={accountPreferences?.currency}
                            measurementSystem={accountPreferences?.measurementSystem}
                            onPress={() => handleCardPress(featuredCard)}
                          />
                        </Animated.View>
                      ) : null}

                      {/* Grid Cards Section */}
                      <View style={styles.gridCardsContainer}>
                        {gridCards.map((card, index) => {
                          // Right column (odd indices) lag slightly behind left column
                          const isRightColumn = index % 2 === 1;
                          
                          return (
                            <Animated.View
                              key={`${card.id}-${index}`}
                              style={{
                                opacity: isRightColumn ? gridCardsRightOpacity : gridCardsLeftOpacity,
                                transform: [
                                  { translateY: isRightColumn ? gridCardsRightSlide : gridCardsLeftSlide },
                                ],
                              }}
                            >
                              <GridCard
                                card={card}
                                currency={accountPreferences?.currency}
                                onPress={() => handleGridCardPress(card)}
                              />
                            </Animated.View>
                          );
                        })}
                      </View>
                    </>
                  )}
                </>
              )}
            </>
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
                  <Feather name="filter" size={18} color="#eb7825" />
                  <Text style={styles.filterButtonText}>Filter</Text>
                  {activeFilterCount > 0 && (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                    </View>
                  )}
                </View>
                <Feather name="chevron-right" size={20} color="#6b7280" />
              </TouchableOpacity>

              {/* Active genre filter confirmation */}
              {selectedFilters.genre !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Feather name="music" size={14} color="#eb7825" />
                  <Text style={styles.activeFilterChipText}>
                    Showing: {getGenreLabel(selectedFilters.genre)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedFilters({ ...selectedFilters, genre: "all" })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={16} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Loading State */}
              {nightOutLoading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#eb7825" />
                  <Text style={styles.loadingText}>Discovering nightlife near you...</Text>
                </View>
              )}

              {/* Error State */}
              {nightOutError && !nightOutLoading && (
                <View style={styles.emptyStateContainer}>
                  <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
                  <Text style={styles.emptyStateTitle}>Something went wrong</Text>
                  <Text style={styles.emptyStateSubtitle}>{nightOutError}</Text>
                  <TouchableOpacity
                    style={{ marginTop: 12, paddingVertical: 8, paddingHorizontal: 20, backgroundColor: "#eb7825", borderRadius: 8 }}
                    onPress={async () => {
                      await clearNightOutCache();
                      deviceGpsFetchedRef.current = false;
                      setNightOutError(null);
                      setNightOutLoading(true);
                      setNightOutCards([]);
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
                    <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Empty State - No data at all */}
              {!nightOutLoading && !nightOutError && nightOutCards.length === 0 && (
                <View style={styles.emptyStateContainer}>
                  <Ionicons name="moon-outline" size={48} color="#eb7825" />
                  <Text style={styles.emptyStateTitle}>No events found</Text>
                  <Text style={styles.emptyStateSubtitle}>No events found near your location. Try increasing your radius.</Text>
                </View>
              )}

              {/* Empty State - Filters produced no results */}
              {!nightOutLoading && !nightOutError && nightOutCards.length > 0 && filteredNightOutCards.length === 0 && (
                <View style={styles.emptyStateContainer}>
                  <Feather name="sliders" size={48} color="#eb7825" />
                  <Text style={styles.emptyStateTitle}>No matching events</Text>
                  <Text style={styles.emptyStateSubtitle}>
                    No events match your selected filters
                  </Text>
                  <TouchableOpacity
                    style={styles.showAllPartiesButton}
                    onPress={() => setSelectedFilters({ date: "any", price: "any", genre: "all" })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.showAllPartiesText}>Show All Parties</Text>
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
        onSave={async () => {
          // Handle save if needed
        }}
        onShare={(card) => {
          // Handle share if needed
        }}
        isSaved={false}
        currentMode="solo"
        accountPreferences={accountPreferences}
      />

      {/* Pair Request Modal */}
      <PairRequestModal
        visible={isPairModalVisible}
        onClose={() => setIsPairModalVisible(false)}
        onPairRequestSent={() => {
          setIsPairModalVisible(false);
        }}
      />

      {/* Incoming Pair Request Card (tap on incoming request pill) */}
      <IncomingPairRequestCard
        visible={!!incomingRequestPill}
        request={incomingRequestPill}
        onAccept={() => setIncomingRequestPill(null)}
        onDecline={() => setIncomingRequestPill(null)}
        onClose={() => setIncomingRequestPill(null)}
      />

      {/* Pairing Info Card (tap on greyed/pending pill) */}
      <PairingInfoCard
        visible={!!infoPill}
        pill={infoPill}
        onCancel={() => {
          if (infoPill?.type === 'pending_invite') {
            cancelInviteMutation.mutate(infoPill.pendingInviteId!);
          } else if (infoPill?.pairRequestId) {
            cancelRequestMutation.mutate(infoPill.pairRequestId);
          }
          setInfoPill(null);
        }}
        onClose={() => setInfoPill(null)}
      />

      {/* Add Custom Day Modal */}
      <CustomHolidayModal
        visible={isAddCustomDayModalVisible}
        onClose={handleCloseAddCustomDayModal}
        onSave={handleCustomHolidaySave}
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
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity
                onPress={handleCloseFilterModal}
                style={styles.modalCloseButton}
              >
                <Feather name="x" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.filterModalScrollView}
              showsVerticalScrollIndicator={false}
            >
              {/* Date Filter Section */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Feather name="calendar" size={20} color="#eb7825" />
                  <Text style={styles.filterSectionTitle}>Date</Text>
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
                  <Feather name="tag" size={20} color="#eb7825" />
                  <Text style={styles.filterSectionTitle}>Price Range</Text>
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
                  <Feather name="music" size={20} color="#eb7825" />
                  <Text style={styles.filterSectionTitle}>Music Genre</Text>
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
                <Text style={styles.resetFilterButtonText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.applyFilterButton}
                onPress={handleApplyFilters}
                activeOpacity={0.7}
              >
                <Text style={styles.applyFilterButtonText}>Apply Filters</Text>
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
    backgroundColor: "#f9fafb",
    // borderWidth: 1,
    borderColor: "#e5e7eb",
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
});
function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

