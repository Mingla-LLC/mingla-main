import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  Dimensions,
  Modal,
  TextInput,
  Platform,
  Animated,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatPriceRange, parseAndFormatDistance } from "./utils/formatters";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { useRecommendations, Recommendation } from "../contexts/RecommendationsContext";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useUserLocation } from "../hooks/useUserLocation";

// Storage key for saved people
const SAVED_PEOPLE_STORAGE_KEY = "mingla_saved_people";

// Storage key for cached discover experiences (refreshes daily)
const DISCOVER_CACHE_KEY = "mingla_discover_cache";

// Saved Person interface
interface SavedPerson {
  id: string;
  name: string;
  initials: string;
  birthday: string | null;
  gender: "male" | "female" | "other" | null;
  createdAt: string;
}

const { width: screenWidth } = Dimensions.get("window");
const CARD_WIDTH = screenWidth - 32; // 16px padding on each side
const GRID_CARD_WIDTH = (screenWidth - 48) / 2; // 16px padding + 16px gap between cards
const ANIMATION_DURATION = 400;

// Category icons mapping (from PreferencesSheet categories)
const categoryIcons: { [key: string]: string } = {
  "Stroll": "eye-outline",
  "Take a Stroll": "eye-outline",
  "Sip & Chill": "cafe-outline",
  "Casual Eats": "restaurant-outline",
  "screenRelax": "desktop-outline",
  "Screen & Relax": "desktop-outline",
  "Creative & Hands-On": "color-palette-outline",
  "Picnics": "basket-outline",
  "Play & Move": "game-controller-outline",
  "Dining Experiences": "restaurant-outline",
  "Wellness Dates": "leaf-outline",
  "Freestyle": "sparkles-outline",
};

// All experience categories (must match PreferencesSheet categories)
const ALL_CATEGORIES = [
  "Stroll",
  "Sip & Chill",
  "Casual Eats",
  "Screen & Relax",
  "Creative & Hands-On",
  "Picnics",
  "Play & Move",
  "Dining Experiences",
  "Wellness Dates",
  "Freestyle",
];

// Tab types for Discover screen
export type DiscoverTab = "for-you" | "night-out";

interface DiscoverTabsProps {
  activeTab: DiscoverTab;
  onTabChange: (tab: DiscoverTab) => void;
}

// Featured card data interface
interface FeaturedCardData {
  id: string;
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
}

interface FeaturedCardProps {
  card: FeaturedCardData;
  currency?: string;
  measurementSystem?: "Metric" | "Imperial";
  onPress?: () => void;
}

interface GridCardData {
  id: string;
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
}

interface GridCardProps {
  card: GridCardData;
  currency?: string;
  onPress?: () => void;
}

// Night Out Card Data Interface
interface NightOutCardData {
  id: string;
  placeName: string;
  eventName: string;
  hostName: string;
  image: string;
  images?: string[];
  price: string;
  matchPercentage: number;
  date: string;
  time: string;
  timeRange: string;
  location: string;
  tags: string[];
  peopleGoing: number;
  address?: string;
  description?: string;
  rating?: number;
  reviewCount?: number;
  coordinates?: { lat: number; lng: number };
}

interface NightOutCardProps {
  card: NightOutCardData;
  currency?: string;
  onPress?: () => void;
}

// Filter types
type DateFilter = "any" | "today" | "tomorrow" | "weekend" | "next-week" | "month";
type PriceFilter = "any" | "free" | "under-25" | "25-50" | "50-100" | "over-100";
type GenreFilter = "all" | "afrobeats" | "hiphop-rnb" | "house" | "techno" | "jazz-blues";

interface NightOutFilters {
  date: DateFilter;
  price: PriceFilter;
  genre: GenreFilter;
}

interface DiscoverScreenProps {
  onAddFriend?: () => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
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
          {formattedDistance && (
            <View style={styles.travelInfoBadge}>
              <Ionicons name="location-outline" size={14} color="white" />
              <Text style={styles.travelInfoText}>{formattedDistance}</Text>
            </View>
          )}
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

