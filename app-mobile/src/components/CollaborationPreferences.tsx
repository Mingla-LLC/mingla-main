import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Platform,
  Modal,
  Switch,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar } from "./ui/calendar";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useBoardSession } from "../hooks/useBoardSession";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";
import { offlineService } from "../services/offlineService";
import { PreferencesService } from "../services/preferencesService";
import {
  geocodingService,
  AutocompleteSuggestion,
} from "../services/geocodingService";
import { getCurrencySymbol, formatNumberWithCommas } from "../utils/currency";
import { getRate } from "../services/currencyService";
import { PRICE_TIERS, TIER_BY_SLUG, PriceTierSlug } from '../constants/priceTiers';
import { KeyboardAwareScrollView } from './ui/KeyboardAwareScrollView';
import { TRAVEL_TIME_PRESETS } from '../types/onboarding';

interface CollaborationPreferencesProps {
  isOpen: boolean;
  onClose: () => void;
  sessionName: string;
  sessionId: string; // Add this prop
  participants: Array<{ id: string; name: string; avatar?: string }>;
  onSave: (preferences: any) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
}

// Experience Types for collaboration (matching PreferencesSheet)
const experienceTypes = [
  { id: "adventurous",   label: "Adventurous",   icon: "compass-outline" },
  { id: "first-date",    label: "First Date",    icon: "people-outline" },
  { id: "romantic",      label: "Romantic",       icon: "heart-outline" },
  { id: "friendly",      label: "Friendly",       icon: "people-outline" },
  { id: "group-fun",     label: "Group Fun",      icon: "people-circle-outline" },
  { id: "picnic-dates",  label: "Picnic Dates",   icon: "basket-outline" },
  { id: "take-a-stroll", label: "Take a Stroll",  icon: "walk-outline" },
];

// Budget presets removed — using PRICE_TIERS from constants/priceTiers

// Categories
const categories = [
  { id: "nature", label: "Nature", icon: "leaf-outline" },
  { id: "first_meet", label: "First Meet", icon: "chatbubbles-outline" },
  { id: "picnic_park", label: "Picnic Park", icon: "basket-outline" },
  { id: "drink", label: "Drink", icon: "wine-outline" },
  { id: "casual_eats", label: "Casual Eats", icon: "fast-food-outline" },
  { id: "fine_dining", label: "Fine Dining", icon: "restaurant-outline" },
  { id: "watch", label: "Watch", icon: "film-outline" },
  {
    id: "creative_arts",
    label: "Creative & Arts",
    icon: "color-palette-outline",
  },
  { id: "play", label: "Play", icon: "game-controller-outline" },
  { id: "wellness", label: "Wellness", icon: "body-outline" },
  { id: "groceries_flowers", label: "Groceries & Flowers", icon: "cart-outline" },
  { id: "work_business", label: "Work & Business", icon: "briefcase-outline" },
];

// Travel modes
const travelModes = [
  { id: "walking", label: "Walking", icon: "walk-outline" },
  { id: "biking", label: "Biking", icon: "bicycle-outline" },
  { id: "transit", label: "Public Transit", icon: "bus-outline" },
  { id: "driving", label: "Driving", icon: "car-outline" },
];

// Date options
const dateOptions = [
  { id: "Now", label: "Now", description: "Leave immediately" },
  { id: "Today", label: "Today", description: "Pick a time" },
  { id: "This Weekend", label: "This Weekend", description: "Fri-Sun" },
  { id: "Pick a Date", label: "Pick a Date", description: "Custom date" },
];

// Time slots
const timeSlots = [
  { id: "brunch", label: "Brunch", time: "11–1", icon: "cafe-outline" },
  { id: "afternoon", label: "Afternoon", time: "2–5", icon: "sunny-outline" },
  { id: "dinner", label: "Dinner", time: "6–9", icon: "restaurant-outline" },
  { id: "lateNight", label: "Late Night", time: "10–12", icon: "moon-outline" },
];

type DateOption = "Now" | "Today" | "This Weekend" | "Pick a Date";
type TimeSlot = "brunch" | "afternoon" | "dinner" | "lateNight";

