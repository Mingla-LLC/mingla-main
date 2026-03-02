import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
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
  Dimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
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
import {
  ExperienceTypesSection,
  CategoriesSection,
  DateTimeSection,
  TravelModeSection,
  LoadingShimmer,
} from "./PreferencesSheet/PreferencesSections";
import {
  BudgetSection,
  TravelLimitSection,
  LocationInputSection,
} from "./PreferencesSheet/PreferencesSectionsAdvanced";

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

// Budget presets
const budgetPresets = [
  { label: "Up to $25",  max: 25  },
  { label: "Up to $50",  max: 50  },
  { label: "Up to $100", max: 100 },
  { label: "Up to $150", max: 150 },
];

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

// Compatibility matrix: maps intent IDs to allowed category IDs
// null means all categories are allowed
const INTENT_CATEGORY_COMPATIBILITY: Record<string, string[] | null> = {
  "adventurous":   null, // All categories allowed
  "first-date":    ["fine_dining", "watch", "nature", "first_meet", "creative_arts", "play", "work_business"],
  "romantic":      ["fine_dining", "creative_arts", "wellness"],
  "friendly":      null, // All categories allowed
  "group-fun":     ["play", "watch", "casual_eats"],
  "picnic-dates":  ["groceries_flowers", "picnic_park"],
  "take-a-stroll": ["casual_eats", "nature"],
};

// Get allowed category IDs based on selected intents
const getAllowedCategoryIds = (
  selectedIntents: string[]
): Set<string> | null => {
  if (selectedIntents.length === 0) {
    // If no intents selected, show all categories
    return null;
  }

  const allowedSets: Set<string>[] = [];

  for (const intent of selectedIntents) {
    const allowed = INTENT_CATEGORY_COMPATIBILITY[intent];
    if (allowed === null) {
      // This intent allows all categories, so return null (all allowed)
      return null;
    }
    allowedSets.push(new Set(allowed));
  }

  // Union of all allowed categories
  const union = new Set<string>();
  for (const allowedSet of allowedSets) {
    for (const categoryId of allowedSet) {
      union.add(categoryId);
    }
  }

  return union;
};

