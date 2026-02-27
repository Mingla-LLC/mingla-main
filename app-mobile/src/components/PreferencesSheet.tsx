import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
import {
  geocodingService,
  AutocompleteSuggestion,
} from "../services/geocodingService";
import { Calendar } from "./ui/calendar";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrencySymbol, formatNumberWithCommas } from "../utils/currency";
import { getRate } from "../services/currencyService";

interface PreferencesSheetProps {
  visible?: boolean;
  onClose?: () => void;
  onSave?: (preferences: any) => Promise<boolean> | boolean | void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  // Collaboration mode props - when provided, loads/saves from board_session_preferences
  sessionId?: string;
  sessionName?: string;
}

// Experience Types matching the image - using exact icons from IntentSelectionStep
const experienceTypes = [
  { id: "solo-adventure", label: "Solo Adventure", icon: "star-outline" },
  { id: "first-dates", label: "First Date", icon: "heart-outline" },
  { id: "romantic", label: "Romantic", icon: "heart-outline" },
  { id: "friendly", label: "Friendly", icon: "people-outline" },
  { id: "group-fun", label: "Group Fun", icon: "people-outline" },
  { id: "business", label: "Business", icon: "briefcase-outline" },
];

// Budget presets
const budgetPresets = [
  { label: "Up to $100", max: 100 },
  { label: "Up to $200", max: 200 },
  { label: "Up to $500", max: 500 },
];

// Categories with exact icons from image
const categories = [
  { id: "Stroll", label: "Take a Stroll", icon: "eye-outline" },
  { id: "Sip & Chill", label: "Sip & Chill", icon: "cafe-outline" },
  { id: "Casual Eats", label: "Casual Eats", icon: "restaurant-outline" },
  { id: "screenRelax", label: "Screen & Relax", icon: "desktop-outline" },
  {
    id: "Creative & Hands-On",
    label: "Creative & Hands-On",
    icon: "color-palette-outline",
  },
  { id: "Picnics", label: "Picnics", icon: "basket-outline" },
  { id: "Play & Move", label: "Play & Move", icon: "game-controller-outline" },
  {
    id: "Dining Experiences",
    label: "Dining Experiences",
    icon: "restaurant-outline",
  },
  { id: "Wellness Dates", label: "Wellness Dates", icon: "leaf-outline" },
  { id: "Freestyle", label: "Freestyle", icon: "sparkles-outline" },
];

// Travel modes matching database constraint
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

