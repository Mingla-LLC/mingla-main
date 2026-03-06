import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
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
import { KeyboardAwareView } from "./ui/KeyboardAwareView";
import { useKeyboard } from "../hooks/useKeyboard";
import { Ionicons } from "@expo/vector-icons";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { PreferencesService } from "../services/preferencesService";
import { locationService } from "../services/locationService";
import { offlineService } from "../services/offlineService";
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
  { id: "friendly",      label: "Friendly",       icon: "people-outline" },
  { id: "group-fun",     label: "Group Fun",      icon: "people-circle-outline" },
  { id: "picnic-dates",  label: "Picnic Dates",   icon: "basket-outline" },
  { id: "take-a-stroll", label: "Take a Stroll",  icon: "walk-outline" },
];

// Budget presets removed — using PRICE_TIERS from constants/priceTiers

// Categories with exact icons from image
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

// Normalize legacy display-name categories (e.g. "Nature") to slug IDs (e.g. "nature")
const CATEGORY_LABEL_TO_ID: Record<string, string> = {};
categories.forEach(c => { CATEGORY_LABEL_TO_ID[c.label.toLowerCase()] = c.id; });
const normalizeCategoryIds = (raw: string[]): string[] =>
  raw.map(c => CATEGORY_LABEL_TO_ID[c.toLowerCase()] || c);

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
  const { user } = useAuthSimple();
  const { profile, setProfile } = useAppStore();
  const queryClient = useQueryClient();
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

  // Starting Point
  const [useLocation, setUseLocation] = useState<"gps" | "search">("gps");
  const [searchLocation, setSearchLocation] = useState<string>("");
  const [useGpsLocation, setUseGpsLocation] = useState<boolean>(true);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);

  // Location autocomplete suggestions
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSelectingSuggestion = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const locationSectionRef = useRef<View>(null);
  const locationSectionY = useRef<number>(0);
  const budgetInputContainerRef = useRef<View>(null);
  const constraintInputContainerRef = useRef<View>(null);
  const locationInputContainerRef = useRef<View>(null);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);

  const isSavingRef = useRef(false);
  const isInternalUpdate = useRef(false);
  const { keyboardHeight: kbHeight } = useKeyboard();
  const kbHeightRef = useRef(0);
  const currentScrollOffsetRef = useRef(0);
  kbHeightRef.current = kbHeight;

  // Track scroll position in real-time
  const handleScroll = (event: any) => {
    currentScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  };

  /**
   * Scroll the field to sit just above the keyboard with precision.
   */
  const scrollToField = useCallback((fieldRef: React.RefObject<View | null>) => {
    if (!fieldRef.current || !scrollViewRef.current) return;

    setTimeout(() => {
      const kbH = kbHeightRef.current;
      if (kbH === 0) return;
      
      try {
        (scrollViewRef.current as any).measureInWindow((svX: number, svY: number, svW: number, svH: number) => {
          (fieldRef.current as any).measureInWindow((fX: number, fY: number, fW: number, fH: number) => {
            const fieldYRelativeToScrollView = fY - svY;
            const fieldBottomRelativeToScrollView = fieldYRelativeToScrollView + fH;
            const keyboardStartOnScreen = SCREEN_HEIGHT - kbH;
            const scrollViewBottomOnScreen = svY + svH;
            const visibleHeightOfScrollView = Math.min(svH, keyboardStartOnScreen - svY);
            const BOTTOM_OFFSET = 48;
            const targetFieldBottomPosition = visibleHeightOfScrollView - BOTTOM_OFFSET - 30;
            const overshoot = fieldBottomRelativeToScrollView - targetFieldBottomPosition;
            
            if (overshoot > 0) {
              const newScrollOffset = currentScrollOffsetRef.current + overshoot;
              scrollViewRef.current?.scrollTo({
                y: newScrollOffset,
                animated: true,
              });
            }
          });
        });
      } catch (error) {
        console.warn("Error scrolling to field:", error);
      }
    }, 350);
  }, []);

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
      setSelectedIntents(
        Array.isArray((loadedPreferences as any).intents) ? (loadedPreferences as any).intents : []
      );
      const collabCats = normalizeCategoryIds(
        Array.isArray(loadedPreferences.categories) ? loadedPreferences.categories : []
      );
      setSelectedCategories(collabCats);
      if (Array.isArray((loadedPreferences as any).price_tiers) && (loadedPreferences as any).price_tiers.length > 0) {
        setSelectedPriceTiers((loadedPreferences as any).price_tiers);
      }
      if ((loadedPreferences as any).travel_mode) {
        setTravelMode((loadedPreferences as any).travel_mode);
      }
      // travel_constraint_type is always 'time' — no need to load from DB
      if ((loadedPreferences as any).travel_constraint_value !== undefined) {
        setConstraintValue((loadedPreferences as any).travel_constraint_value);
      }
      if ((loadedPreferences as any).time_of_day) {
        const timeSlot = (loadedPreferences as any).time_of_day;
        if (["brunch", "afternoon", "dinner", "lateNight"].includes(timeSlot)) {
          setSelectedTimeSlot(timeSlot as TimeSlot);
        }
      }
      if ((loadedPreferences as any).datetime_pref) {
        const date = new Date((loadedPreferences as any).datetime_pref);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
        }
      }
      if ((loadedPreferences as any).location) {
        const savedLocation = (loadedPreferences as any).location;
        setSearchLocation(savedLocation);
        const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(savedLocation);
        setUseLocation(isCoordinates ? "gps" : "search");
      }

      setInitialPreferences({
        selectedIntents: Array.isArray((loadedPreferences as any).intents)
          ? (loadedPreferences as any).intents
          : [],
        selectedPriceTiers: Array.isArray((loadedPreferences as any).price_tiers) && (loadedPreferences as any).price_tiers.length > 0
          ? (loadedPreferences as any).price_tiers
          : ['chill', 'comfy', 'bougie', 'lavish'],
        budgetMin: (loadedPreferences as any).budget_min || 0,
        budgetMax: (loadedPreferences as any).budget_max || 200,
        selectedCategories: collabCats,
        selectedDateOption: "Now",
        selectedTimeSlot: (loadedPreferences as any).time_of_day || null,
        selectedDate: (loadedPreferences as any).datetime_pref
          ? new Date((loadedPreferences as any).datetime_pref)
          : null,
        exactTime: "",
        travelMode: (loadedPreferences as any).travel_mode || "walking",
        constraintType: 'time' as const,
        constraintValue: (loadedPreferences as any).travel_constraint_value || 30,
        searchLocation: (loadedPreferences as any).location || "",
      });
    } else {
      // Load from solo preferences — intents and categories are separate DB columns
      setSelectedIntents(
        Array.isArray((loadedPreferences as any).intents) ? (loadedPreferences as any).intents : []
      );
      const soloCats = normalizeCategoryIds(
        Array.isArray(loadedPreferences.categories) ? loadedPreferences.categories : []
      );
      setSelectedCategories(soloCats);

      if (Array.isArray((loadedPreferences as any).price_tiers) && (loadedPreferences as any).price_tiers.length > 0) {
        setSelectedPriceTiers((loadedPreferences as any).price_tiers);
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

      if ((loadedPreferences as any).time_slot) {
        const timeSlot = (loadedPreferences as any).time_slot;
        if (["brunch", "afternoon", "dinner", "lateNight"].includes(timeSlot)) {
          setSelectedTimeSlot(timeSlot as TimeSlot);
        }
      }

      if ((loadedPreferences as any).exact_time) {
        setExactTime((loadedPreferences as any).exact_time);
      }

      if (loadedPreferences.datetime_pref) {
        const date = new Date(loadedPreferences.datetime_pref);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
        }
      }

      const gpsFlag = (loadedPreferences as any).use_gps_location ?? true;
      setUseGpsLocation(gpsFlag);

      if (!gpsFlag && (loadedPreferences as any).custom_location) {
        const savedLocation = (loadedPreferences as any).custom_location;
        setSearchLocation(savedLocation);
        const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(savedLocation);
        setUseLocation(isCoordinates ? "gps" : "search");
      }

      setInitialPreferences({
        selectedIntents: Array.isArray((loadedPreferences as any).intents)
          ? (loadedPreferences as any).intents
          : [],
        selectedPriceTiers: Array.isArray((loadedPreferences as any).price_tiers) && (loadedPreferences as any).price_tiers.length > 0
          ? (loadedPreferences as any).price_tiers
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
        selectedTimeSlot: (loadedPreferences as any).time_slot || null,
        selectedDate: loadedPreferences.datetime_pref
          ? new Date(loadedPreferences.datetime_pref)
          : null,
        exactTime: (loadedPreferences as any).exact_time || "",
        travelMode: loadedPreferences.travel_mode || "walking",
        constraintType: 'time' as const,
        constraintValue: loadedPreferences.travel_constraint_value || 30,
        searchLocation: (loadedPreferences as any).custom_location || "",
      });
    }
  }, [loadedPreferences, preferencesLoading, visible, isCollaborationMode]);

  // All categories always visible — curated pills are independent of category pills
  const filteredCategories = categories;

  // Memoized callbacks
  const handleIntentToggle = useCallback((id: string) => {
    setSelectedIntents((prev) => {
      if (prev.includes(id)) {
        // Deselecting — check combined minimum
        if (prev.length === 1 && selectedCategories.length === 0) {
          setMinSelectionMessage(true);
          setTimeout(() => setMinSelectionMessage(false), 2500);
          return prev;
        }
        return [];  // Radio: goes to 0
      }
      return [id];  // Radio: replace with only this one
    });
  }, [selectedCategories.length]);

  const handleCategoryToggle = useCallback((id: string) => {
    setSelectedCategories((prev) => {
      if (prev.includes(id)) {
        // Deselecting — check combined minimum
        if (prev.length === 1 && selectedIntents.length === 0) {
          setMinSelectionMessage(true);
          setTimeout(() => setMinSelectionMessage(false), 2500);
          return prev;
        }
        return prev.filter((c) => c !== id);
      }
      if (prev.length >= 3) {
        setCategoryCapMessage(true);
        setTimeout(() => setCategoryCapMessage(false), 2000);
        return prev;
      }
      return [...prev, id];
    });
  }, [selectedIntents.length]);

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
      setSelectedWeekendDay(null);
      setExactTime("");
    } else if (option === "Today") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
      setSelectedWeekendDay(null);
    } else if (option === "This Weekend") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
    } else if (option === "Pick a Date") {
      setSelectedTimeSlot(null);
      setSelectedWeekendDay(null);
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

  const handleSuggestionSelect = useCallback((suggestion: AutocompleteSuggestion) => {
    isSelectingSuggestion.current = true;
    setSearchLocation(suggestion.displayName);
    setSelectedCoords(suggestion.location ?? null);
    setShowSuggestions(false);
    setIsInputFocused(false);

    // Auto-detect locale from custom location coordinates (fire-and-forget)
    if (suggestion.location) {
      detectLocaleFromCoordinates(suggestion.location.lat, suggestion.location.lng).then((detected) => {
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
    }
  }, [user?.id, setProfile]);

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
      : selectedCoords
        ? `${selectedCoords.lat},${selectedCoords.lng}`
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

    const preferences = {
      selectedIntents,
      priceTiers: selectedPriceTiers,
      budgetMin: 0,
      budgetMax: backCompatBudgetMax,
      selectedCategories,
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

    // Allow empty categories when intents are selected — user wants curated-only.
    // The deck will show only curated cards for the selected intents.
    const finalCategories = selectedCategories;

    setIsSaving(true); // UI-only — ref guard above is the real mutex
    try {
      // === CRITICAL PATH: Save to DB with 30s timeout ===
      const savePromise = (async () => {
        if (isCollaborationMode) {
          const rawDbPrefs: any = {
            categories: finalCategories,
            intents: selectedIntents,
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
            const saveResult = await Promise.resolve(onSave(preferences));
            if (saveResult === false) throw new Error('Save rejected');
          }
        }
      })();

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Save timeout after 15s')), 15000);
      });

      try {
        await Promise.race([savePromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId!);
      }

      // === CLOSE SHEET FIRST — user sees instant response ===
      onClose?.();

      // === Invalidate caches immediately — ensures fresh data on next render ===
      queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
      queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
      queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
      queryClient.invalidateQueries({ queryKey: ["userLocation"] });

      // === FIRE-AND-FORGET: Non-critical post-save operations ===
      if (user?.id) {
        PreferencesService.getUserPreferences(user.id)
          .then(prefs => {
            if (prefs) offlineService.cacheUserPreferences(prefs);
          })
          .catch(() => {}); // Silent — non-critical
      }

    } catch (error) {
      console.error("[PreferencesSheet] Save failed:", error);
      Alert.alert(
        "Couldn\u2019t Save",
        'Something went wrong. Give it another try.',
        [{ text: 'OK' }]
      );
    } finally {
      isSavingRef.current = false;
      setIsSaving(false); // ALWAYS resets, even on timeout/error
    }
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

        <KeyboardAwareView style={{ flex: 1 }} dismissOnTap={false}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
          {/* Experience Type Section */}
          <ExperienceTypesSection
            experienceTypes={experienceTypes}
            selectedIntents={selectedIntents}
            onIntentToggle={handleIntentToggle}
            minMessage={minSelectionMessage}
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
                        <Ionicons name={tier.icon as any} size={13} color={isActive ? '#fff' : '#9CA3AF'} />
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
            onFocus={() => scrollToField(constraintInputContainerRef)}
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
                scrollToField(locationInputContainerRef);
              }}
              onBlur={handleInputBlur}
              showSuggestions={showSuggestions}
              suggestions={suggestions}
              isLoadingSuggestions={isLoadingSuggestions}
              onSuggestionSelect={handleSuggestionSelect}
              isInputFocused={isInputFocused}
              useGpsLocation={useGpsLocation}
              onToggleGps={handleGpsToggle}
            />
          </View>

          </ScrollView>
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
              style={[styles.applyButton, isSaving && styles.applyButtonDisabled]}
              disabled={isSaving}
            >
              {isSaving ? (
                <View style={styles.buttonLoadingContainer}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.applyButtonText}>Saving...</Text>
                </View>
              ) : (
                <Text style={styles.applyButtonText}>
                  Lock It In {countChanges() > 0 ? `(${countChanges()})` : ""}
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
      </KeyboardAwareView>

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
    width: "47%" as any,
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