        {/* Bottom Row: Price Range and Rating */}
        <View style={styles.gridCardFooter}>
          <Text style={styles.gridCardPrice}>{formattedPrice}</Text>
          <View style={styles.gridCardRatingContainer}>
            <Ionicons name="star" size={12} color="#eb7825" />
            <Text style={styles.gridCardRatingText}>{card.rating.toFixed(1)}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Night Out Card Component (60% height of featured card)
const NightOutCard: React.FC<NightOutCardProps> = ({ card, currency = "USD", onPress }) => {
  return (
    <TouchableOpacity 
      style={styles.nightOutCard}
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Card Image Section */}
      <View style={styles.nightOutCardImageContainer}>
        <Image
          source={{ uri: card.image }}
          style={styles.nightOutCardImage}
          resizeMode="cover"
        />
        
        {/* Top Left: Match Percentage Badge */}
        <View style={styles.matchBadge}>
          <Ionicons name="star" size={12} color="white" />
          <Text style={styles.matchBadgeText}>{card.matchPercentage}% match</Text>
        </View>
        
        {/* Top Right: Price Badge */}
        <View style={styles.nightOutPriceBadge}>
          <Text style={styles.nightOutPriceBadgeText}>{card.price}</Text>
        </View>
        
        {/* Bottom Left: Place Info Stack */}
        <View style={styles.placeInfoStack}>
          {/* Place Name */}
          <Text style={styles.placeNameText} numberOfLines={1}>{card.placeName}</Text>
          
          {/* Date and Time Row */}
          <View style={styles.dateTimeRow}>
            <View style={styles.infoBadge}>
              <Ionicons name="calendar-outline" size={12} color="white" />
              <Text style={styles.infoBadgeText}>{card.date}</Text>
            </View>
            <View style={styles.infoBadge}>
              <Ionicons name="time-outline" size={12} color="white" />
              <Text style={styles.infoBadgeText}>{card.time}</Text>
            </View>
          </View>
          
          {/* Location Row */}
          <View style={styles.infoBadge}>
            <Ionicons name="location-outline" size={12} color="white" />
            <Text style={styles.infoBadgeText} numberOfLines={1}>{card.location}</Text>
          </View>
        </View>
      </View>

      {/* Card Content Section */}
      <View style={styles.nightOutCardContent}>
        {/* Event Name and Host Row */}
        <View style={styles.eventHostRow}>
          <Text style={styles.eventName} numberOfLines={1}>{card.eventName}</Text>
          <Text style={styles.dotSeparator}>•</Text>
          <Text style={styles.hostName} numberOfLines={1}>{card.hostName}</Text>
        </View>

        {/* Tags Row */}
        <View style={styles.tagsRow}>
          {card.tags.slice(0, 4).map((tag, index) => (
            <View key={index} style={styles.tagBadge}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* Bottom Info Row */}
        <View style={styles.nightOutBottomRow}>
          {/* Left: Date and People */}
          <View style={styles.leftInfoColumn}>
            <Text style={styles.bottomInfoLabel}>{card.date}</Text>
            <Text style={styles.bottomInfoValue}>{card.peopleGoing} going</Text>
          </View>
          
          {/* Right: Time Range and Price */}
          <View style={styles.rightInfoColumn}>
            <Text style={styles.bottomInfoLabel}>{card.timeRange}</Text>
            <Text style={styles.bottomInfoPrice}>{card.price}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default function DiscoverScreen({
  onAddFriend,
  accountPreferences,
}: DiscoverScreenProps) {
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
  
  // Add Person Modal state
  const [isAddPersonModalVisible, setIsAddPersonModalVisible] = useState(false);
  const [personName, setPersonName] = useState("");
  const [personBirthday, setPersonBirthday] = useState<Date | null>(null);
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [personGender, setPersonGender] = useState<"male" | "female" | "other" | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Saved people state
  const [savedPeople, setSavedPeople] = useState<SavedPerson[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("for-you"); // "for-you" or person.id

  // Get the currently selected person (null if "for-you" is selected)
  const selectedPerson = useMemo(() => {
    if (selectedPersonId === "for-you") return null;
    return savedPeople.find((p) => p.id === selectedPersonId) || null;
  }, [selectedPersonId, savedPeople]);

  // Holiday detection helper - checks for upcoming holidays relevant to person
  const getUpcomingHolidays = useCallback((person: SavedPerson | null): string[] => {
    const holidays: string[] = [];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    // Check for Valentine's Day (Feb 14) - within 2 weeks before
    if (currentMonth === 1 && currentDay >= 1 && currentDay <= 14) {
      holidays.push("valentines");
    }

    // Check for Mother's Day (2nd Sunday of May) - within 2 weeks before
    if (currentMonth === 4 && currentDay >= 1 && currentDay <= 14 && person?.gender === "female") {
      holidays.push("mothers-day");
    }

    // Check for Father's Day (3rd Sunday of June) - within 2 weeks before
    if (currentMonth === 5 && currentDay >= 7 && currentDay <= 21 && person?.gender === "male") {
      holidays.push("fathers-day");
    }

    // Check if person's birthday is upcoming (within 2 weeks)
    if (person?.birthday) {
      const birthday = new Date(person.birthday);
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
  const getGenderCategories = useCallback((gender: "male" | "female" | "other" | null): string[] | null => {
    if (!gender) return null;
    // Return categories that tend to resonate more with specific genders
    // null means no filter (show all)
    if (gender === "female") {
      return ["Wellness Dates", "Sip & Chill", "Creative & Hands-On", "Dining Experiences", "Picnics"];
    }
    if (gender === "male") {
      return ["Play & Move", "Casual Eats", "Dining Experiences", "Sip & Chill", "Screen & Relax"];
    }
    return null; // "other" - show all
  }, []);

  // Load saved people from AsyncStorage on mount
  useEffect(() => {
    const loadSavedPeople = async () => {
      try {
        const stored = await AsyncStorage.getItem(SAVED_PEOPLE_STORAGE_KEY);
        if (stored) {
          const people = JSON.parse(stored) as SavedPerson[];
          setSavedPeople(people);
        }
      } catch (error) {
        console.error("Error loading saved people:", error);
      }
    };
    loadSavedPeople();
  }, []);

  // Generate unique ID
  const generateUniqueId = (): string => {
    return `person_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Generate initials from name
  const generateInitials = (name: string): string => {
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase();
    }
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  };

  // Save people to AsyncStorage
  const savePeopleToStorage = async (people: SavedPerson[]) => {
    try {
      await AsyncStorage.setItem(SAVED_PEOPLE_STORAGE_KEY, JSON.stringify(people));
    } catch (error) {
      console.error("Error saving people to storage:", error);
    }
  };

  // Night Out Filter Modal state
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<NightOutFilters>({
    date: "any",
    price: "any",
    genre: "all",
  });

  // Get auth and location for custom Discover fetch
  const { user } = useAuthSimple();
  const { data: userLocationData } = useUserLocation(user?.id, "solo", undefined);
  
  // Extract stable lat/lng values to prevent unnecessary re-fetches
  const locationLat = userLocationData?.lat;
  const locationLng = userLocationData?.lng;

  // State for Discover-specific recommendations (fetched with ALL categories)
  const [discoverRecommendations, setDiscoverRecommendations] = useState<Recommendation[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasCompletedDiscoverFetch, setHasCompletedDiscoverFetch] = useState(false);
  const hasFetchedRef = useRef(false);
  const loadedFromCacheRef = useRef(false); // Flag to skip card re-randomization when loaded from cache

  // Helper to get today's date string (YYYY-MM-DD format)
  const getTodayDateString = (): string => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  // Cache interface for storing discover experiences
  interface DiscoverCache {
    date: string;
    recommendations: Recommendation[];
    featuredCard: FeaturedCardData | null;
    gridCards: GridCardData[];
  }

  // Save discover data to cache
  const saveDiscoverCache = async (
    recommendations: Recommendation[],
    featuredCard: FeaturedCardData | null,
    gridCards: GridCardData[]
  ) => {
    try {
      const cacheData: DiscoverCache = {
        date: getTodayDateString(),
        recommendations,
        featuredCard,
        gridCards,
      };
      await AsyncStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify(cacheData));
      console.log("Saved discover cache for date:", cacheData.date);
    } catch (error) {
      console.error("Error saving discover cache:", error);
    }
  };

  // Load discover data from cache
  const loadDiscoverCache = async (): Promise<DiscoverCache | null> => {
    try {
      const cached = await AsyncStorage.getItem(DISCOVER_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as DiscoverCache;
      }
    } catch (error) {
      console.error("Error loading discover cache:", error);
    }
    return null;
  };

  // Fetch recommendations with ALL 10 categories for the Discover "For You" tab
  // Only fetches once per day - uses cached data if available for today
  useEffect(() => {
    const fetchDiscoverRecommendations = async () => {
      // Only run when we have location and not already loading
      if (!locationLat || !locationLng) {
        return;
      }
      
      // Only fetch once per session
      if (hasFetchedRef.current) {
        return;
      }
      hasFetchedRef.current = true;
      
      setDiscoverLoading(true);
      setDiscoverError(null);

      try {
        // Check if we have cached data for today
        const cachedData = await loadDiscoverCache();
        const today = getTodayDateString();

        if (cachedData && cachedData.date === today && cachedData.recommendations.length > 0) {
          // Use cached data - it's still valid for today
          console.log("Using cached discover data from:", cachedData.date);
          
          // Set flag BEFORE setting state to prevent card selection useEffect from re-randomizing
          loadedFromCacheRef.current = true;
          
          // Also restore the selected cards from cache to prevent re-randomization
          if (cachedData.featuredCard) {
            setSelectedFeaturedCard(cachedData.featuredCard);
          }
          if (cachedData.gridCards && cachedData.gridCards.length > 0) {
            setSelectedGridCards(cachedData.gridCards);
          }
          
          setDiscoverRecommendations(cachedData.recommendations);
          setHasCompletedDiscoverFetch(true);
          setDiscoverLoading(false);
          return;
        }

        // Cache is stale or missing - fetch fresh data
        console.log("Cache miss or stale. Fetching fresh discover data...");

        // Use new discoverExperiences method that calls discover-experiences edge function
        // Returns { cards: 10 category cards, featuredCard: 11th unique card }
        const { cards: generatedCards, featuredCard } = await ExperienceGenerationService.discoverExperiences(
          { lat: locationLat, lng: locationLng },
          10000 // 10km radius
        );

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
          openingHours: exp.openingHours ? JSON.stringify(exp.openingHours) : "",
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

        // Transform featured card if present AND it's different from all grid cards
        let transformedFeatured: FeaturedCardData | null = null;
        const gridCardIds = new Set(generatedCards.map((exp: any) => exp.id));
        
        if (featuredCard && !gridCardIds.has(featuredCard.id)) {
          // Featured card is unique - use it
          transformedFeatured = {
            id: featuredCard.id,
            title: featuredCard.title,
            experienceType: featuredCard.category,
            description: featuredCard.description,
            image: featuredCard.heroImage,
            images: featuredCard.images || [featuredCard.heroImage],
            priceRange: featuredCard.priceRange,
            rating: featuredCard.rating,
            reviewCount: featuredCard.reviewCount,
            address: featuredCard.address,
            travelTime: featuredCard.travelTime,
            distance: featuredCard.distance,
            highlights: featuredCard.highlights || [],
            tags: featuredCard.highlights || [],
            location: featuredCard.lat && featuredCard.lng 
              ? { lat: featuredCard.lat, lng: featuredCard.lng } 
              : undefined,
          };
          console.log("Set unique featured card:", transformedFeatured.title);
        } else {
          // Featured card is duplicate or missing - pick best from grid cards (keep all 10 in grid)
          console.log("Featured card duplicate/missing, selecting best from grid cards...");
          const sortedByRating = [...generatedCards].sort((a: any, b: any) => {
            const aScore = (a.rating || 0) * Math.log10((a.reviewCount || 1) + 1);
            const bScore = (b.rating || 0) * Math.log10((b.reviewCount || 1) + 1);
            return bScore - aScore;
          });
          const bestCard = sortedByRating[0];
          if (bestCard) {
            // Create featured with unique ID suffix (keeping all 10 in grid)
            transformedFeatured = {
              id: `${bestCard.id}_featured`,
              title: bestCard.title,
              experienceType: bestCard.category,
              description: bestCard.description,
              image: bestCard.heroImage,
              images: bestCard.images || [bestCard.heroImage],
              priceRange: bestCard.priceRange,
              rating: bestCard.rating,
              reviewCount: bestCard.reviewCount,
              address: bestCard.address,
              travelTime: bestCard.travelTime,
              distance: bestCard.distance,
              highlights: bestCard.highlights || [],
              tags: bestCard.highlights || [],
              location: bestCard.lat && bestCard.lng 
                ? { lat: bestCard.lat, lng: bestCard.lng } 
                : undefined,
            };
            console.log("Featured card selected from grid:", transformedFeatured.title);
          }
        }
        setSelectedFeaturedCard(transformedFeatured);

        // Transform ALL 10 cards to grid cards (no removal)
        const gridCards: GridCardData[] = generatedCards.map((exp: any) => ({
          id: exp.id,
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
        }));
        setSelectedGridCards(gridCards);
        console.log("Set grid cards:", gridCards.length, "cards");

        setDiscoverRecommendations(transformed);
        setHasCompletedDiscoverFetch(true);
        
        // Save to cache for 24-hour persistence
        saveDiscoverCache(transformed, transformedFeatured, gridCards);
        
        // Mark as loaded from cache to skip the card selection useEffect
        loadedFromCacheRef.current = true;
      } catch (error) {
        console.error("Error fetching Discover recommendations:", error);
        setDiscoverError("Failed to load recommendations");
        hasFetchedRef.current = false; // Allow retry on error
      } finally {
        setDiscoverLoading(false);
      }
    };

    fetchDiscoverRecommendations();
  }, [locationLat, locationLng]); // TESTING: Removed user?.id dependency

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
  });

  // State for selected cards (to prevent re-randomization on every render)
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

    // Save to cache for daily persistence
    saveDiscoverCache(recommendations, featured, grid);
  }, [recommendations]);

  // Use the stable selected cards
  const featuredCard = selectedFeaturedCard;
  const gridCards = selectedGridCards;

  // Mock night out cards data - replace with real data
  const nightOutCards: NightOutCardData[] = [
    {
      id: "night-1",
      placeName: "Skyline Lounge",
      eventName: "Sunset Sessions",
      hostName: "DJ Marcus",
      image: "https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800",
      images: ["https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=800"],
      price: "$45",
      matchPercentage: 92,
      date: "Feb 14",
      time: "8:00 PM",
      timeRange: "8PM - 2AM",
      location: "Downtown Rooftop",
      tags: ["Upbeat", "Social", "Trendy", "Live DJ"],
      peopleGoing: 156,
      address: "123 Skyline Blvd",
      description: "Experience the ultimate rooftop party with stunning city views.",
      rating: 4.8,
      reviewCount: 234,
      coordinates: { lat: 40.7128, lng: -74.0060 },
    },
    {
      id: "night-2",
      placeName: "The Jazz Corner",
      eventName: "Late Night Jazz",
      hostName: "Blue Note Quartet",
      image: "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800",
      images: ["https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800"],
      price: "$35",
      matchPercentage: 87,
      date: "Feb 15",
      time: "9:30 PM",
      timeRange: "9PM - 1AM",
      location: "Arts District",
      tags: ["Chill", "Live Music", "Intimate", "Classy"],
      peopleGoing: 89,
      address: "456 Jazz Ave",
      description: "Smooth jazz vibes in an intimate speakeasy setting.",
      rating: 4.9,
      reviewCount: 178,
      coordinates: { lat: 40.7148, lng: -74.0068 },
    },
    {
      id: "night-3",
      placeName: "Neon Club",
      eventName: "Electric Nights",
      hostName: "DJ Elena",
      image: "https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800",
      images: ["https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800"],
      price: "$55",
      matchPercentage: 78,
      date: "Feb 16",
      time: "10:00 PM",
      timeRange: "10PM - 4AM",
      location: "Warehouse District",
      tags: ["EDM", "Dancing", "Energetic", "VIP"],
      peopleGoing: 342,
      address: "789 Neon St",
      description: "The hottest EDM night with international DJs.",
      rating: 4.6,
      reviewCount: 456,
      coordinates: { lat: 40.7185, lng: -74.0020 },
    },
    {
      id: "night-4",
      placeName: "Velvet Room",
      eventName: "Cocktail Masterclass",
      hostName: "Mixologist Mike",
      image: "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800",
      images: ["https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800"],
      price: "$65",
      matchPercentage: 95,
      date: "Feb 17",
      time: "7:00 PM",
      timeRange: "7PM - 11PM",
      location: "Midtown",
      tags: ["Sophisticated", "Learning", "Premium", "Small Group"],
      peopleGoing: 24,
      address: "321 Velvet Lane",
      description: "Learn to craft signature cocktails from award-winning mixologists.",
      rating: 4.9,
      reviewCount: 67,
      coordinates: { lat: 40.7200, lng: -74.0100 },
    },
    {
      id: "night-5",
      placeName: "Luna Terrace",
      eventName: "Moonlight Dinner",
      hostName: "Chef Isabella",
      image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800",
      images: ["https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800"],
      price: "$120",
      matchPercentage: 88,
      date: "Feb 18",
      time: "8:30 PM",
      timeRange: "8PM - 12AM",
      location: "Harbor View",
      tags: ["Romantic", "Fine Dining", "Scenic", "Exclusive"],
      peopleGoing: 48,
      address: "555 Luna Way",
      description: "An unforgettable dining experience under the stars.",
      rating: 4.8,
      reviewCount: 123,
      coordinates: { lat: 40.7165, lng: -74.0045 },
    },
  ];

  // Transform FeaturedCardData to ExpandedCardData
  const handleCardPress = (card: FeaturedCardData) => {
    const expandedCardData: ExpandedCardData = {
      id: card.id,
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
      selectedDateTime: new Date(),
    };
    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  // Transform GridCardData to ExpandedCardData
  const handleGridCardPress = (card: GridCardData) => {
    const expandedCardData: ExpandedCardData = {
      id: card.id,
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
      selectedDateTime: new Date(),
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
      description: card.description || "",
      fullDescription: card.description || "",
      image: card.image,
      images: card.images || [card.image],
      rating: card.rating || 4.5,
      reviewCount: card.reviewCount || 0,
      priceRange: card.price,
      distance: "",
      travelTime: "",
      address: card.address || card.location,
      highlights: [card.placeName, card.hostName, `${card.peopleGoing} going`],
      tags: card.tags,
      matchScore: card.matchPercentage,
      matchFactors: {
        location: 90,
        budget: 85,
        category: card.matchPercentage,
        time: 85,
        popularity: 88,
      },
      socialStats: {
        views: card.peopleGoing * 5,
        likes: Math.floor(card.peopleGoing * 2.5),
        saves: Math.floor(card.peopleGoing * 0.8),
        shares: Math.floor(card.peopleGoing * 0.3),
      },
      location: card.coordinates,
      selectedDateTime: new Date(),
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

  const handleApplyFilters = () => {
    // TODO: Implement filter logic
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
    { id: "any", label: "Any Date" },
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "weekend", label: "This Weekend" },
    { id: "next-week", label: "Next Week" },
    { id: "month", label: "This Month" },
  ];

  const priceFilterOptions: { id: PriceFilter; label: string }[] = [
    { id: "any", label: "Any Price" },
    { id: "free", label: "Free" },
    { id: "under-25", label: `Under ${currencySymbol}25` },
    { id: "25-50", label: `${currencySymbol}25 - ${currencySymbol}50` },
    { id: "50-100", label: `${currencySymbol}50 - ${currencySymbol}100` },
    { id: "over-100", label: `Over ${currencySymbol}100` },
  ];

  const genreFilterOptions: { id: GenreFilter; label: string }[] = [
    { id: "all", label: "All Genres" },
    { id: "afrobeats", label: "Afrobeats" },
    { id: "hiphop-rnb", label: "Hip-Hop / R&B" },
    { id: "house", label: "House / Electronic" },
    { id: "techno", label: "Techno / Electronic" },
    { id: "jazz-blues", label: "Jazz / Blues" },
  ];

  // Add Person Modal handlers
  const handleOpenAddPersonModal = () => {
    setIsAddPersonModalVisible(true);
    setNameError(null);
  };

  const handleCloseAddPersonModal = () => {
    setIsAddPersonModalVisible(false);
    setPersonName("");
    setPersonBirthday(null);
    setShowBirthdayPicker(false);
    setPersonGender(null);
    setNameError(null);
  };

  const handleAddPerson = async () => {
    // Validate name is required
    const trimmedName = personName.trim();
    if (!trimmedName) {
      setNameError("Name is required");
      return;
    }

    // Create new person
    const newPerson: SavedPerson = {
      id: generateUniqueId(),
      name: trimmedName,
      initials: generateInitials(trimmedName),
      birthday: personBirthday ? personBirthday.toISOString() : null,
      gender: personGender,
      createdAt: new Date().toISOString(),
    };

    // Add to saved people
    const updatedPeople = [...savedPeople, newPerson];
    setSavedPeople(updatedPeople);

    // Save to AsyncStorage
    await savePeopleToStorage(updatedPeople);

    // Close modal and reset form
    handleCloseAddPersonModal();
  };

  // Handle person pill selection ("for-you" or person.id)
  const handlePersonSelect = (personId: string) => {
    setSelectedPersonId(personId);
  };

  // Handle "For You" selection
  const handleForYouSelect = () => {
    setSelectedPersonId("for-you");
  };

  // Handle removing a person
  const handleRemovePerson = async (personId: string) => {
    const updatedPeople = savedPeople.filter((p) => p.id !== personId);
    setSavedPeople(updatedPeople);
    await savePeopleToStorage(updatedPeople);
    if (selectedPersonId === personId) {
      setSelectedPersonId("for-you");
    }
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

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Tabs */}
        <DiscoverTabs activeTab={activeTab} onTabChange={setActiveTab} />

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
                    selectedPersonId === "for-you" && styles.personPillSelectedGradient,
                  ]}
                  onPress={handleForYouSelect}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.personPillAvatar,
                      selectedPersonId === "for-you" && styles.personPillAvatarSelectedGradient,
                    ]}
                  >
                    <Ionicons
                      name="person"
                      size={14}
                      color={selectedPersonId === "for-you" ? "white" : "#6b7280"}
                    />
                  </View>
                  <Text
                    style={[
                      styles.personPillName,
                      selectedPersonId === "for-you" && styles.personPillNameSelectedGradient,
                    ]}
                  >
                    For You
                  </Text>
                </TouchableOpacity>

                {/* Add Person Button */}
                <TouchableOpacity
                  style={styles.addUserButtonPill}
                  onPress={handleOpenAddPersonModal}
                  activeOpacity={0.7}
                >
                  <Ionicons name="person-add-outline" size={18} color="#eb7825" />
                </TouchableOpacity>

                {/* Saved People Pills */}
                {savedPeople.map((person) => (
                  <View
                    key={person.id}
                    style={[
                      styles.personPill,
                      selectedPersonId === person.id && styles.personPillSelectedGradient,
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.personPillTouchable}
                      onPress={() => handlePersonSelect(person.id)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.personPillAvatar,
                          selectedPersonId === person.id && styles.personPillAvatarSelectedGradient,
                        ]}
                      >
                        <Text
                          style={[
                            styles.personPillInitials,
                            selectedPersonId === person.id && styles.personPillInitialsSelected,
                          ]}
                        >
                          {person.initials}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.personPillName,
                          selectedPersonId === person.id && styles.personPillNameSelectedGradient,
                        ]}
                        numberOfLines={1}
                      >
                        {person.name.split(" ")[0]}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.personPillRemoveButton,
                        selectedPersonId === person.id && styles.personPillRemoveButtonSelected,
                      ]}
                      onPress={() => handleRemovePerson(person.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name="close"
                        size={14}
                        color={selectedPersonId === person.id ? "white" : "#9ca3af"}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>

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
              {!recommendationsLoading && !recommendationsError && !featuredCard && hasCompletedInitialFetch && (
                <View style={styles.emptyStateContainer}>
                  <Ionicons name="compass-outline" size={48} color="#eb7825" />
                  <Text style={styles.emptyStateTitle}>No experiences found</Text>
                  <Text style={styles.emptyStateSubtitle}>
                    Try adjusting your preferences to discover new activities
                  </Text>
                </View>
              )}

              {/* Content - Featured Card and Grid */}
              {featuredCard && (
                <>
                  {/* Featured Card */}
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

                  {/* Grid Cards Section */}
                  <View style={styles.gridCardsContainer}>
                    {gridCards.map((card, index) => {
                      // Right column (odd indices) lag slightly behind left column
                      const isRightColumn = index % 2 === 1;
                      
                      return (
                        <Animated.View
                          key={card.id}
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

          {activeTab === "night-out" && (
            <View style={styles.nightOutContent}>
              {/* Filter Button */}
              <TouchableOpacity
                style={styles.filterButton}
                onPress={handleOpenFilterModal}
                activeOpacity={0.7}
              >
                <View style={styles.filterButtonLeft}>
                  <Ionicons name="funnel" size={18} color="#eb7825" />
                  <Text style={styles.filterButtonText}>Filter</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </TouchableOpacity>

              {/* Night Out Cards */}
              {nightOutCards.map((card) => (
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

      {/* Add Person Modal */}
      <Modal
        visible={isAddPersonModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCloseAddPersonModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.addPersonModalContent}>
            {/* Modal Header */}
            <View style={styles.addPersonModalHeader}>
              <Text style={styles.addPersonModalTitle}>Add person</Text>
              <TouchableOpacity
                onPress={handleCloseAddPersonModal}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* Name Field */}
            <View style={styles.addPersonFieldContainer}>
              <Text style={styles.addPersonFieldLabel}>Name</Text>
              <TextInput
                style={[
                  styles.addPersonInput,
                  nameError && styles.addPersonInputError,
                ]}
                value={personName}
                onChangeText={(text) => {
                  setPersonName(text);
                  if (nameError) setNameError(null);
                }}
                placeholder="Enter name"
                placeholderTextColor="#9ca3af"
              />
              {nameError && (
                <Text style={styles.errorText}>{nameError}</Text>
              )}
            </View>

            {/* Birthday Field */}
            <View style={styles.addPersonFieldContainer}>
              <Text style={styles.addPersonFieldLabel}>Birthday</Text>
              <TouchableOpacity
                style={styles.addPersonInput}
                onPress={() => setShowBirthdayPicker(true)}
                activeOpacity={0.7}
              >
                {personBirthday ? (
                  <Text style={styles.birthdayText}>
                    {formatBirthdayForDisplay(personBirthday)}
                  </Text>
                ) : (
                  <Text style={styles.birthdayPlaceholder}>MM/DD/YYYY</Text>
                )}
              </TouchableOpacity>
              {showBirthdayPicker && (
                Platform.OS === "ios" ? (
                  <View style={styles.datePickerContainer}>
                    <DateTimePicker
                      value={personBirthday || new Date()}
                      mode="date"
                      display="spinner"
                      onChange={handleBirthdayChange}
                      maximumDate={new Date()}
                    />
                    <TouchableOpacity
                      style={styles.datePickerDoneButton}
                      onPress={() => setShowBirthdayPicker(false)}
                    >
                      <Text style={styles.datePickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <DateTimePicker
                    value={personBirthday || new Date()}
                    mode="date"
                    display="default"
                    onChange={handleBirthdayChange}
                    maximumDate={new Date()}
                  />
                )
              )}
            </View>

            {/* Gender Selection */}
            <View style={styles.addPersonFieldContainer}>
              <Text style={styles.addPersonFieldLabel}>Gender</Text>
              <View style={styles.genderOptionsContainer}>
                {(["male", "female", "other"] as const).map((gender) => (
                  <TouchableOpacity
                    key={gender}
                    style={[
                      styles.genderOption,
                      personGender === gender && styles.genderOptionSelected,
                    ]}
                    onPress={() => setPersonGender(gender)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.genderOptionText,
                        personGender === gender && styles.genderOptionTextSelected,
                      ]}
                    >
                      {gender.charAt(0).toUpperCase() + gender.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.addPersonButtonsContainer}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCloseAddPersonModal}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addPersonButton}
                onPress={handleAddPerson}
                activeOpacity={0.7}
              >
                <Text style={styles.addPersonButtonText}>Add person</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Night Out Filter Modal */}
      <Modal
        visible={isFilterModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCloseFilterModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.filterModalContent}>
            {/* Modal Header */}
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filter Events</Text>
              <TouchableOpacity
                onPress={handleCloseFilterModal}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.filterModalScrollView}
              showsVerticalScrollIndicator={false}
            >
              {/* Date Filter Section */}
              <View style={styles.filterSection}>
                <View style={styles.filterSectionHeader}>
                  <Ionicons name="calendar" size={20} color="#eb7825" />
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
                  <Ionicons name="pricetag" size={20} color="#eb7825" />
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
                  <Ionicons name="musical-notes" size={20} color="#eb7825" />
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
    backgroundColor: "white",
  },
  container: {
    flex: 1,
    backgroundColor: "white",
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
  // Night Out Card styles
  nightOutCard: {
    backgroundColor: "white",
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 16,
  },
  nightOutCardImageContainer: {
    position: "relative",
    height: 190,
  },
  nightOutCardImage: {
    width: "100%",
    height: "100%",
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
  nightOutCardContent: {
    padding: 14,
    gap: 10,
  },
  eventHostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    flexShrink: 1,
  },
  dotSeparator: {
    fontSize: 14,
    color: "#9ca3af",
  },
  hostName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
    flexShrink: 1,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagBadge: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  nightOutBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 4,
  },
  leftInfoColumn: {
    gap: 2,
  },
  rightInfoColumn: {
    alignItems: "flex-end",
    gap: 2,
  },
  bottomInfoLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  bottomInfoValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  bottomInfoPrice: {
    fontSize: 14,
    fontWeight: "700",
    color: "#eb7825",
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
    borderWidth: 1,
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
    backgroundColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
  },
  personPillAvatarSelected: {
    backgroundColor: "#eb7825",
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
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  personPillNameSelectedGradient: {
    color: "white",
  },
  addUserButtonPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEF3E7",
    borderWidth: 1,
    borderColor: "#fcd9b6",
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
  // Error styles
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
  },
  addPersonInputError: {
    borderColor: "#ef4444",
  },
  // Add Person Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
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
    marginBottom: 24,
  },
  addPersonModalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  modalCloseButton: {
    padding: 4,
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
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#111827",
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
  // Filter Modal styles
  filterModalContent: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
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
    fontSize: 14,
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
});