// Compatibility matrix: maps intent IDs to allowed category IDs
// null means all categories are allowed
const INTENT_CATEGORY_COMPATIBILITY: Record<string, string[] | null> = {
  "solo-adventure": null, // All categories
  "first-dates": [
    "Stroll",
    "Sip & Chill",
    "Picnics",
    "screenRelax",
    "Creative & Hands-On",
    "Play & Move",
    "Dining Experiences",
  ],
  romantic: ["Sip & Chill", "Picnics", "Dining Experiences", "Wellness Dates"],
  friendly: null, // All categories
  "group-fun": [
    "Play & Move",
    "Creative & Hands-On",
    "Casual Eats",
    "screenRelax",
    "Freestyle",
  ],
  business: ["Stroll", "Sip & Chill", "Dining Experiences"],
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

  // Collaboration mode: when sessionId is provided, use board session preferences
  const isCollaborationMode = !!sessionId;
  const {
    preferences: boardPreferences,
    updatePreferences: updateBoardPreferences,
    loading: loadingBoardPreferences,
  } = useBoardSession(sessionId);

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
  const [isLoading, setIsLoading] = useState(true);
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
   * 
   * This function:
   * 1. Gets the field's absolute screen position
   * 2. Accounts for current scroll offset and modal positioning
   * 3. Calculates exact scroll to position field just above keyboard
   * 4. Scrolls smoothly to that position
   */
  const scrollToField = useCallback((fieldRef: React.RefObject<View | null>) => {
    if (!fieldRef.current || !scrollViewRef.current) return;

    // Wait for keyboard animation to complete and layout to settle
    setTimeout(() => {
      const kbH = kbHeightRef.current;
      if (kbH === 0) return; // keyboard not visible yet
      
      try {
        // Get the ScrollView's absolute position on screen
        (scrollViewRef.current as any).measureInWindow((svX: number, svY: number, svW: number, svH: number) => {
          // Get the field's absolute position on screen
          (fieldRef.current as any).measureInWindow((fX: number, fY: number, fW: number, fH: number) => {
            const { height: screenHeight } = Dimensions.get('window');
            
            // The field's position relative to the ScrollView's top
            // svY is where the scroll view starts on screen
            // fY is where the field starts on screen
            const fieldYRelativeToScrollView = fY - svY;
            
            // Field's bottom position relative to scroll view top
            const fieldBottomRelativeToScrollView = fieldYRelativeToScrollView + fH;
            
            // Available height in scroll view (excluding keyboard)
            const keyboardStartOnScreen = screenHeight - kbH;
            const scrollViewBottomOnScreen = svY + svH;
            const visibleHeightOfScrollView = Math.min(svH, keyboardStartOnScreen - svY);
            
            // Bottom offset for nav bar clearance
            const BOTTOM_OFFSET = 48;
            
            // Where we want the field's bottom to appear in the visible area
            // 30px above where keyboard starts, accounting for bottom offset
            const targetFieldBottomPosition = visibleHeightOfScrollView - BOTTOM_OFFSET - 30;
            
            // How much is the field extending below the target position?
            const overshoot = fieldBottomRelativeToScrollView - targetFieldBottomPosition;
            
            // If field is below target, scroll up
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
    }, 350); // wait for keyboard animation + layout shifts
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

  // Load existing preferences from database (solo mode only)
  useEffect(() => {
    // Skip solo loading when in collaboration mode
    if (isCollaborationMode) return;

    const loadPreferences = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }

      try {
        const prefs = await PreferencesService.getUserPreferences(user.id);
        if (prefs) {
          // Load budget
          setBudgetMin(prefs.budget_min || 0);
          setBudgetMax(prefs.budget_max || 200);

          // Load categories and intents
          // Intents are stored as IDs in the categories array: "solo-adventure", "first-dates", "romantic", "friendly", "group-fun", "business"
          // Vibe categories are stored as names: "Stroll", "Sip & Chill", etc.
          if (prefs.categories && Array.isArray(prefs.categories)) {
            const intentIds = new Set([
              "solo-adventure",
              "first-dates",
              "romantic",
              "friendly",
              "group-fun",
              "business",
            ]);

            // Extract intents (IDs) and categories (names) separately
            const loadedIntents: string[] = [];
            const loadedCategories: string[] = [];

            prefs.categories.forEach((item: string) => {
              if (intentIds.has(item)) {
                loadedIntents.push(item);
              } else {
                loadedCategories.push(item);
              }
            });

            setSelectedIntents(loadedIntents);
            setSelectedCategories(loadedCategories);
          }

          // Load travel mode
          if (prefs.travel_mode) {
            setTravelMode(prefs.travel_mode);
          }

          // Load travel constraint
          if (prefs.travel_constraint_type) {
            setConstraintType(
              prefs.travel_constraint_type as "time" | "distance"
            );
          }
          if (prefs.travel_constraint_value) {
            setConstraintValue(prefs.travel_constraint_value);
          }

          // Load date/time preferences
          if (prefs.date_option) {
            // Map database values to UI values
            const dateOptionMap: { [key: string]: DateOption } = {
              now: "Now",
              today: "Today",
              weekend: "This Weekend",
              custom: "Pick a Date",
            };
            const mappedOption = dateOptionMap[prefs.date_option] || "Now";
            setSelectedDateOption(mappedOption as DateOption);
          }

          if ((prefs as any).time_slot) {
            const timeSlot = (prefs as any).time_slot;
            if (
              ["brunch", "afternoon", "dinner", "lateNight"].includes(timeSlot)
            ) {
              setSelectedTimeSlot(timeSlot as TimeSlot);
            }
          }

          if ((prefs as any).exact_time) {
            setExactTime((prefs as any).exact_time);
          }

          if (prefs.datetime_pref) {
            const date = new Date(prefs.datetime_pref);
            if (!isNaN(date.getTime())) {
              setSelectedDate(date);
            }
          }

          // Load location preferences from custom_location
          if ((prefs as any).custom_location) {
            const savedLocation = (prefs as any).custom_location;
            setSearchLocation(savedLocation);

            // Determine if it's GPS (coordinates format) or search (city name)
            // GPS coordinates typically look like "37.7749, -122.4194"
            const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(
              savedLocation
            );
            if (isCoordinates) {
              // It's coordinates, likely from GPS
              setUseLocation("gps");
            } else {
              // It's a city name or address, likely from search
              setUseLocation("search");
            }
          }

          // Store initial preferences for change tracking
          setInitialPreferences({
            selectedIntents: prefs.categories?.filter((item: string) =>
              ["solo-adventure", "first-dates", "romantic", "friendly", "group-fun", "business"].includes(item)
            ) || [],
            budgetMin: prefs.budget_min || 0,
            budgetMax: prefs.budget_max || 200,
            selectedCategories: prefs.categories?.filter((item: string) =>
              !["solo-adventure", "first-dates", "romantic", "friendly", "group-fun", "business"].includes(item)
            ) || [],
            selectedDateOption: prefs.date_option ? { now: "Now", today: "Today", weekend: "This Weekend", custom: "Pick a Date" }[prefs.date_option] || "Now" : "Now",
            selectedTimeSlot: (prefs as any).time_slot || null,
            selectedDate: prefs.datetime_pref ? new Date(prefs.datetime_pref) : null,
            exactTime: (prefs as any).exact_time || "",
            travelMode: prefs.travel_mode || "walking",
            constraintType: (prefs.travel_constraint_type || "time") as "time" | "distance",
            constraintValue: prefs.travel_constraint_value || 20,
            searchLocation: (prefs as any).custom_location || "",
          });
        } else {
          // No preferences saved, use defaults
          setInitialPreferences({ ...defaultPreferences });
        }
      } catch (error) {
        console.error("Error loading preferences:", error);
        setInitialPreferences({ ...defaultPreferences });
      } finally {
        setIsLoading(false);
      }
    };

    loadPreferences();
  }, [user?.id, isCollaborationMode]);

  // Load preferences from board session (collaboration mode)
  useEffect(() => {
    if (!isCollaborationMode) return;

    if (boardPreferences) {
      // Map board session preferences to component state
      if (boardPreferences.experience_types) {
        setSelectedIntents(boardPreferences.experience_types);
      }
      if (boardPreferences.categories) {
        setSelectedCategories(boardPreferences.categories);
      }
      if ((boardPreferences as any).budget_min !== undefined) {
        setBudgetMin((boardPreferences as any).budget_min);
      }
      if ((boardPreferences as any).budget_max !== undefined) {
        setBudgetMax((boardPreferences as any).budget_max);
      }
      if ((boardPreferences as any).travel_mode) {
        setTravelMode((boardPreferences as any).travel_mode);
      }
      if ((boardPreferences as any).travel_constraint_type) {
        setConstraintType(
          (boardPreferences as any).travel_constraint_type as "time" | "distance"
        );
      }
      if ((boardPreferences as any).travel_constraint_value !== undefined) {
        setConstraintValue((boardPreferences as any).travel_constraint_value);
      }
      if ((boardPreferences as any).time_of_day) {
        const timeSlot = (boardPreferences as any).time_of_day;
        if (["brunch", "afternoon", "dinner", "lateNight"].includes(timeSlot)) {
          setSelectedTimeSlot(timeSlot as TimeSlot);
        }
      }
      if ((boardPreferences as any).datetime_pref) {
        const date = new Date((boardPreferences as any).datetime_pref);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
        }
      }
      // Load location preferences from location column
      if ((boardPreferences as any).location) {
        const savedLocation = (boardPreferences as any).location;
        setSearchLocation(savedLocation);

        const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(savedLocation);
        if (isCoordinates) {
          setUseLocation("gps");
        } else {
          setUseLocation("search");
        }
      }

      setInitialPreferences({
        selectedIntents: boardPreferences.experience_types || [],
        budgetMin: (boardPreferences as any).budget_min || 0,
        budgetMax: (boardPreferences as any).budget_max || 200,
        selectedCategories: boardPreferences.categories || [],
        selectedDateOption: "Now",
        selectedTimeSlot: (boardPreferences as any).time_of_day || null,
        selectedDate: (boardPreferences as any).datetime_pref ? new Date((boardPreferences as any).datetime_pref) : null,
        exactTime: "",
        travelMode: (boardPreferences as any).travel_mode || "walking",
        constraintType: ((boardPreferences as any).travel_constraint_type || "time") as "time" | "distance",
        constraintValue: (boardPreferences as any).travel_constraint_value || 20,
        searchLocation: (boardPreferences as any).location || "",
      });

      setIsLoading(false);
    } else if (!loadingBoardPreferences) {
      setInitialPreferences({ ...defaultPreferences });
      setIsLoading(false);
    }
  }, [isCollaborationMode, boardPreferences, loadingBoardPreferences]);

  // Filter categories based on selected intents
  const filteredCategories = useMemo(() => {
    const allowedIds = getAllowedCategoryIds(selectedIntents);
    if (allowedIds === null) {
      // All categories allowed
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

  const handleIntentToggle = (id: string) => {
    setSelectedIntents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCategoryToggle = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const setBudgetPreset = (max: number) => {
    setBudgetMin(0);
    setBudgetMax(max);
  };

  const handleDateOptionSelect = (option: DateOption) => {
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
  };

  const handleTimeSlotSelect = (slot: TimeSlot) => {
    setSelectedTimeSlot(slot);
    setExactTime("");
  };

  const formatTimeForDisplay = (date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const hours12 = hours % 12 || 12;
    const minutesStr = String(minutes).padStart(2, "0");
    return `${hours12}:${minutesStr} ${ampm}`;
  };

  const handleTimePickerChange = (event: any, selectedDate?: Date) => {
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
  };

  const handleTimePickerConfirm = () => {
    setShowTimePicker(false);
    const formattedTime = formatTimeForDisplay(selectedTime);
    setExactTime(formattedTime);
    setSelectedTimeSlot(null);
  };

  const handleCalendarDateSelect = (date: Date) => {
    setSelectedDate(date);
    setShowCalendar(false);
  };

  const formatDateForDisplay = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const getWeekendDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilSaturday = dayOfWeek === 0 ? 6 : 6 - dayOfWeek;
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;

    const saturday = new Date(today);
    saturday.setDate(today.getDate() + daysUntilSaturday);
    saturday.setHours(0, 0, 0, 0);

    const sunday = new Date(today);
    sunday.setDate(today.getDate() + daysUntilSunday);
    sunday.setHours(0, 0, 0, 0);

    return { saturday, sunday };
  };

  const handleUseCurrentLocation = async () => {
    setIsRequestingLocation(true);
    try {
      // Request permissions first - this will show the system permission dialog if not granted
      const hasPermission = await locationService.requestPermissions();

      // Even if permissions are granted, try to get location
      // This might trigger a system prompt if location services are disabled
      const locationData = await locationService.getCurrentLocation();
      if (locationData) {
        // Reverse geocode to get city name
        const cityName = await locationService.reverseGeocode(
          locationData.latitude,
          locationData.longitude
        );
        if (cityName) {
          setSearchLocation(cityName);
          setUseLocation("gps");
        } else {
          // If reverse geocode fails, use coordinates as fallback
          setSearchLocation(
            `${locationData.latitude.toFixed(
              4
            )}, ${locationData.longitude.toFixed(4)}`
          );
          setUseLocation("gps");
        }
      } else {
        // Location couldn't be retrieved - check if location services are enabled
        const Location = await import("expo-location");
        const isEnabled = await Location.hasServicesEnabledAsync();
        const { status } = await Location.getForegroundPermissionsAsync();

        if (status !== "granted") {
          // Permission not granted - request again to show system dialog
          console.log("Permission not granted, requesting again...");
          await locationService.requestPermissions();
        } else if (!isEnabled) {
          // Permissions granted but location services are disabled
          // On Android, we can't show a system dialog to enable location services
          // But we can check if we should request permissions again (which might trigger system prompts)
          // Or guide user to enable location services
          console.log(
            "Location services disabled - permissions are granted but services are off"
          );
          // Try requesting permissions again - on some Android versions this might trigger a system prompt
          // to enable location services
          await locationService.requestPermissions();
        }
        // If permission is granted and services are enabled but location is still null,
        // it's likely a GPS/network issue - user can try again or enter manually
      }
    } catch (error: any) {
      // Suppress location service errors - they're handled above
      const errorMessage = error?.message || String(error) || "";
      const errorString = String(error);
      const isLocationServiceError =
        errorMessage.includes("location services") ||
        errorMessage.includes("unavailable") ||
        errorMessage.includes("Current location is unavailable") ||
        errorString.includes("location services") ||
        errorString.includes("unavailable");

      if (!isLocationServiceError) {
        // Only log unexpected errors
        console.error("Error getting current location:", error);
        Alert.alert(
          "Error",
          "An error occurred while getting your location. Please try again.",
          [{ text: "OK" }]
        );
      }
    } finally {
      setIsRequestingLocation(false);
    }
  };

  // Handle location input change with autocomplete
  const handleLocationInputChange = (text: string) => {
    setSearchLocation(text);

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

  // Count the number of changes from initial preferences
  const countChanges = (): number => {
    if (!initialPreferences) return 0;

    let changes = 0;

    // Compare arrays
    const arraysEqual = (a: any[], b: any[]) => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    if (!arraysEqual(selectedIntents, initialPreferences.selectedIntents)) changes++;
    if (budgetMin !== initialPreferences.budgetMin) changes++;
    if (budgetMax !== initialPreferences.budgetMax) changes++;
    if (!arraysEqual(selectedCategories, initialPreferences.selectedCategories)) changes++;
    if (selectedDateOption !== initialPreferences.selectedDateOption) changes++;
    if (selectedTimeSlot !== initialPreferences.selectedTimeSlot) changes++;
    if (exactTime !== initialPreferences.exactTime) changes++;
    
    // Compare dates
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
  };

  // Reset all preferences to defaults
  const handleReset = () => {
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
  };

  const handleApplyPreferences = async () => {
    if (isSaving) return;

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
    };

    setIsSaving(true);
    try {
      // Collaboration mode: save to board_session_preferences via useBoardSession
      if (isCollaborationMode) {
        const dbPrefs: any = {
          categories: selectedCategories,
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

        // Update offline cache
        try {
          if (user?.id && searchLocation) {
            const updatedPrefs = await PreferencesService.getUserPreferences(user.id);
            if (updatedPrefs) {
              await offlineService.cacheUserPreferences(updatedPrefs);
            }
          }
        } catch (error) {
          console.error("Error updating offline cache:", error);
        }

        // Invalidate caches
        queryClient.invalidateQueries({ queryKey: ["recommendations"] });
        queryClient.invalidateQueries({ queryKey: ["userLocation"] });

        // Call onSave callback for backward compatibility
        if (onSave) {
          await Promise.resolve(onSave(preferences));
        }

        if (onClose) onClose();
      } else {
        // Solo mode: original behavior
        if (!onSave) {
          if (onClose) onClose();
          return;
        }

        const saveResult = await Promise.resolve(onSave(preferences));

        // Update offline cache with new preferences before invalidating
        try {
          if (user?.id) {
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
        queryClient.invalidateQueries({ queryKey: ["recommendations"] });
        queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
        queryClient.invalidateQueries({ queryKey: ["userLocation"] });

        if (saveResult === true || saveResult === undefined) {
          if (onClose) onClose();
        }
      }
    } catch (error) {
      console.error("Error saving preferences:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const sheetContent = (
    <>  
      <SafeAreaView style={styles.container} edges={[]}>
        <StatusBar barStyle="dark-content" />
        {/* Header */}
        <View style={styles.header}>
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={20} color="#6b7280" />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          {isCollaborationMode && sessionName ? (
            <Text style={styles.subtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              Preferences for {sessionName}
            </Text>
          ) : (
            <Text style={styles.title}>Solo Preferences</Text>
          )}
        </View>
          {onClose && <View style={styles.headerSpacer} />}
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
          <View style={[styles.section, {marginTop: 20}]}>
            <Text style={styles.sectionTitle}>Experience Type</Text>
            <Text style={styles.sectionSubtitle}>
              Date Idea / Friends / Romantic / Solo Adventure
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
                      size={14}
                      color={isSelected ? "#ffffff" : "#6b7280"}
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
                      size={16}
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
          </View>

          {/* Maximum Budget per Person Section - Hide when only "Take a Stroll" is selected */}
          {!(
            selectedCategories.length === 1 &&
            selectedCategories[0] === "Stroll"
          ) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Maximum Budget per Person</Text>
              <Text style={styles.sectionSubtitle}>
                What's the most you want to spend?
              </Text>
              <View style={styles.budgetInputContainer} ref={budgetInputContainerRef}>
                <Text style={styles.dollarSign}>{getCurrencySymbol(accountPreferences?.currency || 'USD')}</Text>
                <TextInput
                  value={budgetMax?.toString() || ""}
                  onChangeText={(text) => {
                    setBudgetMax(text ? Number(text) : "");
                    setBudgetMin(0);
                  }}
                  onFocus={() => scrollToField(budgetInputContainerRef)}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                  placeholder="Enter maximum amount"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              <View style={styles.budgetPresetsContainer}>
                {budgetPresets.map((preset) => {
                  const currencyCode = accountPreferences?.currency || 'USD';
                  const symbol = getCurrencySymbol(currencyCode);
                  const rate = getRate(currencyCode);
                  const convertedMax = Math.round(preset.max * rate);
                  const label = `Up to ${symbol}${formatNumberWithCommas(convertedMax)}`;
                  return (
                    <TouchableOpacity
                      key={preset.label}
                      onPress={() => setBudgetPreset(convertedMax)}
                      style={styles.budgetPresetButton}
                    >
                      <Text style={styles.budgetPresetText}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

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

            {/* Weekend Info Card (only for "This Weekend") - matching DateTimePrefStep */}
            {selectedDateOption === "This Weekend" && (
              <TouchableOpacity style={styles.weekendInfoCard}>
                <Ionicons
                  name="calendar"
                  size={20}
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

            {/* Calendar for "Pick a Date" - matching DateTimePrefStep */}
            {selectedDateOption === "Pick a Date" && (
              <TouchableOpacity
                style={styles.dateInputField}
                onPress={() => setShowCalendar(true)}
              >
                <Ionicons name="calendar" size={16} color="#eb7825" />
                {selectedDate ? (
                  <Text style={styles.dateInputText}>
                    {formatDateForDisplay(selectedDate)}
                  </Text>
                ) : (
                  <Text style={styles.dateInputPlaceholder}>mm/dd/yyyy</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Time Picker Section (shown for "Today", "This Weekend", and "Pick a Date") */}
            {selectedDateOption && selectedDateOption !== "Now" ? (
              <View style={styles.exactTimeSection}>
                <Text style={styles.exactTimeLabel}>Select Time</Text>
                <TouchableOpacity
                  style={styles.exactTimeInput}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Ionicons
                    name="time-outline"
                    size={16}
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
            ) : null}
          </View>

          {/* Travel Mode Section */
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
                      size={20}
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
          }
          {/* Travel Limit Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderWithBadge}>
              <Text style={styles.sectionTitle}>Travel Limit</Text>
              <View style={styles.requiredBadge}>
                <Text style={styles.requiredBadgeText}>Required</Text>
              </View>
            </View>
            <Text style={styles.sectionQuestion}>
              How far are you willing to travel?
            </Text>
            <View style={styles.constraintTypeContainer}>
              <TouchableOpacity
                onPress={() => setConstraintType("time")}
                style={[
                  styles.constraintTypeButton,
                  constraintType === "time" &&
                    styles.constraintTypeButtonSelected,
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={constraintType === "time" ? "#ffffff" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.constraintTypeText,
                    constraintType === "time" &&
                      styles.constraintTypeTextSelected,
                  ]}
                >
                  By Time
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConstraintType("distance")}
                style={[
                  styles.constraintTypeButton,
                  constraintType === "distance" &&
                    styles.constraintTypeButtonSelected,
                ]}
              >
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={constraintType === "distance" ? "#ffffff" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.constraintTypeText,
                    constraintType === "distance" &&
                      styles.constraintTypeTextSelected,
                  ]}
                >
                  By Distance
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.constraintInputSection}>
              <Text style={styles.constraintInputLabel}>
                {constraintType === "time"
                  ? "Maximum travel time (minutes)"
                  : `Maximum travel distance (${accountPreferences?.measurementSystem === "Metric" ? "km" : "miles"})`}
              </Text>
              <View
                style={[
                  styles.constraintInputContainer,
                  false && styles.constraintInputContainerFocused,
                ]}
                ref={constraintInputContainerRef}
              >
                <Ionicons
                  name={
                    constraintType === "time"
                      ? "time-outline"
                      : "paper-plane-outline"
                  }
                  size={16}
                  color="#6b7280"
                  style={styles.constraintInputIcon}
                />
                <TextInput
                  value={constraintValue?.toString() || ""}
                  onChangeText={(text) => {
                    const numericValue = text.replace(/[^0-9]/g, "");
                    setConstraintValue(
                      numericValue ? Number(numericValue) : ""
                    );
                  }}
                  onFocus={() => scrollToField(constraintInputContainerRef)}
                  keyboardType="numeric"
                  style={styles.constraintInput}
                  placeholder={constraintType === "time" ? "e.g. 20" : (accountPreferences?.measurementSystem === "Metric" ? "e.g. 5" : "e.g. 3")}
                />
              </View>
            </View>
          </View>

          {/* Starting Location Section - matching LocationSetupStep exactly */}
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
              We're using your current location. Search below to change it.
            </Text>

            {/* Location Input Field */}
            <View
              style={[
                styles.locationInputContainer,
                isInputFocused && styles.locationInputContainerFocused,
              ]}
              ref={locationInputContainerRef}
            >
              <Ionicons
                name="location"
                size={16}
                color="#6b7280"
                style={styles.locationInputIcon}
              />
              <TextInput
                style={styles.locationTextInput}
                placeholder="Search to change your starting location..."
                placeholderTextColor="#9ca3af"
                value={searchLocation}
                onChangeText={handleLocationInputChange}
                onFocus={() => {
                  setIsInputFocused(true);
                  if (suggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                  scrollToField(locationInputContainerRef);
                }}
                onBlur={handleInputBlur}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            {/* Helper text */}
            <View style={styles.locationHelperContainer}>
              <Ionicons name="information-circle-outline" size={14} color="#6b7280" />
              <Text style={styles.locationHelperText}>
                Type to search Google Maps locations
              </Text>
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
                          size={16}
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
              <TouchableOpacity
                onPress={() => setShowCalendar(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={20} color="#111827" />
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
              <Pressable
                style={styles.backdropTouch}
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
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#eb7825" />
              </View>
            ) : (
              sheetContent
            )}
          </View>
        </View>
      </Modal>
    );
  }

  // Legacy inline rendering (full-screen)
  if (isLoading) {
    return (
      <View style={styles.overlayContainer}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
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
  closeButton: {
    padding: 8,
    marginLeft: -8,
    marginBottom: -8,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  titleContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    marginHorizontal: 12,
    paddingBottom: 0,
  },
  headerSpacer: {
    width: 40,
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
    flexDirection: "column",
    gap: 8,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "white",
    minWidth: "47%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  categoryButtonSelected: {
    backgroundColor: "#fef3e2",
    shadowColor: "#eb7825",
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  categoryText: {
    fontSize: 12,
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
    gap: 10,
    marginBottom: 12,
  },
  dateOptionCard: {
    width: "47.5%",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    minHeight: 60,
    justifyContent: "center",
  },
  dateOptionCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  dateOptionContent: {
    alignItems: "center",
  },
  dateOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  dateOptionLabelSelected: {
    color: "#ffffff",
  },
  dateOptionDescription: {
    fontSize: 11,
    color: "#6b7280",
  },
  dateOptionDescriptionSelected: {
    color: "#ffffff",
    opacity: 0.9,
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
    flexWrap: "wrap",
    gap: 10,
  },
  travelModeCard: {
    width: "47%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  travelModeCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  travelModeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  travelModeLabelSelected: {
    color: "#ffffff",
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
