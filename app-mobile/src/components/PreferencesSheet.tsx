import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Pressable,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Platform,
  Modal,
  Alert,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { SCREEN_WIDTH, SCREEN_HEIGHT, vs } from "../utils/responsive";
import { useAppLayout } from "../hooks/useAppLayout";
import { KeyboardAwareScrollView } from "./ui/KeyboardAwareScrollView";
import { Icon } from './ui/Icon';
import { PreferencesService } from "../services/preferencesService";
import { locationService } from "../services/locationService";
import { offlineService } from "../services/offlineService";
import { logAppsFlyerEvent } from "../services/appsFlyerService";
import { useBoardSession } from "../hooks/useBoardSession";
import { usePreferencesData } from "../hooks/usePreferencesData";
import {
  geocodingService,
  AutocompleteSuggestion,
} from "../services/geocodingService";
import { Calendar } from "./ui/calendar";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrencySymbol, formatNumberWithCommas } from "../utils/currency";
import { getRate } from "../services/currencyService";
import { mixpanelService } from "../services/mixpanelService";
import { detectLocaleFromCoordinates } from "../utils/localeDetection";
import { useAppStore } from "../store/appStore";
import { normalizePreferencesForSave } from "../utils/preferencesConverter";

import {
  ExperienceTypesSection,
  CategoriesSection,
  DateTimeSection,
  TravelModeSection,
  LoadingShimmer,
} from "./PreferencesSheet/PreferencesSections";
import {
  TravelLimitSection,
  LocationInputSection,
} from "./PreferencesSheet/PreferencesSectionsAdvanced";
import { PRICE_TIERS, TIER_BY_SLUG, PriceTierSlug } from '../constants/priceTiers';
import { useFeatureGate } from '../hooks/useFeatureGate';
import { CustomPaywallScreen } from './CustomPaywallScreen';
import type { GatedFeature } from '../hooks/useFeatureGate';
import { MAX_CATEGORIES, MAX_INTENTS, normalizeCategoryArray, capIntents } from '../utils/categoryUtils';

interface PreferencesSheetProps {
  visible?: boolean;
  onClose?: () => void;
  onSave?: (preferences: any) => Promise<boolean | void> | boolean | void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  // Collaboration mode props - when provided, loads/saves from board_session_preferences
  sessionId?: string;
  sessionName?: string;
}

// Experience Types — 7 curated types (kebab-case IDs match edge function)
const experienceTypes = [
  { id: "adventurous",   label: "Adventurous",   icon: "compass-outline" },
  { id: "first-date",    label: "First Date",    icon: "people-outline" },
  { id: "romantic",      label: "Romantic",       icon: "heart-outline" },
  { id: "group-fun",     label: "Group Fun",      icon: "people-circle-outline" },
  { id: "picnic-dates",  label: "Picnic Dates",   icon: "basket-outline" },
  { id: "take-a-stroll", label: "Take a Stroll",  icon: "walk-outline" },
];

// Budget presets removed — using PRICE_TIERS from constants/priceTiers

// Categories with exact icons from image
const categories = [
  { id: "nature", label: "Nature & Views", icon: "leaf-outline" },
  { id: "first_meet", label: "First Meet", icon: "chatbubbles-outline" },
  { id: "picnic_park", label: "Picnic Park", icon: "basket-outline" },
  { id: "drink", label: "Drink", icon: "wine-outline" },
  { id: "casual_eats", label: "Casual Eats", icon: "fast-food-outline" },
  { id: "fine_dining", label: "Fine Dining", icon: "restaurant-outline" },
  { id: "watch", label: "Watch", icon: "film-outline" },
  { id: "live_performance", label: "Live Performance", icon: "musical-notes-outline" },
  {
    id: "creative_arts",
    label: "Creative & Arts",
    icon: "color-palette-outline",
  },
  { id: "play", label: "Play", icon: "game-controller-outline" },
  { id: "wellness", label: "Wellness", icon: "body-outline" },
  { id: "flowers", label: "Flowers", icon: "flower-outline" },
];