export default function PreferencesSheet({
  visible,
  onClose,
  onSave,
  accountPreferences,
  sessionId,
  sessionName,
}: PreferencesSheetProps) {
  const { user } = useAuthSimple();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // Only load preferences data if modal is visible
  const {
    preferences: loadedPreferences,
    isLoading: preferencesLoading,
    isCollaborationMode,
    updateBoardPreferences,
  } = usePreferencesData(user?.id, sessionId, !!visible);

  // Experience Types (Intents)
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);

  // Budget
  const [budgetMin, setBudgetMin] = useState<number | "">(0);
  const [budgetMax, setBudgetMax] = useState<number | "">(200);

  // Categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

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
  const [constraintType, setConstraintType] = useState<"time" | "distance">(
    "time"
  );
  const [constraintValue, setConstraintValue] = useState<number | "">(20);

  // Starting Location
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
            const { height: screenHeight } = Dimensions.get('window');
            const fieldYRelativeToScrollView = fY - svY;
            const fieldBottomRelativeToScrollView = fieldYRelativeToScrollView + fH;
            const keyboardStartOnScreen = screenHeight - kbH;
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
    budgetMin: 0,
    budgetMax: 200,
    selectedCategories: [],
    selectedDateOption: "Now" as DateOption,
    selectedTimeSlot: null,
    selectedDate: null,
    exactTime: "",
    travelMode: "walking",
    constraintType: "time" as "time" | "distance",
    constraintValue: 20,
    searchLocation: "",
  };

  // Initialize state from loaded preferences
  useEffect(() => {
    if (!loadedPreferences || preferencesLoading || !visible) {
      return;
    }

    if (isCollaborationMode) {
      // Load from board session preferences
      // Intents and categories are both stored in the `categories` column —
      // split them the same way solo mode does.
      const intentIds = new Set([
        "adventurous", "first-date", "romantic",
        "friendly", "group-fun", "picnic-dates", "take-a-stroll",
      ]);
      if (loadedPreferences.categories && Array.isArray(loadedPreferences.categories)) {
        const loadedIntents: string[] = [];
        const loadedCats: string[] = [];
        loadedPreferences.categories.forEach((item: string) => {
          if (intentIds.has(item)) {
            loadedIntents.push(item);
          } else {
            loadedCats.push(item);
          }
        });
        setSelectedIntents(loadedIntents);
        setSelectedCategories(loadedCats);
      }
      if ((loadedPreferences as any).budget_min !== undefined) {
        setBudgetMin((loadedPreferences as any).budget_min);
      }
      if ((loadedPreferences as any).budget_max !== undefined) {
        setBudgetMax((loadedPreferences as any).budget_max);
      }
      if ((loadedPreferences as any).travel_mode) {
        setTravelMode((loadedPreferences as any).travel_mode);
      }
      if ((loadedPreferences as any).travel_constraint_type) {
        setConstraintType(
          (loadedPreferences as any).travel_constraint_type as "time" | "distance"
        );
      }
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
        selectedIntents: (loadedPreferences.categories || []).filter((item: string) =>
          ["adventurous", "first-date", "romantic", "friendly", "group-fun", "picnic-dates", "take-a-stroll"].includes(item)
        ),
        budgetMin: (loadedPreferences as any).budget_min || 0,
        budgetMax: (loadedPreferences as any).budget_max || 200,
        selectedCategories: (loadedPreferences.categories || []).filter((item: string) =>
          !["adventurous", "first-date", "romantic", "friendly", "group-fun", "picnic-dates", "take-a-stroll"].includes(item)
        ),
        selectedDateOption: "Now",
        selectedTimeSlot: (loadedPreferences as any).time_of_day || null,
        selectedDate: (loadedPreferences as any).datetime_pref
          ? new Date((loadedPreferences as any).datetime_pref)
          : null,
        exactTime: "",
        travelMode: (loadedPreferences as any).travel_mode || "walking",
        constraintType: ((loadedPreferences as any).travel_constraint_type || "time") as
          | "time"
          | "distance",
        constraintValue: (loadedPreferences as any).travel_constraint_value || 20,
        searchLocation: (loadedPreferences as any).location || "",
      });
    } else {
      // Load from solo preferences
      if (loadedPreferences.categories && Array.isArray(loadedPreferences.categories)) {
        const intentIds = new Set([
          "adventurous",
          "first-date",
          "romantic",
          "friendly",
          "group-fun",
          "picnic-dates",
          "take-a-stroll",
        ]);

        const loadedIntents: string[] = [];
        const loadedCategories: string[] = [];

        loadedPreferences.categories.forEach((item: string) => {
          if (intentIds.has(item)) {
            loadedIntents.push(item);
          } else {
            loadedCategories.push(item);
          }
        });

        setSelectedIntents(loadedIntents);
        setSelectedCategories(loadedCategories);
      }

      if (loadedPreferences.budget_min !== undefined)
        setBudgetMin(loadedPreferences.budget_min || 0);
      if (loadedPreferences.budget_max !== undefined)
        setBudgetMax(loadedPreferences.budget_max || 200);

      if (loadedPreferences.travel_mode) {
        setTravelMode(loadedPreferences.travel_mode);
      }

      if (loadedPreferences.travel_constraint_type) {
        setConstraintType(
          loadedPreferences.travel_constraint_type as "time" | "distance"
        );
      }
      if (loadedPreferences.travel_constraint_value) {
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
        selectedIntents: (loadedPreferences.categories || []).filter((item: string) =>
          [
            "adventurous",
            "first-date",
            "romantic",
            "friendly",
            "group-fun",
            "picnic-dates",
            "take-a-stroll",
          ].includes(item)
        ),
        budgetMin: loadedPreferences.budget_min || 0,
        budgetMax: loadedPreferences.budget_max || 200,
        selectedCategories: (loadedPreferences.categories || []).filter(
          (item: string) =>
            ![
              "adventurous",
              "first-date",
              "romantic",
              "friendly",
              "group-fun",
              "picnic-dates",
              "take-a-stroll",
            ].includes(item)
        ),
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
        constraintType: (loadedPreferences.travel_constraint_type ||
          "time") as "time" | "distance",
        constraintValue: loadedPreferences.travel_constraint_value || 20,
        searchLocation: (loadedPreferences as any).custom_location || "",
      });
    }
  }, [loadedPreferences, preferencesLoading, visible, isCollaborationMode]);

  // Filter categories based on selected intents
  const filteredCategories = useMemo(() => {
    const allowedIds = getAllowedCategoryIds(selectedIntents);
    if (allowedIds === null) {
      return categories;
    }
    return categories.filter((category) => allowedIds.has(category.id));
  }, [selectedIntents]);

  // Filter out invalid selectedCategories when intents change
  useEffect(() => {
    const allowedIds = getAllowedCategoryIds(selectedIntents);
    if (allowedIds !== null) {
      setSelectedCategories((prev) => {
        const validCategories = prev.filter((catId) => allowedIds.has(catId));
        return validCategories.length !== prev.length ? validCategories : prev;
      });
    }
  }, [selectedIntents]);

  // Memoized callbacks
  const handleIntentToggle = useCallback((id: string) => {
    setSelectedIntents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const handleCategoryToggle = useCallback((id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const setBudgetPreset = useCallback((max: number) => {
    setBudgetMin(0);
    setBudgetMax(max);
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

    setTimeout(() => {
      isSelectingSuggestion.current = false;
    }, 300);
  }, []);

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
    }
  }, []);

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
    if (budgetMin !== initialPreferences.budgetMin) changes++;
    if (budgetMax !== initialPreferences.budgetMax) changes++;
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
    if (constraintType !== initialPreferences.constraintType) changes++;
    if (constraintValue !== initialPreferences.constraintValue) changes++;
    if (searchLocation !== initialPreferences.searchLocation) changes++;

    return changes;
  }, [
    initialPreferences,
    selectedIntents,
    budgetMin,
    budgetMax,
    selectedCategories,
    selectedDateOption,
    selectedTimeSlot,
    exactTime,
    selectedDate,
    travelMode,
    constraintType,
    constraintValue,
    searchLocation,
  ]);

  const handleReset = useCallback(() => {
    setSelectedIntents(defaultPreferences.selectedIntents);
    setBudgetMin(defaultPreferences.budgetMin);
    setBudgetMax(defaultPreferences.budgetMax);
    setSelectedCategories(defaultPreferences.selectedCategories);
    setSelectedDateOption(defaultPreferences.selectedDateOption);
    setSelectedTimeSlot(defaultPreferences.selectedTimeSlot);
    setSelectedDate(defaultPreferences.selectedDate);
    setExactTime(defaultPreferences.exactTime);
    setTravelMode(defaultPreferences.travelMode);
    setConstraintType(defaultPreferences.constraintType);
    setConstraintValue(defaultPreferences.constraintValue);
    setSearchLocation(defaultPreferences.searchLocation);
  }, []);

  const handleApplyPreferences = useCallback(async () => {
    if (isSaving) return;

    const customLocationValue = useGpsLocation
      ? null
      : selectedCoords
        ? `${selectedCoords.lat},${selectedCoords.lng}`
        : searchLocation || null;

    const preferences = {
      selectedIntents,
      budgetMin,
      budgetMax,
      selectedCategories,
      dateOption: selectedDateOption,
      selectedDate: selectedDate?.toISOString(),
      selectedTimeSlot,
      exactTime,
      travelMode,
      constraintType,
      constraintValue,
      useLocation,
      searchLocation,
      useGpsLocation,
      custom_location: customLocationValue,
    };

    const nextUserPreferences = {
      mode: "explore",
      budget_min: typeof budgetMin === "number" ? budgetMin : 0,
      budget_max: typeof budgetMax === "number" ? budgetMax : 1000,
      people_count: 1,
      categories: [...selectedIntents, ...selectedCategories],
      travel_mode: travelMode,
      travel_constraint_type: constraintType,
      travel_constraint_value:
        typeof constraintValue === "number" ? constraintValue : 20,
      datetime_pref: selectedDate ? selectedDate.toISOString() : new Date().toISOString(),
      date_option: selectedDateOption
        ? {
            Now: "now",
            Today: "today",
            "This Weekend": "weekend",
            "Pick a Date": "custom",
          }[selectedDateOption]
        : null,
      exact_time: exactTime || null,
    } as any;

    if (user?.id) {
      queryClient.setQueryData(["userPreferences", user.id], nextUserPreferences);
    }

    setIsSaving(true);
    try {
      // === CRITICAL PATH: Save to DB with 10s timeout ===
      const savePromise = (async () => {
        if (isCollaborationMode) {
          const dbPrefs: any = {
            categories: [...selectedIntents, ...selectedCategories],
            budget_min: typeof budgetMin === "number" ? budgetMin : 0,
            budget_max: typeof budgetMax === "number" ? budgetMax : 1000,
            travel_mode: travelMode,
            travel_constraint_type: constraintType,
            travel_constraint_value:
              typeof constraintValue === "number" ? constraintValue : 20,
            time_of_day: selectedTimeSlot || null,
            datetime_pref: selectedDate ? selectedDate.toISOString() : null,
          };

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

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Save timeout after 10s')), 10000)
      );

      await Promise.race([savePromise, timeoutPromise]);

      // === SUCCESS: Non-blocking cache invalidation ===
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
      queryClient.invalidateQueries({ queryKey: ["nature-cards"] });
      queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
      queryClient.invalidateQueries({ queryKey: ["userLocation"] });

      // === CLOSE SHEET IMMEDIATELY ===
      onClose?.();

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
    } finally {
      setIsSaving(false); // ALWAYS resets, even on timeout/error
    }
  }, [
    isSaving,
    selectedIntents,
    budgetMin,
    budgetMax,
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
                Preferences for {sessionName}
              </Text>
            ) : (
              <Text style={styles.title}>Solo Preferences</Text>
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
          />

          {/* Categories Section */}
          <CategoriesSection
            filteredCategories={filteredCategories}
            selectedCategories={selectedCategories}
            onCategoryToggle={handleCategoryToggle}
          />

          {/* Budget Section */}
          <BudgetSection
            budgetMax={budgetMax}
            budgetPresets={budgetPresets}
            onBudgetChange={(text) => {
              setBudgetMax(text ? Number(text) : "");
              setBudgetMin(0);
            }}
            onBudgetPresetClick={setBudgetPreset}
            onFocus={() => scrollToField(budgetInputContainerRef)}
            accountPreferences={accountPreferences}
            shouldHide={selectedCategories.length === 1 && selectedCategories[0] === "nature"}
          />

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
            constraintType={constraintType}
            constraintValue={constraintValue}
            onConstraintTypeChange={setConstraintType}
            onConstraintValueChange={(text) => {
              const numericValue = text.replace(/[^0-9]/g, "");
              setConstraintValue(numericValue ? Number(numericValue) : "");
            }}
            onFocus={() => scrollToField(constraintInputContainerRef)}
            accountPreferences={accountPreferences}
          />

          {/* Starting Location Section */}
          <View
            ref={locationSectionRef}
            style={styles.section}
            onLayout={(event) => {
              const { y } = event.nativeEvent.layout;
              locationSectionY.current = y;
            }}
          >
            <Text style={styles.sectionTitle}>Starting Location</Text>
            <Text style={styles.sectionSubtitle}>
              {useGpsLocation
                ? "Using your current GPS location."
                : "Using your custom location. Toggle on to use GPS."}
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
                  Apply {countChanges() > 0 ? `(${countChanges()})` : ""}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReset}
              style={styles.resetButton}
              disabled={isSaving}
            >
              <Text style={styles.resetButtonText}>Reset</Text>
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
          <View style={styles.sheetContent}>
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Match SessionViewModal: 88% height bottom-sheet
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

const styles = StyleSheet.create({
  // --- New bottom-sheet modal styles (used when `visible` prop is passed) ---
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
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30,
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
    backgroundColor: "#ffffff",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    zIndex: 10,
  },
  titleContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "center",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
  },
  section: {
    backgroundColor: "white",
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 3,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 10,
  },
  sectionQuestion: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
  },
  sectionHeaderWithBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  requiredBadge: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  requiredBadgeText: {
    fontSize: 10,
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
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  experienceTypeButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  experienceTypeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  experienceTypeTextSelected: {
    color: "#ffffff",
  },
  budgetInputsContainer: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  budgetInputWrapper: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
  },
  budgetInputContainer: {
    position: "relative",
    marginBottom: 12,
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
    paddingLeft: 28,
    paddingRight: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    fontSize: 14,
    backgroundColor: "white",
  },
  budgetPresetsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  budgetPresetButton: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 3,
    alignItems: "center",
    overflow: "visible",
  },
  budgetPresetText: {
    fontSize: 10,
    color: "#374151",
    fontWeight: "500",
  },
  categoriesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
    width: "31%",
  },
  categoryButtonSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  categoryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  categoryTextSelected: {
    color: "#eb7825",
  },
  dateOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  dateOptionPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  dateOptionPillSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  dateOptionPillLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  dateOptionPillLabelSelected: {
    color: "#eb7825",
    fontWeight: "600",
  },
  weekendInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#e0f2fe",
    marginTop: 8,
    borderWidth: 0,
  },
  weekendInfoIcon: {
    marginRight: 12,
  },
  weekendInfoContent: {
    flex: 1,
  },
  weekendInfoLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0369a1",
    marginBottom: 2,
  },
  weekendInfoDescription: {
    fontSize: 12,
    color: "#0c4a6e",
    opacity: 0.9,
  },
  dateInputField: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#eb7825",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  dateInputText: {
    fontSize: 14,
    color: "#111827",
    marginLeft: 8,
    flex: 1,
  },
  dateInputPlaceholder: {
    fontSize: 14,
    color: "#9ca3af",
    marginLeft: 8,
    flex: 1,
  },
  quickPresetsLabel: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 6,
    marginBottom: 8,
  },
  timeSlotsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  timeSlotCard: {
    width: "47.5%",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    minHeight: 60,
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
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  timeSlotLabelSelected: {
    color: "#ffffff",
  },
  timeSlotTime: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 16,
  },
  timeSlotTimeSelected: {
    color: "#ffffff",
    opacity: 0.9,
  },
  exactTimeSection: {
    marginTop: 16,
  },
  exactTimeLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  exactTimeInput: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
  },
  exactTimeInputText: {
    fontSize: 14,
    color: "#9ca3af",
    marginLeft: 8,
    flex: 1,
  },
  exactTimeInputTextSelected: {
    fontSize: 14,
    color: "#111827",
    marginLeft: 8,
    flex: 1,
    fontWeight: "500",
  },
  travelModesGrid: {
    flexDirection: "row",
    gap: 6,
  },
  travelModeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  travelModeCardSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  travelModeLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  travelModeLabelSelected: {
    color: "#eb7825",
    fontWeight: "600",
  },
  constraintTypeContainer: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  constraintTypeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
  },
  constraintTypeButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  constraintTypeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  constraintTypeTextSelected: {
    color: "#ffffff",
  },
  constraintInputSection: {
    marginBottom: 16,
  },
  constraintInputLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 6,
  },
  constraintInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
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
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  quickOptionsLabel: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 6,
    marginBottom: 10,
  },
  quickOptionsContainer: {
    flexDirection: "row",
  },
  quickOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
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
    fontSize: 12,
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
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    width: "100%",
  },
  useLocationButtonText: {
    color: "#eb7825",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 8,
  },
  separator: {
    alignItems: "center",
    marginVertical: 12,
  },
  separatorText: {
    fontSize: 12,
    color: "#9ca3af",
    fontWeight: "400",
  },
  locationInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 6,
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
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  locationHelperContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  locationHelperText: {
    fontSize: 11,
    color: "#6b7280",
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestionTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  suggestionText: {
    fontSize: 13,
    color: "#111827",
    fontWeight: "500",
  },
  suggestionSubtext: {
    fontSize: 11,
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
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  footerButtonsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  applyButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  resetButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#d1d5db",
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
    fontSize: 14,
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