export default function CollaborationPreferences({
  isOpen,
  onClose,
  sessionName,
  sessionId, // Add this
  participants,
  onSave,
  accountPreferences,
}: CollaborationPreferencesProps) {
  const queryClient = useQueryClient();
  const user = useAppStore((state) => state.user);
  const insets = useSafeAreaInsets();

  // Currency symbol for Budget section
  const currencySymbol = getCurrencySymbol(accountPreferences?.currency);
  const currencyCode = accountPreferences?.currency || "USD";

  // Experience Types (Intents)
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);

  // Price Tiers
  const [selectedPriceTiers, setSelectedPriceTiers] = useState<PriceTierSlug[]>(['chill', 'comfy', 'bougie', 'lavish']);

  // Categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Refs for synchronous access in toggle callbacks (avoids stale closure bug)
  const selectedIntentsRef = useRef(selectedIntents);
  selectedIntentsRef.current = selectedIntents;
  const selectedCategoriesRef = useRef(selectedCategories);
  selectedCategoriesRef.current = selectedCategories;

  // Date & Time
  const [selectedDateOption, setSelectedDateOption] =
    useState<DateOption | null>("Now");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<TimeSlot | null>(
    null
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedWeekendDay, setSelectedWeekendDay] = useState<
    "saturday" | "sunday" | null
  >(null);
  const [exactTime, setExactTime] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Travel Mode
  const [travelMode, setTravelMode] = useState<string>("walking");

  // Travel Limit
  const constraintType = 'time' as const;
  const [constraintValue, setConstraintValue] = useState<number | "">(30);
  const [showCustomTravelTime, setShowCustomTravelTime] = useState(false);

  // Starting Location
  const [useLocation, setUseLocation] = useState<"gps" | "search">("gps");
  const [searchLocation, setSearchLocation] = useState<string>("");
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);

  // Location autocomplete suggestions
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSelectingSuggestion = useRef(false);

  // Selection limit messages
  const [minSelectionMessage, setMinSelectionMessage] = useState(false);
  const [categoryCapMessage, setCategoryCapMessage] = useState(false);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);

  // Load preferences from database using useBoardSession hook
  const {
    preferences: dbPreferences,
    updatePreferences,
    loading: loadingPreferences,
  } = useBoardSession(sessionId);

  // Load existing preferences when component opens or preferences change
  useEffect(() => {
    if (isOpen && dbPreferences) {
      // Map database preferences to component state
      const INTENT_IDS = new Set([
        "adventurous", "first-date", "romantic", "friendly", "group-fun", "picnic-dates", "take-a-stroll",
      ]);
      if (dbPreferences.categories || dbPreferences.intents) {
        // New schema: intents in dedicated column
        if (Array.isArray(dbPreferences.intents) && dbPreferences.intents.length > 0) {
          setSelectedIntents(dbPreferences.intents);
          setSelectedCategories(dbPreferences.categories || []);
        } else {
          // Backwards compat: split merged categories array
          const loadedIntents: string[] = [];
          const loadedCategories: string[] = [];
          (dbPreferences.categories || []).forEach((item: string) => {
            if (INTENT_IDS.has(item)) {
              loadedIntents.push(item);
            } else {
              loadedCategories.push(item);
            }
          });
          setSelectedIntents(loadedIntents);
          setSelectedCategories(loadedCategories);
        }
      }
      if (Array.isArray(dbPreferences.price_tiers) && dbPreferences.price_tiers.length > 0) {
        setSelectedPriceTiers(dbPreferences.price_tiers);
      }
      // Note: group_size column doesn't exist in board_session_preferences table
      // Group size is determined by the number of participants in the session
      if (dbPreferences.travel_mode) {
        setTravelMode(dbPreferences.travel_mode);
      }
      // travel_constraint_type is always 'time' — no need to load from DB
      if (dbPreferences.travel_constraint_value !== undefined) {
        setConstraintValue(dbPreferences.travel_constraint_value);
        // Show custom input if value isn't a standard preset
        if (!TRAVEL_TIME_PRESETS.includes(dbPreferences.travel_constraint_value)) {
          setShowCustomTravelTime(true);
        }
      }
      if (dbPreferences.date_option) {
        const optionMap: Record<string, DateOption> = {
          'now': 'Now', 'today': 'Today', 'this-weekend': 'This Weekend',
          'pick-a-date': 'Pick a Date',
        };
        setSelectedDateOption(optionMap[dbPreferences.date_option] || 'Now');
      }
      // Prefer time_slot (parity with solo), fall back to time_of_day (legacy board column)
      const loadedTimeSlot = dbPreferences.time_slot || dbPreferences.time_of_day;
      if (loadedTimeSlot) {
        setSelectedTimeSlot(loadedTimeSlot as TimeSlot);
      }
      if (dbPreferences.exact_time) {
        setExactTime(dbPreferences.exact_time);
      }
      if (dbPreferences.datetime_pref) {
        // Parse and set date/time preferences
        const date = new Date(dbPreferences.datetime_pref);
        setSelectedDate(date);
      }
      // Load location: prefer structured use_gps_location flag, fall back to heuristic
      if (typeof dbPreferences.use_gps_location === 'boolean') {
        setUseLocation(dbPreferences.use_gps_location ? "gps" : "search");
        if (!dbPreferences.use_gps_location && dbPreferences.custom_location) {
          setSearchLocation(dbPreferences.custom_location);
        } else if (dbPreferences.location) {
          setSearchLocation(dbPreferences.location);
        }
      } else if (dbPreferences.location) {
        // Legacy fallback: guess from location format
        const savedLocation = dbPreferences.location;
        setSearchLocation(savedLocation);

        const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(
          savedLocation
        );
        if (isCoordinates) {
          setUseLocation("gps");
        } else {
          setUseLocation("search");
        }
      }
      // Load saved coordinates
      if (dbPreferences.custom_lat != null && dbPreferences.custom_lng != null) {
        setSelectedLat(dbPreferences.custom_lat);
        setSelectedLng(dbPreferences.custom_lng);
      }
    }
  }, [isOpen, dbPreferences]);

  // All categories always visible (matching solo mode behavior)
  const filteredCategories = categories;

  // Memoized callbacks — defined before early returns (hooks rule), side effects outside updaters (StrictMode-safe)
  const handleIntentToggle = useCallback((intentId: string) => {
    let blocked = false;
    setSelectedIntents((prev) => {
      if (prev.includes(intentId)) {
        // Deselecting — read categories from ref to avoid stale closure
        if (prev.length === 1 && selectedCategoriesRef.current.length === 0) {
          blocked = true;
          return prev;
        }
        return [];  // Radio: deselect
      }
      return [intentId];  // Radio: replace with only this one
    });
    if (blocked) {
      setMinSelectionMessage(true);
      setTimeout(() => setMinSelectionMessage(false), 2500);
    }
  }, []);

  const handleCategoryToggle = useCallback((categoryId: string) => {
    let blocked = false;
    let capped = false;
    setSelectedCategories((prev) => {
      if (prev.includes(categoryId)) {
        // Deselecting — read intents from ref to avoid stale closure
        if (prev.length === 1 && selectedIntentsRef.current.length === 0) {
          blocked = true;
          return prev;
        }
        return prev.filter((id) => id !== categoryId);
      }
      if (prev.length >= 3) {
        capped = true;
        return prev;
      }
      return [...prev, categoryId];
    });
    if (blocked) {
      setMinSelectionMessage(true);
      setTimeout(() => setMinSelectionMessage(false), 2500);
    }
    if (capped) {
      setCategoryCapMessage(true);
      setTimeout(() => setCategoryCapMessage(false), 2000);
    }
  }, []);

  const handlePriceTierToggle = useCallback((slug: PriceTierSlug) => {
    setSelectedPriceTiers((prev) => {
      const next = prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug];
      return next.length === 0 ? prev : next;
    });
  }, []);

  const handleDateOptionSelect = useCallback((option: DateOption) => {
    setSelectedDateOption(option);
    if (option === "Now") {
      setSelectedTimeSlot(null);
      setExactTime("");
    }
  }, []);

  if (!isOpen) return null;

  // Show loading spinner when fetching preferences
  if (loadingPreferences) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  const handleTimeSlotSelect = (slot: TimeSlot) => {
    setSelectedTimeSlot(slot);
    setExactTime("");
  };

  const formatDateForDisplay = (date: Date): string => {
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const handleCalendarDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      setShowCalendar(false);
    }
  };

  const handleTimePickerChange = (event: any, date?: Date) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }
    if (date) {
      setSelectedTime(date);
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, "0");
      setExactTime(`${displayHours}:${displayMinutes} ${ampm}`);
    }
  };

  const handleTimePickerConfirm = () => {
    setShowTimePicker(false);
  };

  const handleUseCurrentLocation = async () => {
    setIsRequestingLocation(true);
    try {
      const { locationService } = await import("../services/locationService");

      // Request permissions first
      const hasPermission = await locationService.requestPermissions();
      if (!hasPermission) {
        setIsRequestingLocation(false);
        return;
      }

      // Get current location
      const location = await locationService.getCurrentLocation();
      if (location) {
        // Save coordinates
        setSelectedLat(location.latitude);
        setSelectedLng(location.longitude);

        // Reverse geocode to get city name
        const cityName = await locationService.reverseGeocode(
          location.latitude,
          location.longitude
        );
        if (cityName) {
          setSearchLocation(cityName);
          setUseLocation("gps");
        } else {
          // If reverse geocode fails, use coordinates as fallback
          setSearchLocation(
            `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
          );
          setUseLocation("gps");
        }
      }
    } catch (error) {
      console.error("Error getting location:", error);
    } finally {
      setIsRequestingLocation(false);
    }
  };

  // Handle location input change with autocomplete
  const handleLocationInputChange = (text: string) => {
    setSearchLocation(text);
    setSelectedLat(null);
    setSelectedLng(null);

    // Clear any existing debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (text.trim().length >= 4) {
      // Set a new timeout to fetch suggestions after 300ms of no typing
      debounceTimeoutRef.current = setTimeout(async () => {
        setIsLoadingSuggestions(true);
        try {
          const results = await geocodingService.autocomplete(text);
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
        } catch (error) {
          console.error("Error fetching suggestions:", error);
          setSuggestions([]);
          setShowSuggestions(false);
        } finally {
          setIsLoadingSuggestions(false);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Handle selecting a suggestion
  const handleSuggestionSelect = (suggestion: AutocompleteSuggestion) => {
    // Mark that we're selecting to prevent blur handler from interfering
    isSelectingSuggestion.current = true;

    // Update input with displayName for better UX (shorter, more readable)
    setSearchLocation(suggestion.displayName);
    setSelectedLat(suggestion.location?.lat ?? null);
    setSelectedLng(suggestion.location?.lng ?? null);
    setShowSuggestions(false);
    setIsInputFocused(false);

    // Reset the flag after a short delay
    setTimeout(() => {
      isSelectingSuggestion.current = false;
    }, 300);
  };

  // Handle input blur with delay to allow clicks on suggestions
  const handleInputBlur = () => {
    setTimeout(() => {
      // Don't hide suggestions if user is selecting one
      if (!isSelectingSuggestion.current) {
        setIsInputFocused(false);
        setShowSuggestions(false);
      }
    }, 200);
  };

  const handleApplyPreferences = async () => {
    setIsSaving(true);
    try {
      // Transform preferences to database format
   
      const highestTier = PRICE_TIERS.slice().reverse().find(t => selectedPriceTiers.includes(t.slug));
      const backCompatBudgetMax = highestTier?.max ?? 1000;

      const isGps = useLocation === "gps";
      const dbPreferences: any = {
        categories: selectedCategories,
        intents: selectedIntents,
        price_tiers: selectedPriceTiers,
        budget_min: 0,
        budget_max: backCompatBudgetMax,
        travel_mode: travelMode,
        travel_constraint_type: 'time' as const,
        travel_constraint_value:
          typeof constraintValue === "number" ? constraintValue : 30,
        // Write both time_of_day (legacy) and time_slot (parity with solo)
        time_of_day: selectedTimeSlot || null,
        time_slot: selectedTimeSlot || null,
        exact_time: exactTime || null,
        datetime_pref: selectedDate ? selectedDate.toISOString() : null,
        date_option: selectedDateOption
          ? ({ 'Now': 'now', 'Today': 'today', 'This Weekend': 'this-weekend', 'Pick a Date': 'pick-a-date' }[selectedDateOption] ?? selectedDateOption)
          : null,
        use_gps_location: isGps,
        custom_location: !isGps && searchLocation ? searchLocation : null,
        custom_lat: selectedLat != null ? selectedLat : null,
        custom_lng: selectedLng != null ? selectedLng : null,
      };

      // Add location if searchLocation is provided (backward compat for legacy readers)
      if (searchLocation) {
        dbPreferences.location = searchLocation;
      }

      // Save to database using useBoardSession hook
      await updatePreferences(dbPreferences);

      // Update offline cache with new user preferences if location was changed
      // This ensures useUserLocation gets fresh data when it reads from cache
      // Note: For collaboration preferences, location is saved to board preferences,
      // but we still update user preferences cache in case it affects location resolution
      try {
        if (user?.id && searchLocation) {
          // If location was changed in collaboration preferences, update user preferences cache
          // This ensures the location change is reflected in recommendations
          const updatedPrefs = await PreferencesService.getUserPreferences(
            user.id
          );
          if (updatedPrefs) {
            await offlineService.cacheUserPreferences(updatedPrefs);
          }
        }
      } catch (error) {
        console.error("Error updating offline cache:", error);
      }

      // Invalidate TanStack Query caches to trigger refetch
      queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
      queryClient.invalidateQueries({ queryKey: ["userLocation"] });
      queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });

      // Also call the onSave callback for backward compatibility
      const preferences = {
        selectedIntents,
        priceTiers: selectedPriceTiers,
        budgetMin: 0,
        budgetMax: backCompatBudgetMax,
        selectedCategories,
        selectedDateOption,
        selectedTimeSlot,
        selectedDate: selectedDate?.toISOString(),
        exactTime,
        travelMode,
        constraintType,
        constraintValue,
        useLocation,
        searchLocation,
      };

      await onSave(preferences);
    } catch (error) {
      console.error("Error saving preferences:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {onClose && (
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          )}
          <Text style={styles.title}>Narrow your search</Text>
          {onClose && <View style={styles.headerSpacer} />}
        </View>
        <Text style={styles.subtitle}>
          Collaboration Preferences for "{sessionName}"
        </Text>
      </View>
      <KeyboardAwareScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
          {/* Experience Type Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Curated Experiences</Text>
            <Text style={styles.sectionSubtitle}>
              Date Idea / Friends / Romantic / Group Fun
            </Text>
            <View style={styles.experienceTypesContainer}>
              {experienceTypes.map((type) => {
                const isSelected = selectedIntents.includes(type.id);
                return (
                  <TouchableOpacity
                    key={type.id}
                    onPress={() => handleIntentToggle(type.id)}
                    style={[
                      styles.experienceTypeButton,
                      isSelected && styles.experienceTypeButtonSelected,
                    ]}
                  >
                    <Ionicons
                      name={type.icon as any}
                      size={16}
                      color={isSelected ? "#eb7825" : "#6b7280"}
                    />
                    <Text
                      style={[
                        styles.experienceTypeText,
                        isSelected && styles.experienceTypeTextSelected,
                      ]}
                    >
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {minSelectionMessage && (
              <Text style={styles.selectionCapMessage}>
                At least one intent or category must be selected.
              </Text>
            )}
          </View>

          {/* Categories Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.categoriesContainer}>
              {filteredCategories.map((category) => {
                const isSelected = selectedCategories.includes(category.id);
                return (
                  <TouchableOpacity
                    key={category.id}
                    onPress={() => handleCategoryToggle(category.id)}
                    style={[
                      styles.categoryButton,
                      isSelected && styles.categoryButtonSelected,
                    ]}
                  >
                    <Ionicons
                      name={category.icon as any}
                      size={20}
                      color={isSelected ? "#eb7825" : "#6b7280"}
                    />
                    <Text
                      style={[
                        styles.categoryText,
                        isSelected && styles.categoryTextSelected,
                      ]}
                    >
                      {category.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {categoryCapMessage && (
              <Text style={styles.selectionCapMessage}>
                Maximum 3 categories. Deselect one to choose another.
              </Text>
            )}
          </View>

          {/* Price Tier Section - Always visible (matching solo mode) */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Price Range</Text>
              <View style={styles.priceTierGrid}>
                {PRICE_TIERS.map((tier) => {
                  const isActive = selectedPriceTiers.includes(tier.slug);
                  return (
                    <TouchableOpacity
                      key={tier.slug}
                      onPress={() => handlePriceTierToggle(tier.slug)}
                      style={[
                        styles.priceTierTile,
                        isActive && { borderColor: tier.color, backgroundColor: `${tier.color}14` },
                      ]}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={tier.icon as any} size={20} color={isActive ? tier.color : '#9CA3AF'} />
                      <Text style={[styles.priceTierLabel, isActive && { color: tier.color }]}>{tier.label}</Text>
                      <Text style={styles.priceTierRange}>{tier.rangeLabel}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

          {/* Date & Time Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date & Time</Text>
            <Text style={styles.sectionQuestion}>When do you want to go?</Text>
            <View style={styles.dateOptionsGrid}>
              {dateOptions.map((option) => {
                const isSelected = selectedDateOption === option.id;
                return (
                  <TouchableOpacity
                    key={option.id}
                    onPress={() =>
                      handleDateOptionSelect(option.id as DateOption)
                    }
                    style={[
                      styles.dateOptionCard,
                      isSelected && styles.dateOptionCardSelected,
                    ]}
                  >
                    <View style={styles.dateOptionContent}>
                      <Text
                        style={[
                          styles.dateOptionLabel,
                          isSelected && styles.dateOptionLabelSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text
                        style={[
                          styles.dateOptionDescription,
                          isSelected && styles.dateOptionDescriptionSelected,
                        ]}
                      >
                        {option.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Weekend Info Card (only for "This Weekend") */}
            {selectedDateOption === "This Weekend" && (
              <TouchableOpacity style={styles.weekendInfoCard}>
                <Ionicons
                  name="calendar"
                  size={24}
                  color="#0369a1"
                  style={styles.weekendInfoIcon}
                />
                <View style={styles.weekendInfoContent}>
                  <Text style={styles.weekendInfoLabel}>This Weekend</Text>
                  <Text style={styles.weekendInfoDescription}>
                    Includes Friday, Saturday & Sunday
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Calendar for "Pick a Date" */}
            {selectedDateOption === "Pick a Date" && (
              <TouchableOpacity
                style={styles.dateInputField}
                onPress={() => setShowCalendar(true)}
              >
                <Ionicons name="calendar" size={20} color="#eb7825" />
                {selectedDate ? (
                  <Text style={styles.dateInputText}>
                    {formatDateForDisplay(selectedDate)}
                  </Text>
                ) : (
                  <Text style={styles.dateInputPlaceholder}>mm/dd/yyyy</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Time Slots Section (shown for "Today", "This Weekend", and "Pick a Date") */}
            {selectedDateOption && selectedDateOption !== "Now" && (
              <>
                <Text style={styles.quickPresetsLabel}>Quick Presets</Text>
                <View style={styles.timeSlotsContainer}>
                  {timeSlots.map((slot) => {
                    const isSelected = selectedTimeSlot === slot.id;
                    return (
                      <TouchableOpacity
                        key={slot.id}
                        onPress={() =>
                          handleTimeSlotSelect(slot.id as TimeSlot)
                        }
                        style={[
                          styles.timeSlotCard,
                          isSelected && styles.timeSlotCardSelected,
                        ]}
                      >
                        <View style={styles.timeSlotContent}>
                          <Ionicons
                            name={slot.icon as any}
                            size={24}
                            color={isSelected ? "#ffffff" : "#6b7280"}
                            style={styles.timeSlotIcon}
                          />
                          <Text
                            style={[
                              styles.timeSlotLabel,
                              isSelected && styles.timeSlotLabelSelected,
                            ]}
                          >
                            {slot.label}
                          </Text>
                          <Text
                            style={[
                              styles.timeSlotTime,
                              isSelected && styles.timeSlotTimeSelected,
                            ]}
                          >
                            {slot.time}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Or Set Exact Time Section */}
                <View style={styles.exactTimeSection}>
                  <Text style={styles.exactTimeLabel}>Or Set Exact Time</Text>
                  <TouchableOpacity
                    style={styles.exactTimeInput}
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Ionicons
                      name="time-outline"
                      size={20}
                      color={exactTime ? "#eb7825" : "#9ca3af"}
                    />
                    {exactTime ? (
                      <Text style={styles.exactTimeInputTextSelected}>
                        {exactTime}
                      </Text>
                    ) : (
                      <Text style={styles.exactTimeInputText}>HH:MM AM/PM</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* Travel Mode Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel Mode</Text>
            <Text style={styles.sectionQuestion}>How will you get there?</Text>
            <View style={styles.travelModesGrid}>
              {travelModes.map((mode) => {
                const isSelected = travelMode === mode.id;
                return (
                  <TouchableOpacity
                    key={mode.id}
                    onPress={() => setTravelMode(mode.id)}
                    style={[
                      styles.travelModeCard,
                      isSelected && styles.travelModeCardSelected,
                    ]}
                  >
                    <Ionicons
                      name={mode.icon as any}
                      size={24}
                      color={isSelected ? "#ffffff" : "#6b7280"}
                    />
                    <Text
                      style={[
                        styles.travelModeLabel,
                        isSelected && styles.travelModeLabelSelected,
                      ]}
                    >
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Travel Time Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel Time</Text>
            <Text style={styles.sectionQuestion}>
              How long are you willing to travel?
            </Text>
            <View style={styles.quickOptionsContainer}>
              {TRAVEL_TIME_PRESETS.map((value, index) => {
                const isPresetActive = !showCustomTravelTime && constraintValue === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.quickOption,
                      index === 3 && styles.quickOptionLast,
                      isPresetActive && styles.quickOptionSelected,
                      !isPresetActive && styles.quickOptionUnselected,
                    ]}
                    onPress={() => {
                      setShowCustomTravelTime(false);
                      setConstraintValue(value);
                    }}
                  >
                    <Text
                      style={[
                        styles.quickOptionText,
                        isPresetActive && styles.quickOptionTextSelected,
                        !isPresetActive && styles.quickOptionTextUnselected,
                      ]}
                    >
                      {value} min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.customToggleRow}>
              <Text style={styles.customToggleLabel}>Set your own</Text>
              <Switch
                value={showCustomTravelTime}
                onValueChange={(val) => {
                  setShowCustomTravelTime(val);
                  if (!val) {
                    const nearest = TRAVEL_TIME_PRESETS.reduce((prev, curr) =>
                      Math.abs(curr - (typeof constraintValue === 'number' ? constraintValue : 30)) < Math.abs(prev - (typeof constraintValue === 'number' ? constraintValue : 30)) ? curr : prev
                    );
                    setConstraintValue(nearest);
                  }
                }}
                trackColor={{ false: "#d1d5db", true: "#fdba74" }}
                thumbColor={showCustomTravelTime ? "#eb7825" : "#f4f3f4"}
              />
            </View>
            {showCustomTravelTime && (
              <View style={styles.constraintInputContainer}>
                <Ionicons
                  name="time-outline"
                  size={20}
                  color="#6b7280"
                  style={styles.constraintInputIcon}
                />
                <TextInput
                  value={constraintValue?.toString() || ""}
                  onChangeText={(text) => {
                    const numericValue = text.replace(/[^0-9]/g, "");
                    if (numericValue === "") {
                      setConstraintValue("");
                      return;
                    }
                    const val = Number(numericValue);
                    if (val >= 5 && val <= 120) {
                      setConstraintValue(val);
                    }
                  }}
                  keyboardType="numeric"
                  style={styles.constraintInput}
                  placeholder="5 – 120 minutes"
                  placeholderTextColor="#9ca3af"
                  maxLength={3}
                />
                <Text style={styles.travelInputUnit}>min</Text>
              </View>
            )}
          </View>

          {/* Starting Location Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Starting Location</Text>
            <Text style={styles.sectionSubtitle}>
              Your starting point will shape your travel time results.
            </Text>

            {/* Use My Current Location Button */}
            <TouchableOpacity
              style={styles.useLocationButton}
              onPress={handleUseCurrentLocation}
              disabled={isRequestingLocation}
              activeOpacity={0.7}
            >
              {isRequestingLocation ? (
                <ActivityIndicator size="small" color="#eb7825" />
              ) : (
                <Ionicons name="send-outline" size={20} color="#eb7825" />
              )}
              <Text style={styles.useLocationButtonText}>
                {isRequestingLocation
                  ? "Getting location..."
                  : "Use my current location"}
              </Text>
            </TouchableOpacity>

            {/* Separator */}
            <View style={styles.separator}>
              <Text style={styles.separatorText}>or</Text>
            </View>

            {/* Location Input Field */}
            <View
              style={[
                styles.locationInputContainer,
                isInputFocused && styles.locationInputContainerFocused,
              ]}
            >
              <Ionicons
                name="location"
                size={20}
                color="#6b7280"
                style={styles.locationInputIcon}
              />
              <TextInput
                style={styles.locationTextInput}
                placeholder="Enter your city or address"
                placeholderTextColor="#9ca3af"
                value={searchLocation}
                onChangeText={handleLocationInputChange}
                onFocus={() => {
                  setIsInputFocused(true);
                  if (suggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={handleInputBlur}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            {/* Suggestions Dropdown */}
            {showSuggestions &&
              (suggestions.length > 0 || isLoadingSuggestions) && (
                <ScrollView
                  style={styles.suggestionsContainer}
                  nestedScrollEnabled={true}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                >
                  {isLoadingSuggestions ? (
                    <View style={styles.suggestionItem}>
                      <ActivityIndicator size="small" color="#eb7825" />
                      <Text style={styles.suggestionText}>Searching...</Text>
                    </View>
                  ) : (
                    suggestions.map((suggestion, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.suggestionItem}
                        onPress={() => {
                          handleSuggestionSelect(suggestion);
                        }}
                        onPressIn={() => {
                          isSelectingSuggestion.current = true;
                        }}
                        activeOpacity={0.7}
                        delayPressIn={0}
                      >
                        <Ionicons
                          name="location-outline"
                          size={18}
                          color="#6b7280"
                        />
                        <View style={styles.suggestionTextContainer}>
                          <Text style={styles.suggestionText}>
                            {suggestion.displayName}
                          </Text>
                          {suggestion.fullAddress !==
                            suggestion.displayName && (
                            <Text
                              style={styles.suggestionSubtext}
                              numberOfLines={1}
                            >
                              {suggestion.fullAddress}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              )}
          </View>
      </KeyboardAwareScrollView>

      {/* Apply Button */}
      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <TouchableOpacity
          onPress={handleApplyPreferences}
          style={[styles.applyButton, isSaving && styles.applyButtonDisabled]}
          disabled={isSaving}
        >
          {isSaving ? (
            <View style={styles.buttonLoadingContainer}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.applyButtonText}>Saving...</Text>
            </View>
          ) : (
            <Text style={styles.applyButtonText}>Apply Preferences</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Calendar Modal */}
      <Modal
        visible={showCalendar}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCalendar(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={() => setShowCalendar(false)}
          />
          <SafeAreaView style={styles.modalContent} edges={["bottom"]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Date</Text>
              <TouchableOpacity
                onPress={() => setShowCalendar(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Calendar
                selected={selectedDate || undefined}
                onSelect={handleCalendarDateSelect}
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Time Picker */}
      {showTimePicker &&
        (Platform.OS === "ios" ? (
          <Modal
            visible={showTimePicker}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setShowTimePicker(false)}
          >
            <View style={styles.modalOverlay}>
              <TouchableOpacity
                style={styles.backdropTouch}
                activeOpacity={1}
                onPress={() => setShowTimePicker(false)}
              />
              <SafeAreaView style={styles.modalContent} edges={["bottom"]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Time</Text>
                  <TouchableOpacity
                    onPress={handleTimePickerConfirm}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalConfirmText}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={selectedTime}
                  mode="time"
                  is24Hour={false}
                  display="spinner"
                  onChange={handleTimePickerChange}
                  style={styles.timePicker}
                />
              </SafeAreaView>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={selectedTime}
            mode="time"
            is24Hour={false}
            display="default"
            onChange={handleTimePickerChange}
          />
        ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  selectionCapMessage: {
    color: '#EF4444',
    fontSize: 13,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  loadingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "#ffffff",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    marginLeft: -8,
  },
  headerSpacer: {
    width: 40,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontWeight: "400",
    color: "#6b7280",
    textAlign: "center",
  },
  section: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
  },
  sectionQuestion: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 16,
  },
  sectionHeaderWithBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  requiredBadge: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  requiredBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#dc2626",
  },
  experienceTypesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  experienceTypeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  experienceTypeButtonSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  experienceTypeText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  experienceTypeTextSelected: {
    color: "#eb7825",
  },
  budgetInputsContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  budgetInputWrapper: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 8,
  },
  budgetInputContainer: {
    position: "relative",
  },
  dollarSign: {
    position: "absolute",
    left: 12,
    top: 12,
    fontSize: 16,
    color: "#6b7280",
    zIndex: 1,
  },
  budgetInput: {
    paddingLeft: 32,
    paddingRight: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    fontSize: 16,
    backgroundColor: "white",
  },
  priceTierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  priceTierTile: {
    width: "47%" as any,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#E5E7EB",
    backgroundColor: "white",
    gap: 4,
  },
  priceTierLabel: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#374151",
  },
  priceTierRange: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  categoriesContainer: {
    flexDirection: "column",
    gap: 8,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
    minWidth: "47%",
  },
  categoryButtonSelected: {
    backgroundColor: "#fef3e2",
    borderColor: "#eb7825",
  },
  categoryText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    flex: 1,
  },
  categoryTextSelected: {
    color: "#eb7825",
  },
  dateOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  dateOptionCard: {
    width: "47.5%",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    minHeight: 80,
    justifyContent: "center",
  },
  dateOptionCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  dateOptionContent: {
    alignItems: "flex-start",
  },
  dateOptionLabel: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  dateOptionLabelSelected: {
    color: "#ffffff",
  },
  dateOptionDescription: {
    fontSize: 12,
    color: "#6b7280",
  },
  dateOptionDescriptionSelected: {
    color: "#ffffff",
    opacity: 0.9,
  },
  weekendInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#e0f2fe",
    marginTop: 12,
    borderWidth: 0,
  },
  weekendInfoIcon: {
    marginRight: 12,
  },
  weekendInfoContent: {
    flex: 1,
  },
  weekendInfoLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0369a1",
    marginBottom: 4,
  },
  weekendInfoDescription: {
    fontSize: 14,
    color: "#0c4a6e",
    opacity: 0.9,
  },
  dateInputField: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#eb7825",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  dateInputText: {
    fontSize: 16,
    color: "#111827",
    marginLeft: 8,
    flex: 1,
  },
  dateInputPlaceholder: {
    fontSize: 16,
    color: "#9ca3af",
    marginLeft: 8,
    flex: 1,
  },
  quickPresetsLabel: {
    fontSize: 14,
    color: "#9ca3af",
    marginTop: 8,
    marginBottom: 12,
  },
  timeSlotsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  timeSlotCard: {
    width: "47.5%",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    minHeight: 80,
    justifyContent: "center",
  },
  timeSlotCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  timeSlotContent: {
    alignItems: "flex-start",
  },
  timeSlotIcon: {
    marginBottom: 8,
  },
  timeSlotLabel: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  timeSlotLabelSelected: {
    color: "#ffffff",
  },
  timeSlotTime: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
  },
  timeSlotTimeSelected: {
    color: "#ffffff",
    opacity: 0.9,
  },
  exactTimeSection: {
    marginTop: 24,
  },
  exactTimeLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 12,
  },
  exactTimeInput: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
  },
  exactTimeInputText: {
    fontSize: 16,
    color: "#9ca3af",
    marginLeft: 8,
    flex: 1,
  },
  exactTimeInputTextSelected: {
    fontSize: 16,
    color: "#111827",
    marginLeft: 8,
    flex: 1,
    fontWeight: "500",
  },
  travelModesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  travelModeCard: {
    width: "47%",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
    alignItems: "center",
    minHeight: 80,
    justifyContent: "center",
  },
  travelModeCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  travelModeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginTop: 8,
  },
  travelModeLabelSelected: {
    color: "#ffffff",
  },
  constraintInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  constraintInputContainerFocused: {
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  constraintInputIcon: {
    marginRight: 12,
  },
  constraintInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    padding: 0,
  },
  customToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 8,
  },
  customToggleLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6b7280",
  },
  travelInputUnit: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    marginLeft: 8,
  },
  quickOptionsLabel: {
    fontSize: 14,
    color: "#9ca3af",
    marginTop: 8,
    marginBottom: 16,
  },
  quickOptionsContainer: {
    flexDirection: "row",
  },
  quickOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  quickOptionLast: {
    marginRight: 0,
  },
  quickOptionSelected: {
    backgroundColor: "#eb7825",
  },
  quickOptionUnselected: {
    backgroundColor: "#f3f4f6",
  },
  quickOptionText: {
    fontSize: 14,
    fontWeight: "500",
  },
  quickOptionTextSelected: {
    color: "#ffffff",
  },
  quickOptionTextUnselected: {
    color: "#111827",
  },
  useLocationButton: {
    backgroundColor: "#ffedd5",
    borderWidth: 1.5,
    borderColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    width: "100%",
  },
  useLocationButtonText: {
    color: "#eb7825",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 10,
  },
  separator: {
    alignItems: "center",
    marginVertical: 20,
  },
  separatorText: {
    fontSize: 14,
    color: "#9ca3af",
    fontWeight: "400",
  },
  locationInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
  },
  locationInputContainerFocused: {
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  locationInputIcon: {
    marginRight: 12,
  },
  locationTextInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    padding: 0,
  },
  suggestionsContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginTop: 4,
    marginBottom: 8,
    maxHeight: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestionTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  suggestionText: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "500",
  },
  suggestionSubtext: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  applyButton: {
    backgroundColor: "#eb7825",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  applyButtonDisabled: {
    opacity: 0.7,
  },
  applyButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  modalCloseButton: {
    padding: 8,
  },
  modalConfirmText: {
    fontSize: 16,
    color: "#eb7825",
    fontWeight: "600",
  },
  timePicker: {
    width: "100%",
    height: 200,
  },
});