// Travel modes matching database constraint
const travelModes = [
  { id: "walking", label: "Walk", icon: "walk-outline" },
  { id: "biking", label: "Bike", icon: "bicycle-outline" },
  { id: "transit", label: "Bus", icon: "bus-outline" },
  { id: "driving", label: "Drive", icon: "car-outline" },
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

export default function PreferencesSheet({
  visible,
  onClose,
  onSave,
  accountPreferences,
  sessionId,
  sessionName,
}: PreferencesSheetProps) {
  const user = useAppStore((state) => state.user);
  const { profile, setProfile } = useAppStore();
  const queryClient = useQueryClient();

  // Feature gating
  const { canAccess } = useFeatureGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('custom_starting_point');
  const insets = useSafeAreaInsets();
  const appLayout = useAppLayout();
  // Only load preferences data if modal is visible
  const {
    preferences: loadedPreferences,
    isLoading: preferencesLoading,
    isCollaborationMode,
    updateBoardPreferences,
  } = usePreferencesData(user?.id, sessionId, !!visible);

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

  // Selection limit messages
  const [minSelectionMessage, setMinSelectionMessage] = useState(false);
  const [categoryCapMessage, setCategoryCapMessage] = useState(false);

  // Date & Time
  const [selectedDateOption, setSelectedDateOption] =
    useState<DateOption | null>("Now");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<TimeSlot | null>(
    null
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [exactTime, setExactTime] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Travel Mode
  const [travelMode, setTravelMode] = useState<string>("walking");

  // Travel Limit
  const constraintType = 'time' as const;
  const [constraintValue, setConstraintValue] = useState<number | "">(30);

  // Starting Point
  const [useLocation, setUseLocation] = useState<"gps" | "search">("gps");
  const [searchLocation, setSearchLocation] = useState<string>("");
  const [useGpsLocation, setUseGpsLocation] = useState<boolean>(true);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const searchLocationRef = useRef(searchLocation);
  searchLocationRef.current = searchLocation;
  const selectedCoordsRef = useRef(selectedCoords);
  selectedCoordsRef.current = selectedCoords;
  // Backup for custom location before GPS toggle clears it (P1-06)
  const savedCustomLocation = useRef<{
    text: string;
    coords: { lat: number; lng: number } | null;
  }>({ text: '', coords: null });
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);

  // Auto-reset to GPS if user no longer has custom starting point access (downgrade)
  useEffect(() => {
    if (!canAccess('custom_starting_point') && !useGpsLocation) {
      setUseGpsLocation(true);
      setSearchLocation('');
      setSelectedCoords(null);
    }
  }, [canAccess, useGpsLocation]);

  // Location autocomplete suggestions
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSelectingSuggestion = useRef(false);
  const locationSectionRef = useRef<View>(null);
  const locationSectionY = useRef<number>(0);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);

  const isSavingRef = useRef(false);
  const isInternalUpdate = useRef(false);

  // Track initial preferences for change detection
  const [initialPreferences, setInitialPreferences] = useState<any>(null);

  // Default preferences
  const defaultPreferences = {
    selectedIntents: [],
    selectedPriceTiers: ['chill', 'comfy', 'bougie', 'lavish'] as PriceTierSlug[],
    budgetMin: 0,
    budgetMax: 200,
    selectedCategories: [],
    selectedDateOption: "Now" as DateOption,
    selectedTimeSlot: null,
    selectedDate: null,
    exactTime: "",
    travelMode: "walking",
    constraintType: 'time' as const,
    constraintValue: 30,
    searchLocation: "",
  };

  // Initialize state from loaded preferences
  useEffect(() => {
    if (!loadedPreferences || preferencesLoading || !visible) {
      return;
    }

    if (isCollaborationMode) {
      // Load from board session preferences — intents and categories are separate DB columns
      const collabIntents = capIntents(
        Array.isArray((loadedPreferences).intents) ? (loadedPreferences).intents : []
      );
      setSelectedIntents(collabIntents);
      const collabCats = normalizeCategoryArray(
        Array.isArray(loadedPreferences.categories) ? loadedPreferences.categories : []
      );
      setSelectedCategories(collabCats);
      if (Array.isArray((loadedPreferences).price_tiers) && (loadedPreferences).price_tiers.length > 0) {
        setSelectedPriceTiers((loadedPreferences).price_tiers);
      }
      if ((loadedPreferences).travel_mode) {
        setTravelMode((loadedPreferences).travel_mode);
      }
      // travel_constraint_type is always 'time' — no need to load from DB
      if ((loadedPreferences).travel_constraint_value !== undefined) {
        setConstraintValue((loadedPreferences).travel_constraint_value);
      }
      if ((loadedPreferences).time_of_day) {
        const timeSlot = (loadedPreferences).time_of_day;
        if (["brunch", "afternoon", "dinner", "lateNight"].includes(timeSlot)) {
          setSelectedTimeSlot(timeSlot as TimeSlot);
        }
      }
      if ((loadedPreferences).datetime_pref) {
        const date = new Date((loadedPreferences).datetime_pref);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
        }
      }
      if ((loadedPreferences).location) {
        const savedLocation = (loadedPreferences).location;
        setSearchLocation(savedLocation);
        const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(savedLocation);
        setUseLocation(isCoordinates ? "gps" : "search");
      }

      setInitialPreferences({
        selectedIntents: collabIntents,
        selectedPriceTiers: Array.isArray((loadedPreferences).price_tiers) && (loadedPreferences).price_tiers.length > 0
          ? (loadedPreferences).price_tiers
          : ['chill', 'comfy', 'bougie', 'lavish'],
        budgetMin: (loadedPreferences).budget_min || 0,
        budgetMax: (loadedPreferences).budget_max || 200,
        selectedCategories: collabCats,
        selectedDateOption: "Now",
        selectedTimeSlot: (loadedPreferences).time_of_day || null,
        selectedDate: (loadedPreferences).datetime_pref
          ? new Date((loadedPreferences).datetime_pref)
          : null,
        exactTime: "",
        travelMode: (loadedPreferences).travel_mode || "walking",
        constraintType: 'time' as const,
        constraintValue: (loadedPreferences).travel_constraint_value || 30,
        searchLocation: (loadedPreferences).location || "",
      });
    } else {
      // Load from solo preferences — intents and categories are separate DB columns
      const soloIntents = capIntents(
        Array.isArray((loadedPreferences).intents) ? (loadedPreferences).intents : []
      );
      setSelectedIntents(soloIntents);
      const soloCats = normalizeCategoryArray(
        Array.isArray(loadedPreferences.categories) ? loadedPreferences.categories : []
      );
      setSelectedCategories(soloCats);

      if (Array.isArray((loadedPreferences).price_tiers) && (loadedPreferences).price_tiers.length > 0) {
        setSelectedPriceTiers((loadedPreferences).price_tiers);
      }

      if (loadedPreferences.travel_mode) {
        setTravelMode(loadedPreferences.travel_mode);
      }

      // travel_constraint_type is always 'time' — no need to load from DB
      if (loadedPreferences.travel_constraint_value !== undefined && loadedPreferences.travel_constraint_value !== null) {
        setConstraintValue(loadedPreferences.travel_constraint_value);
      }

      if (loadedPreferences.date_option) {
        const dateOptionMap: { [key: string]: DateOption } = {
          now: "Now",
          today: "Today",
          weekend: "This Weekend",
          custom: "Pick a Date",
        };
        setSelectedDateOption(
          (dateOptionMap[loadedPreferences.date_option] || "Now") as DateOption
        );
      }

      if ((loadedPreferences).time_slot) {
        const timeSlot = (loadedPreferences).time_slot;
        if (["brunch", "afternoon", "dinner", "lateNight"].includes(timeSlot)) {
          setSelectedTimeSlot(timeSlot as TimeSlot);
        }
      }

      if ((loadedPreferences).exact_time) {
        setExactTime((loadedPreferences).exact_time);
      }

      if (loadedPreferences.datetime_pref) {
        const date = new Date(loadedPreferences.datetime_pref);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
        }
      }

      const gpsFlag = (loadedPreferences).use_gps_location ?? true;
      setUseGpsLocation(gpsFlag);

      if (!gpsFlag && (loadedPreferences).custom_location) {
        setSearchLocation((loadedPreferences).custom_location);
        setUseLocation("search");
      }

      setInitialPreferences({
        selectedIntents: soloIntents,
        selectedPriceTiers: Array.isArray((loadedPreferences).price_tiers) && (loadedPreferences).price_tiers.length > 0
          ? (loadedPreferences).price_tiers
          : ['chill', 'comfy', 'bougie', 'lavish'],
        budgetMin: loadedPreferences.budget_min || 0,
        budgetMax: loadedPreferences.budget_max || 200,
        selectedCategories: soloCats,
        selectedDateOption: loadedPreferences.date_option
          ? ({
              now: "Now",
              today: "Today",
              weekend: "This Weekend",
              custom: "Pick a Date",
            } as Record<string, DateOption>)[loadedPreferences.date_option] ||
            "Now"
          : "Now",
        selectedTimeSlot: (loadedPreferences).time_slot || null,
        selectedDate: loadedPreferences.datetime_pref
          ? new Date(loadedPreferences.datetime_pref)
          : null,
        exactTime: (loadedPreferences).exact_time || "",
        travelMode: loadedPreferences.travel_mode || "walking",
        constraintType: 'time' as const,
        constraintValue: loadedPreferences.travel_constraint_value || 30,
        searchLocation: (loadedPreferences).custom_location || "",
      });
    }
  }, [loadedPreferences, preferencesLoading, visible, isCollaborationMode]);

  // All categories always visible — curated pills are independent of category pills
  const filteredCategories = categories;

  // Memoized callbacks — side effects kept outside updater to stay StrictMode-safe
  const handleIntentToggle = useCallback((id: string) => {
    let blocked = false;
    setSelectedIntents((prev) => {
      if (prev.includes(id)) {
        // Deselecting — read categories from ref to avoid stale closure
        if (prev.length === 1 && selectedCategoriesRef.current.length === 0) {
          blocked = true;
          return prev;
        }
        return [];  // Radio: goes to 0
      }
      return [id];  // Radio: replace with only this one
    });
    if (blocked) {
      setMinSelectionMessage(true);
      setTimeout(() => setMinSelectionMessage(false), 2500);
    }
  }, []);

  const handleCategoryToggle = useCallback((id: string) => {
    let blocked = false;
    let capped = false;
    setSelectedCategories((prev) => {
      if (prev.includes(id)) {
        // Deselecting — read intents from ref to avoid stale closure
        if (prev.length === 1 && selectedIntentsRef.current.length === 0) {
          blocked = true;
          return prev;
        }
        return prev.filter((c) => c !== id);
      }
      if (prev.length >= MAX_CATEGORIES) {
        capped = true;
        return prev;
      }
      return [...prev, id];
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
      // Enforce min 1
      return next.length === 0 ? prev : next;
    });
  }, []);

  const handleDateOptionSelect = useCallback((option: DateOption) => {
    setSelectedDateOption(option);
    if (option === "Now") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
      setExactTime("");
    } else if (option === "Today") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
    } else if (option === "This Weekend") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
    } else if (option === "Pick a Date") {
      setSelectedTimeSlot(null);
    }
  }, []);

  const handleTimeSlotSelect = useCallback((slot: TimeSlot) => {
    setSelectedTimeSlot(slot);
    setExactTime("");
  }, []);

  const formatTimeForDisplay = useCallback((date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const hours12 = hours % 12 || 12;
    const minutesStr = String(minutes).padStart(2, "0");
    return `${hours12}:${minutesStr} ${ampm}`;
  }, []);

  const handleTimePickerChange = useCallback(
    (event: any, selectedDate?: Date) => {
      if (Platform.OS === "android") {
        setShowTimePicker(false);
      }

      if (selectedDate) {
        setSelectedTime(selectedDate);
        const formattedTime = formatTimeForDisplay(selectedDate);
        setExactTime(formattedTime);
        setSelectedTimeSlot(null);
      }

      if (Platform.OS === "ios") {
        if (event.type === "dismissed") {
          setShowTimePicker(false);
        }
      }
    },
    [formatTimeForDisplay]
  );

  const handleTimePickerConfirm = useCallback(() => {
    setShowTimePicker(false);
    const formattedTime = formatTimeForDisplay(selectedTime);
    setExactTime(formattedTime);
    setSelectedTimeSlot(null);
  }, [formatTimeForDisplay, selectedTime]);

  const handleCalendarDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    setShowCalendar(false);
  }, []);

  const formatDateForDisplay = useCallback((date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }, []);

  const handleLocationInputChange = useCallback((text: string) => {
    setSearchLocation(text);
    setSelectedCoords(null);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (text.trim().length >= 4) {
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
  }, []);

  const handleSuggestionSelect = useCallback(async (suggestion: AutocompleteSuggestion) => {
    isSelectingSuggestion.current = true;
    setSearchLocation(suggestion.displayName);
    setShowSuggestions(false);
    setIsInputFocused(false);

    // Resolve coordinates: use suggestion.location if present, otherwise fetch via placeId
    let coords = suggestion.location ?? null;
    if (!coords && suggestion.placeId) {
      coords = await geocodingService.getPlaceCoordinates(suggestion.placeId);
    }
    setSelectedCoords(coords);

    // Auto-detect locale from resolved coordinates (fire-and-forget)
    if (coords) {
      detectLocaleFromCoordinates(coords.lat, coords.lng).then((detected) => {
        if (user?.id) {
          PreferencesService.updateUserProfile(user.id, {
            currency: detected.currency,
            measurement_system: detected.measurementSystemDb,
          }).catch((err) => {
            console.warn('Locale DB write failed in handleSuggestionSelect:', err?.message);
          });
        }
        const currentProfile = useAppStore.getState().profile;
        if (currentProfile) {
          setProfile({
            ...currentProfile,
            currency: detected.currency,
            measurement_system: detected.measurementSystemDb,
          });
        }
      }).catch(() => {});
    }

    setTimeout(() => {
      isSelectingSuggestion.current = false;
    }, 300);
  }, [user?.id, setProfile]);

  const handleInputBlur = useCallback(() => {
    setTimeout(() => {
      if (!isSelectingSuggestion.current) {
        setIsInputFocused(false);
        setShowSuggestions(false);
      }
    }, 200);
  }, []);

  const handleGpsToggle = useCallback((value: boolean) => {
    setUseGpsLocation(value);
    if (value) {
      // Save custom location before clearing so toggle-off can restore it
      savedCustomLocation.current = {
        text: searchLocationRef.current,
        coords: selectedCoordsRef.current,
      };
      setSearchLocation('');
      setSelectedCoords(null);

      // Auto-detect locale from GPS coordinates (fire-and-forget)
      locationService.getCurrentLocation().then((loc) => {
        if (!loc) return;
        detectLocaleFromCoordinates(loc.latitude, loc.longitude).then((detected) => {
          if (user?.id) {
            PreferencesService.updateUserProfile(user.id, {
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            }).catch((err) => {
              console.warn('Locale DB write failed in handleGpsToggle:', err?.message);
            });
          }
          const currentProfile = useAppStore.getState().profile;
          if (currentProfile) {
            setProfile({
              ...currentProfile,
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            });
          }
        }).catch(() => {});
      }).catch(() => {});
    } else {
      // Restore previously saved custom location
      setSearchLocation(savedCustomLocation.current.text);
      setSelectedCoords(savedCustomLocation.current.coords);
    }
  }, [user?.id, setProfile]);

  const hasChanges = useMemo(() => {
    if (!initialPreferences) return false;

    const arraysEqual = (a: any[], b: any[]) => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    const datesEqual = (a: Date | null, b: Date | null) => {
      if (a === null && b === null) return true;
      if (a === null || b === null) return false;
      return a.getTime() === b.getTime();
    };

    if (!arraysEqual(selectedIntents, initialPreferences.selectedIntents)) return true;
    if (!arraysEqual([...selectedPriceTiers].sort(), [...(initialPreferences.selectedPriceTiers || [])].sort())) return true;
    if (!arraysEqual(selectedCategories, initialPreferences.selectedCategories)) return true;
    if (selectedDateOption !== initialPreferences.selectedDateOption) return true;
    if (selectedTimeSlot !== initialPreferences.selectedTimeSlot) return true;
    if (exactTime !== initialPreferences.exactTime) return true;
    if (!datesEqual(selectedDate, initialPreferences.selectedDate)) return true;
    if (travelMode !== initialPreferences.travelMode) return true;
    if (constraintValue !== initialPreferences.constraintValue) return true;
    if (searchLocation !== initialPreferences.searchLocation) return true;

    return false;
  }, [
    initialPreferences,
    selectedIntents,
    selectedPriceTiers,
    selectedCategories,
    selectedDateOption,
    selectedTimeSlot,
    exactTime,
    selectedDate,
    travelMode,
    constraintValue,
    searchLocation,
  ]);

  const isFormComplete = useMemo(() => {
    const hasPills = selectedCategories.length > 0 || selectedIntents.length > 0;
    const hasBudget = selectedPriceTiers.length > 0;

    let hasDateTime = true;
    if (selectedDateOption === 'Today' || selectedDateOption === 'This Weekend') {
      hasDateTime = !!selectedTimeSlot || !!exactTime;
    } else if (selectedDateOption === 'Pick a Date') {
      hasDateTime = !!selectedDate && (!!selectedTimeSlot || !!exactTime);
    }
    // "Now" requires nothing extra

    const hasTravel = typeof constraintValue === 'number' && constraintValue >= 5;

    return hasPills && hasBudget && hasDateTime && hasTravel;
  }, [selectedCategories, selectedIntents, selectedPriceTiers, selectedDateOption, selectedTimeSlot, exactTime, selectedDate, constraintValue]);

  const ctaHintText = useMemo(() => {
    if (!isFormComplete) {
      if ((selectedDateOption === 'Today' || selectedDateOption === 'This Weekend') && !selectedTimeSlot && !exactTime) {
        return 'Pick a time to continue';
      }
      if (selectedDateOption === 'Pick a Date' && !selectedDate) {
        return 'Pick a date to continue';
      }
      if (selectedDateOption === 'Pick a Date' && selectedDate && !selectedTimeSlot && !exactTime) {
        return 'Pick a time to continue';
      }
      if (typeof constraintValue !== 'number' || constraintValue < 5) {
        return 'Set travel time to continue';
      }
      return 'Complete your preferences';
    }
    return null;
  }, [isFormComplete, selectedDateOption, selectedTimeSlot, exactTime, selectedDate, constraintValue]);

  const countChanges = useCallback((): number => {
    if (!initialPreferences) return 0;

    let changes = 0;

    const arraysEqual = (a: any[], b: any[]) => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    if (!arraysEqual(selectedIntents, initialPreferences.selectedIntents))
      changes++;
    if (!arraysEqual([...selectedPriceTiers].sort(), [...(initialPreferences.selectedPriceTiers || [])].sort()))
      changes++;
    if (
      !arraysEqual(selectedCategories, initialPreferences.selectedCategories)
    )
      changes++;
    if (selectedDateOption !== initialPreferences.selectedDateOption) changes++;
    if (selectedTimeSlot !== initialPreferences.selectedTimeSlot) changes++;
    if (exactTime !== initialPreferences.exactTime) changes++;

    const datesEqual = (a: Date | null, b: Date | null) => {
      if (a === null && b === null) return true;
      if (a === null || b === null) return false;
      return a.getTime() === b.getTime();
    };
    if (!datesEqual(selectedDate, initialPreferences.selectedDate)) changes++;

    if (travelMode !== initialPreferences.travelMode) changes++;
    if (constraintValue !== initialPreferences.constraintValue) changes++;
    if (searchLocation !== initialPreferences.searchLocation) changes++;

    return changes;
  }, [
    initialPreferences,
    selectedIntents,
    selectedPriceTiers,
    selectedCategories,
    selectedDateOption,
    selectedTimeSlot,
    exactTime,
    selectedDate,
    travelMode,
    constraintValue,
    searchLocation,
  ]);

  const handleReset = useCallback(() => {
    mixpanelService.trackPreferencesReset(isCollaborationMode);
    setSelectedIntents(defaultPreferences.selectedIntents);
    setSelectedPriceTiers(defaultPreferences.selectedPriceTiers);
    setSelectedCategories(defaultPreferences.selectedCategories);
    setSelectedDateOption(defaultPreferences.selectedDateOption);
    setSelectedTimeSlot(defaultPreferences.selectedTimeSlot);
    setSelectedDate(defaultPreferences.selectedDate);
    setExactTime(defaultPreferences.exactTime);
    setTravelMode(defaultPreferences.travelMode);
    setConstraintValue(defaultPreferences.constraintValue);
    setSearchLocation(defaultPreferences.searchLocation);
  }, []);

  const handleApplyPreferences = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    const customLocationValue = useGpsLocation
      ? null
      : searchLocation || null;

    // Compute backward-compat budget from selected tiers
    const highestTier = PRICE_TIERS.slice().reverse().find(t => selectedPriceTiers.includes(t.slug));
    const backCompatBudgetMax = highestTier?.max ?? 1000;

    // Normalize date/time, exact time, and location fields for consistency
    const normalized = normalizePreferencesForSave({
      date_option: selectedDateOption?.toLowerCase() || null,
      time_slot: selectedTimeSlot || null,
      exact_time: exactTime || null,
      datetime_pref: selectedDate ? selectedDate.toISOString() : null,
      use_gps_location: useGpsLocation,
      custom_location: customLocationValue,
    });

    // Safety cap — should already be ≤3/≤1 from toggle logic, but enforce at save boundary.
    const finalCategories = selectedCategories.slice(0, MAX_CATEGORIES);
    const finalIntents = capIntents(selectedIntents);

    const preferences = {
      selectedIntents: finalIntents,
      priceTiers: selectedPriceTiers,
      budgetMin: 0,
      budgetMax: backCompatBudgetMax,
      selectedCategories: finalCategories,
      dateOption: selectedDateOption,
      selectedDate: normalized.datetime_pref || selectedDate?.toISOString(),
      selectedTimeSlot: normalized.time_slot || selectedTimeSlot,
      exactTime: normalized.exact_time || '',
      travelMode,
      constraintType,
      constraintValue,
      useLocation,
      searchLocation,
      useGpsLocation: normalized.use_gps_location ?? useGpsLocation,
      custom_location: normalized.custom_location ?? customLocationValue,
    };

    // === CLOSE SHEET IMMEDIATELY — user sees instant response ===
    onClose?.();

    // === FIRE-AND-FORGET: Save + invalidate ===
    // onSave sets the optimistic React Query cache FIRST, then we invalidate
    // deck/curated to trigger re-fetch with the new params.
    (async () => {
      try {
        if (isCollaborationMode) {
          const rawDbPrefs: any = {
            categories: finalCategories,
            intents: finalIntents,
            price_tiers: selectedPriceTiers,
            budget_min: 0,
            budget_max: backCompatBudgetMax,
            travel_mode: travelMode,
            travel_constraint_type: 'time' as const,
            travel_constraint_value:
              typeof constraintValue === "number" ? constraintValue : 30,
            time_of_day: selectedTimeSlot || null,
            datetime_pref: selectedDate ? selectedDate.toISOString() : null,
            date_option: selectedDateOption?.toLowerCase() || null,
            exact_time: exactTime || null,
            use_gps_location: useGpsLocation,
            custom_location: customLocationValue,
          };

          const dbPrefs = normalizePreferencesForSave(rawDbPrefs);

          if (searchLocation) {
            dbPrefs.location = searchLocation;
          }

          await updateBoardPreferences(dbPrefs);
        } else {
          if (onSave) {
            await Promise.resolve(onSave(preferences));
          }
        }
        logAppsFlyerEvent('preferences_updated', {
          is_collaboration: isCollaborationMode,
          categories_count: finalCategories.length,
          intents_count: finalIntents.length,
        });
      } catch (error) {
        console.warn("[PreferencesSheet] Background save failed:", error);
      }

      // Invalidate curated experiences and location — these have separate query keys
      // not driven by batchSeed, so they need explicit invalidation.
      // deck-cards is NOT invalidated — the refreshKey→batchSeed→query key change
      // already triggers the refetch (see RecommendationsContext refreshKey effect).
      queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
      queryClient.invalidateQueries({ queryKey: ["userLocation"] });

    })();

    isSavingRef.current = false;
    setIsSaving(false);
  }, [
    selectedIntents,
    selectedPriceTiers,
    selectedCategories,
    selectedDateOption,
    selectedDate,
    selectedTimeSlot,
    exactTime,
    travelMode,
    constraintType,
    constraintValue,
    useLocation,
    searchLocation,
    useGpsLocation,
    selectedCoords,
    isCollaborationMode,
    updateBoardPreferences,
    user?.id,
    queryClient,
    onSave,
    onClose,
  ]);

  const sheetContent = (
    <>  
      <SafeAreaView style={styles.container} edges={[]}>
        <StatusBar barStyle="dark-content" />
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            {isCollaborationMode && sessionName ? (
              <Text style={styles.subtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {sessionName} Vibes
              </Text>
            ) : (
              <Text style={styles.title}>Your Vibe</Text>
            )}
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <KeyboardAwareScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
          >
          {/* Experience Type Section */}
          <ExperienceTypesSection
            experienceTypes={experienceTypes}
            selectedIntents={selectedIntents}
            onIntentToggle={handleIntentToggle}
            minMessage={minSelectionMessage}
            isCuratedLocked={!canAccess('curated_cards')}
            onLockedTap={() => {
              setPaywallFeature('curated_cards');
              setShowPaywall(true);
            }}
          />

          {/* Categories Section */}
          <CategoriesSection
            filteredCategories={filteredCategories}
            selectedCategories={selectedCategories}
            onCategoryToggle={handleCategoryToggle}
            capMessage={categoryCapMessage}
          />

          {/* Price Tier Section */}
          {!(selectedCategories.length === 1 && selectedCategories[0] === "nature") && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Budget</Text>
              <Text style={styles.sectionSubtitle}>Select every tier you're open to</Text>
              <View style={styles.tierGrid}>
                {PRICE_TIERS.map((tier) => {
                  const isActive = selectedPriceTiers.includes(tier.slug);
                  return (
                    <TouchableOpacity
                      key={tier.slug}
                      style={[
                        styles.tierPill,
                        isActive && { borderColor: tier.color, backgroundColor: tier.color + '14' },
                      ]}
                      onPress={() => handlePriceTierToggle(tier.slug)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.tierIconDot, isActive && { backgroundColor: tier.color }]}>
                        <Icon name={tier.icon} size={13} color={isActive ? '#fff' : '#9CA3AF'} />
                      </View>
                      <View style={styles.tierTextContainer}>
                        <Text style={[styles.tierLabel, isActive && { color: tier.color }]}>{tier.label}</Text>
                        <Text style={[styles.tierRange, isActive && { color: tier.color, opacity: 0.7 }]}>{tier.rangeLabel}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Date & Time Section */}
          <DateTimeSection
            dateOptions={dateOptions}
            selectedDateOption={selectedDateOption}
            onDateOptionSelect={handleDateOptionSelect}
            showWeekendInfo={selectedDateOption === "This Weekend"}
            showCalendarInput={selectedDateOption === "Pick a Date"}
            selectedDate={selectedDate}
            onShowCalendar={() => setShowCalendar(true)}
            showTimeSection={selectedDateOption && selectedDateOption !== "Now"}
            exactTime={exactTime}
            onShowTimePicker={() => setShowTimePicker(true)}
            formatDateForDisplay={formatDateForDisplay}
          />

          {/* Travel Mode Section */}
          <TravelModeSection
            travelModes={travelModes}
            travelMode={travelMode}
            onTravelModeChange={setTravelMode}
          />

          {/* Travel Limit Section */}
          <TravelLimitSection
            constraintValue={constraintValue}
            onConstraintValueChange={(text) => {
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
            onFocus={() => {}}
          />

          {/* Starting Point Section */}
          <View
            ref={locationSectionRef}
            style={styles.section}
            onLayout={(event) => {
              const { y } = event.nativeEvent.layout;
              locationSectionY.current = y;
            }}
          >
            <Text style={styles.sectionTitle}>Starting Point</Text>
            <Text style={styles.sectionSubtitle}>
              Where should we start looking?
            </Text>

            <LocationInputSection
              searchLocation={searchLocation}
              onLocationInputChange={handleLocationInputChange}
              onFocus={() => {
                setIsInputFocused(true);
                if (suggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              onBlur={handleInputBlur}
              showSuggestions={showSuggestions}
              suggestions={suggestions}
              isLoadingSuggestions={isLoadingSuggestions}
              onSuggestionSelect={handleSuggestionSelect}
              isInputFocused={isInputFocused}
              useGpsLocation={useGpsLocation}
              onToggleGps={handleGpsToggle}
              isLocked={!canAccess('custom_starting_point')}
              onLockedTap={() => {
                setPaywallFeature('custom_starting_point');
                setShowPaywall(true);
              }}
            />
          </View>

          </KeyboardAwareScrollView>
        {/* Apply Button */}
        <View
          style={[
            styles.footer,
            { paddingBottom: 48 },
          ]}
        >
          <View style={styles.footerButtonsContainer}>
            <TouchableOpacity
              onPress={handleApplyPreferences}
              style={[
                styles.applyButton,
                (isSaving || !isFormComplete || !hasChanges) && styles.applyButtonDisabled,
              ]}
              disabled={isSaving || !isFormComplete || !hasChanges}
              accessibilityLabel={ctaHintText ?? (hasChanges ? `Lock It In, ${countChanges()} changes` : 'Lock It In')}
              accessibilityState={{ disabled: isSaving || !isFormComplete || !hasChanges }}
            >
              {isSaving ? (
                <View style={styles.buttonLoadingContainer}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.applyButtonText}>Saving...</Text>
                </View>
              ) : (
                <Text style={styles.applyButtonText}>
                  {ctaHintText ?? (hasChanges ? `Lock It In (${countChanges()})` : 'Lock It In')}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReset}
              style={styles.resetButton}
              disabled={isSaving}
            >
              <Text style={styles.resetButtonText}>Start Over</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Calendar Modal */}
      <Modal
        visible={showCalendar}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCalendar(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.backdropTouch}
            onPress={() => setShowCalendar(false)}
          />
          <SafeAreaView style={styles.modalContent} edges={["bottom"]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Date</Text>
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
              <Pressable
                style={styles.backdropTouch}
                onPress={() => setShowTimePicker(false)}
              />
              <SafeAreaView style={styles.modalContent} edges={["bottom"]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Time</Text>
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

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
        initialTier="pro"
      />
    </>
  );

  // If `visible` prop is supplied, present inside a Modal (88% height bottom-sheet)
  // Otherwise render inline for backward-compat (full-screen usage from index.tsx)
  if (typeof visible !== "undefined") {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent={true}
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.backdropTouch} onPress={onClose} />
          <View style={[styles.sheetContent, { height: appLayout.screenHeight - appLayout.insets.top - vs(20) }]}>
            {preferencesLoading ? (
              <LoadingShimmer />
            ) : (
              sheetContent
            )}
          </View>
        </View>
      </Modal>
    );
  }

  // Legacy inline rendering (full-screen)
  if (preferencesLoading) {
    return (
      <View style={styles.overlayContainer}>
        <LoadingShimmer />
      </View>
    );
  }

  return (
    <View style={styles.overlayContainer}>
      <View style={styles.modalContainer}>
        {sheetContent}
      </View>
    </View>
  );
}

// SCREEN_WIDTH and SCREEN_HEIGHT are now imported from responsive.ts

// Sheet fills from bottom, accounting for status bar area
// Actual height is computed dynamically when useAppLayout is available;
// this static fallback is used only for legacy full-screen overlay styles.
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

const styles = StyleSheet.create({
  // --- Bottom-sheet modal styles (used when `visible` prop is passed) ---
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContent: {
    height: SHEET_HEIGHT,
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  // --- Legacy full-screen styles (used when `visible` prop is not provided) ---
  overlayContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  // --- Shared styles ---
  container: {
    flex: 1,
    backgroundColor: "#fafaf9",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 120,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    backgroundColor: "#ffffff",
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0ebe6",
  },
  titleContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  // --- Section (used for Budget + Starting Point inline sections) ---
  section: {
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#f0ebe6",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 10,
  },
  // --- Price Tier Pills ---
  tierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tierPill: {
    width: "47%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
    gap: 8,
  },
  tierIconDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  tierTextContainer: {
    flex: 1,
  },
  tierLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  tierRange: {
    fontSize: 10,
    color: "#9CA3AF",
    marginTop: 1,
  },
  // --- Footer ---
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#f0ebe6",
    paddingHorizontal: 16,
    paddingTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  footerButtonsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  applyButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  resetButton: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  resetButtonText: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "600",
  },
  applyButtonDisabled: {
    opacity: 0.7,
  },
  applyButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  buttonLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // --- Calendar/Time Picker Modals ---
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
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
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  timePicker: {
    width: "100%",
    height: 200,
  },
});
