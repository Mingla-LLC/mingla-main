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
  Animated,
  Easing,
  AccessibilityInfo,
  Switch,
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
import { enhancedLocationService } from '../services/enhancedLocationService';
import { logAppsFlyerEvent } from "../services/appsFlyerService";
import { useBoardSession } from "../hooks/useBoardSession";
import { usePreferencesData } from "../hooks/usePreferencesData";
import {
  geocodingService,
  AutocompleteSuggestion,
} from "../services/geocodingService";
import { useQueryClient } from "@tanstack/react-query";
import { mixpanelService } from "../services/mixpanelService";
import { useAppStore } from "../store/appStore";
import { normalizePreferencesForSave } from "../utils/preferencesConverter";
import { toastManager } from "./ui/Toast";
import { useTranslation } from 'react-i18next';

import {
  ExperienceTypesSection,
  CategoriesSection,
  TravelModeSection,
  LoadingShimmer,
} from "./PreferencesSheet/PreferencesSections";
import {
  TravelLimitSection,
  LocationInputSection,
} from "./PreferencesSheet/PreferencesSectionsAdvanced";
import { WhenSection, DateOptionId } from './PreferencesSheet/WhenSection';
import { ToggleSection } from './PreferencesSheet/ToggleSection';
import { useFeatureGate } from '../hooks/useFeatureGate';
import { CustomPaywallScreen } from './CustomPaywallScreen';
import type { GatedFeature } from '../hooks/useFeatureGate';
// ORCH-0437: Leaderboard settings — saves via useMapSettings, NOT via onSave
import { useMapSettings } from '../hooks/useMapSettings';
import { leaderboardService } from '../services/leaderboardService';
import type { VisibilityLevel } from '../types/leaderboard';
import { normalizeCategoryArray } from '../utils/categoryUtils';
import { colors } from '../constants/designSystem';

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
// Ordered for visual compactness — short labels paired on same row
const experienceTypes = [
  { id: "romantic",      label: "Romantic",       icon: "heart" },
  { id: "first-date",    label: "First Date",    icon: "sparkles" },
  { id: "group-fun",     label: "Group Fun",      icon: "people" },
  { id: "adventurous",   label: "Adventurous",   icon: "compass-outline" },
  { id: "picnic-dates",  label: "Picnic Dates",   icon: "sandwich" },
  { id: "take-a-stroll", label: "Take a Stroll",  icon: "walk-outline" },
];

// ORCH-0434: 8 categories — ordered for visual compactness (short labels paired)
const categories = [
  { id: 'play',                label: 'Play',                   icon: 'game-controller-outline' },
  { id: 'icebreakers',         label: 'Icebreakers',            icon: 'sparkles' },
  { id: 'nature',              label: 'Nature & Views',         icon: 'trees' },
  { id: 'drinks_and_music',    label: 'Drinks & Music',         icon: 'wine-outline' },
  { id: 'creative_arts',       label: 'Creative & Arts',        icon: 'color-palette-outline' },
  { id: 'movies_theatre',      label: 'Movies & Theatre',       icon: 'film-new' },
  { id: 'brunch_lunch_casual', label: 'Brunch, Lunch & Casual', icon: 'utensils-crossed' },
  { id: 'upscale_fine_dining', label: 'Upscale & Fine Dining',  icon: 'chef-hat' },
];

// Travel modes matching database constraint
const travelModes = [
  { id: "walking", label: "Walk", icon: "walk-outline" },
  { id: "biking", label: "Bike", icon: "bicycle-outline" },
  { id: "transit", label: "Bus", icon: "bus-outline" },
  { id: "driving", label: "Drive", icon: "car-outline" },
];

// ORCH-0434: Date option mappings (DB ↔ UI)
const DATE_OPTION_TO_DB: Record<DateOptionId, string> = {
  today: 'today',
  this_weekend: 'this_weekend',
  pick_dates: 'pick_dates',
};

const DB_TO_DATE_OPTION: Record<string, DateOptionId> = {
  today: 'today',
  this_weekend: 'this_weekend',
  pick_dates: 'pick_dates',
  // Legacy compat
  now: 'today',
  'this-weekend': 'this_weekend',
  weekend: 'this_weekend',
  'pick-a-date': 'pick_dates',
  custom: 'pick_dates',
};

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
  const { t } = useTranslation(['common', 'preferences']);

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

  // Toggle states
  const [intentToggle, setIntentToggle] = useState<boolean>(true);
  const [categoryToggle, setCategoryToggle] = useState<boolean>(true);

  // Categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Refs for synchronous access in toggle callbacks (avoids stale closure bug)
  const selectedIntentsRef = useRef(selectedIntents);
  selectedIntentsRef.current = selectedIntents;
  const selectedCategoriesRef = useRef(selectedCategories);
  selectedCategoriesRef.current = selectedCategories;

  // Selection limit messages
  const [minSelectionMessage, setMinSelectionMessage] = useState(false);

  // Date & Time — ORCH-0434: simplified to 3 options + multi-day calendar
  const [selectedDateOption, setSelectedDateOption] =
    useState<DateOptionId | null>('today');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Travel Mode
  const [travelMode, setTravelMode] = useState<string>("walking");

  // Travel Limit
  const constraintType = 'time' as const;
  const [constraintValue, setConstraintValue] = useState<number | "">(30);

  // ORCH-0437: Leaderboard settings (saved via useMapSettings, NOT via onSave)
  const { settings: mapSettings, updateSettings: updateMapSettings } = useMapSettings();
  const [isDiscoverable, setIsDiscoverable] = useState(false);
  const [leaderboardVisibility, setLeaderboardVisibility] = useState<VisibilityLevel>('friends');
  const [leaderboardStatus, setLeaderboardStatus] = useState<string | null>(null);
  const [availableSeats, setAvailableSeats] = useState(1);
  const [customStatusText, setCustomStatusText] = useState('');

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
  const scrollRef = useRef<any>(null);

  // Sequential section stagger animation (ORCH-0434 Phase 6B)
  const [reduceMotion, setReduceMotion] = useState(false);
  const sectionAnims = useRef(
    Array.from({ length: 7 }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (visible && !preferencesLoading) {
      if (reduceMotion) {
        sectionAnims.forEach(anim => anim.setValue(1));
        return;
      }
      // Reset
      sectionAnims.forEach(anim => anim.setValue(0));
      // Stagger: 80ms between each section, 300ms duration
      const delays = [0, 70, 140, 210, 280, 350, 420];
      const timers = delays.map((delay, i) =>
        setTimeout(() => {
          Animated.timing(sectionAnims[i], {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }, delay)
      );
      return () => timers.forEach(clearTimeout);
    } else if (!visible) {
      sectionAnims.forEach(anim => anim.setValue(0));
    }
  }, [visible, preferencesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track initial preferences for change detection
  const [initialPreferences, setInitialPreferences] = useState<any>(null);

  // Default preferences — ORCH-0434: no budget/time slots
  const defaultPreferences = {
    selectedIntents: [] as string[],
    selectedCategories: [] as string[],
    selectedDateOption: 'today' as DateOptionId,
    selectedDates: [] as string[],
    selectedDate: null as Date | null,
    travelMode: 'driving',
    constraintType: 'time' as const,
    constraintValue: 75,
    searchLocation: '',
    intentToggle: true,
    categoryToggle: true,
  };

  // Initialize state from loaded preferences
  useEffect(() => {
    if (!loadedPreferences || preferencesLoading || !visible) {
      return;
    }

    if (isCollaborationMode) {
      // Narrow type: in collab mode, preferences come from BoardSessionPreferences
      const prefs = loadedPreferences as import('../hooks/useBoardSession').BoardSessionPreferences;
      // Load from board session preferences — intents and categories are separate DB columns
      const collabIntents = Array.isArray(prefs.intents) ? prefs.intents : [];
      setSelectedIntents(collabIntents);
      const collabCats = normalizeCategoryArray(
        Array.isArray(prefs.categories) ? prefs.categories : []
      );
      setSelectedCategories(collabCats);
      if (prefs.travel_mode) {
        setTravelMode(prefs.travel_mode);
      }
      // travel_constraint_type is always 'time' — no need to load from DB
      if (prefs.travel_constraint_value !== undefined) {
        setConstraintValue(prefs.travel_constraint_value);
      }
      // Load toggle states
      setIntentToggle(typeof prefs.intent_toggle === 'boolean' ? prefs.intent_toggle : true);
      setCategoryToggle(typeof prefs.category_toggle === 'boolean' ? prefs.category_toggle : true);
      // Load date_option — handle legacy values (ORCH-0434)
      let loadedDateOption: DateOptionId = 'today';
      if (prefs.date_option) {
        loadedDateOption = DB_TO_DATE_OPTION[prefs.date_option] || 'today';
        setSelectedDateOption(loadedDateOption);
      }
      // Load selected dates (multi-day calendar)
      const loadedDates = Array.isArray(prefs.selected_dates) ? prefs.selected_dates : [];
      setSelectedDates(loadedDates);
      if (prefs.datetime_pref) {
        const date = new Date(prefs.datetime_pref);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
        }
      }
      // Load location: prefer structured use_gps_location flag, fall back to heuristic (ORCH-0319)
      if (typeof prefs.use_gps_location === 'boolean') {
        const isGps = prefs.use_gps_location;
        setUseGpsLocation(isGps);
        setUseLocation(isGps ? 'gps' : 'search');
        if (!isGps && prefs.custom_location) {
          setSearchLocation(prefs.custom_location);
        } else if (prefs.location) {
          setSearchLocation(prefs.location);
        }
      } else if (prefs.location) {
        // Legacy fallback: guess from location format
        const savedLocation = prefs.location;
        setSearchLocation(savedLocation);
        const isCoordinates = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(savedLocation);
        setUseLocation(isCoordinates ? 'gps' : 'search');
        setUseGpsLocation(isCoordinates);
      }
      // Restore saved coordinates (ORCH-0319)
      if (prefs.custom_lat != null && prefs.custom_lng != null) {
        setSelectedCoords({
          lat: prefs.custom_lat,
          lng: prefs.custom_lng,
        });
      }

      setInitialPreferences({
        selectedIntents: collabIntents,
        selectedCategories: collabCats,
        selectedDateOption: loadedDateOption,
        selectedDates: loadedDates,
        intentToggle: typeof prefs.intent_toggle === 'boolean' ? prefs.intent_toggle : true,
        categoryToggle: typeof prefs.category_toggle === 'boolean' ? prefs.category_toggle : true,
        selectedDate: prefs.datetime_pref
          ? new Date(prefs.datetime_pref)
          : null,
        travelMode: prefs.travel_mode || "walking",
        constraintType: 'time' as const,
        constraintValue: prefs.travel_constraint_value || 30,
        searchLocation: prefs.custom_location || prefs.location || "",
      });
    } else {
      // Load from solo preferences — intents and categories are separate DB columns
      const soloIntents = Array.isArray((loadedPreferences).intents) ? (loadedPreferences).intents : [];
      setSelectedIntents(soloIntents);
      const soloCats = normalizeCategoryArray(
        Array.isArray(loadedPreferences.categories) ? loadedPreferences.categories : []
      );
      setSelectedCategories(soloCats);

      if (loadedPreferences.travel_mode) {
        setTravelMode(loadedPreferences.travel_mode);
      }

      // travel_constraint_type is always 'time' — no need to load from DB
      if (loadedPreferences.travel_constraint_value !== undefined && loadedPreferences.travel_constraint_value !== null) {
        setConstraintValue(loadedPreferences.travel_constraint_value);
      }

      // Load toggle states
      setIntentToggle(typeof loadedPreferences.intent_toggle === 'boolean' ? loadedPreferences.intent_toggle : true);
      setCategoryToggle(typeof loadedPreferences.category_toggle === 'boolean' ? loadedPreferences.category_toggle : true);

      // Load date option — ORCH-0434: new 3-option system with legacy compat
      if (loadedPreferences.date_option) {
        setSelectedDateOption(DB_TO_DATE_OPTION[loadedPreferences.date_option] || 'today');
      }

      // Load selected dates (multi-day calendar)
      const soloLoadedDates = Array.isArray(loadedPreferences.selected_dates) ? loadedPreferences.selected_dates : [];
      setSelectedDates(soloLoadedDates);

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
        // Restore saved coordinates so they persist through re-saves
        // without requiring the user to re-select the address.
        if ((loadedPreferences).custom_lat != null && (loadedPreferences).custom_lng != null) {
          setSelectedCoords({
            lat: (loadedPreferences).custom_lat,
            lng: (loadedPreferences).custom_lng,
          });
        }
      }

      setInitialPreferences({
        selectedIntents: soloIntents,
        selectedCategories: soloCats,
        selectedDateOption: loadedPreferences.date_option
          ? DB_TO_DATE_OPTION[loadedPreferences.date_option] || 'today'
          : 'today',
        selectedDates: soloLoadedDates,
        intentToggle: typeof loadedPreferences.intent_toggle === 'boolean' ? loadedPreferences.intent_toggle : true,
        categoryToggle: typeof loadedPreferences.category_toggle === 'boolean' ? loadedPreferences.category_toggle : true,
        selectedDate: loadedPreferences.datetime_pref
          ? new Date(loadedPreferences.datetime_pref)
          : null,
        travelMode: loadedPreferences.travel_mode || "walking",
        constraintType: 'time' as const,
        constraintValue: loadedPreferences.travel_constraint_value || 30,
        searchLocation: (loadedPreferences).custom_location || "",
      });
    }
  }, [loadedPreferences, preferencesLoading, visible, isCollaborationMode]);

  // ORCH-0437: Load leaderboard settings from map settings (separate from deck preferences)
  useEffect(() => {
    if (!visible || !mapSettings) return;
    setIsDiscoverable(mapSettings.is_discoverable);
    setLeaderboardVisibility(mapSettings.visibility_level as VisibilityLevel);
    setLeaderboardStatus(mapSettings.activity_status);
    setAvailableSeats(mapSettings.available_seats);
    setCustomStatusText('');
  }, [visible, mapSettings]);

  // All categories always visible — curated pills are independent of category pills
  const filteredCategories = categories;

  // Memoized callbacks — side effects kept outside updater to stay StrictMode-safe
  const handleIntentToggle = useCallback((id: string) => {
    let blocked = false;
    setSelectedIntents((prev) => {
      if (prev.includes(id)) {
        // Can't deselect last one if categories section can't cover us
        const categoriesCanCover = categoryToggle && selectedCategoriesRef.current.length > 0;
        if (prev.length === 1 && !categoriesCanCover) {
          blocked = true;
          return prev;
        }
        return prev.filter(i => i !== id);
      }
      return [...prev, id];
    });
    if (blocked) {
      setMinSelectionMessage(true);
      setTimeout(() => setMinSelectionMessage(false), 2500);
    }
  }, [categoryToggle]);

  const handleCategoryToggle = useCallback((id: string) => {
    let blocked = false;
    setSelectedCategories((prev) => {
      if (prev.includes(id)) {
        // Can't deselect last one if intents section can't cover us
        const intentsCanCover = intentToggle && selectedIntentsRef.current.length > 0;
        if (prev.length === 1 && !intentsCanCover) {
          blocked = true;
          return prev;
        }
        return prev.filter((c) => c !== id);
      }
      return [...prev, id];
    });
    if (blocked) {
      setMinSelectionMessage(true);
      setTimeout(() => setMinSelectionMessage(false), 2500);
    }
  }, [intentToggle]);

  // ORCH-0434: Date option handler (simplified — 3 options, no time slots)
  const handleDateOptionChange = useCallback((option: DateOptionId) => {
    setSelectedDateOption(option);
    if (option !== 'pick_dates') {
      setSelectedDates([]);
    }
  }, []);

  // ORCH-0434: Toggle handlers with mutual exclusion guard
  const handleIntentToggleChange = useCallback((newValue: boolean) => {
    if (!newValue && !categoryToggle) {
      toastManager.warning(t('preferences:experience_types.min_message'), 2000);
      return;
    }
    setIntentToggle(newValue);
  }, [categoryToggle, t]);

  const handleCategoryToggleChange = useCallback((newValue: boolean) => {
    if (!newValue && !intentToggle) {
      toastManager.warning(t('preferences:categories.min_message'), 2000);
      return;
    }
    setCategoryToggle(newValue);
  }, [intentToggle, t]);

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

  const handleClearLocation = useCallback(() => {
    setSearchLocation('');
    setSelectedCoords(null);
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  const handleSuggestionSelect = useCallback(async (suggestion: AutocompleteSuggestion) => {
    if (isSelectingSuggestion.current) return;
    isSelectingSuggestion.current = true;
    setSearchLocation(suggestion.fullAddress || suggestion.displayName);
    setShowSuggestions(false);
    setIsInputFocused(false);

    // Resolve coordinates: use suggestion.location if present, otherwise fetch via placeId
    let coords = suggestion.location ?? null;
    if (!coords && suggestion.placeId) {
      coords = await geocodingService.getPlaceCoordinates(suggestion.placeId);
    }
    // Validate coordinate bounds before accepting
    if (coords && Math.abs(coords.lat) <= 90 && Math.abs(coords.lng) <= 180) {
      setSelectedCoords(coords);
    } else {
      setSelectedCoords(null);
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
    } else {
      // Restore previously saved custom location
      setSearchLocation(savedCustomLocation.current.text);
      setSelectedCoords(savedCustomLocation.current.coords);
    }
  }, [user?.id, setProfile]);

  const hasChanges = useMemo(() => {
    if (!initialPreferences) return true;

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
    if (!arraysEqual(selectedCategories, initialPreferences.selectedCategories)) return true;
    if (selectedDateOption !== initialPreferences.selectedDateOption) return true;
    if (!arraysEqual([...selectedDates].sort(), [...(initialPreferences.selectedDates || [])].sort())) return true;
    if (intentToggle !== initialPreferences.intentToggle) return true;
    if (categoryToggle !== initialPreferences.categoryToggle) return true;
    if (!datesEqual(selectedDate, initialPreferences.selectedDate)) return true;
    if (travelMode !== initialPreferences.travelMode) return true;
    if (constraintValue !== initialPreferences.constraintValue) return true;
    if (searchLocation !== initialPreferences.searchLocation) return true;

    // ORCH-0437: Leaderboard settings changes (separate from deck prefs)
    if (!isCollaborationMode) {
      if (isDiscoverable !== (mapSettings?.is_discoverable ?? false)) return true;
      if (leaderboardVisibility !== (mapSettings?.visibility_level ?? 'friends')) return true;
      if (leaderboardStatus !== (mapSettings?.activity_status ?? null)) return true;
      if (availableSeats !== (mapSettings?.available_seats ?? 1)) return true;
    }

    return false;
  }, [
    initialPreferences,
    selectedIntents,
    selectedCategories,
    selectedDateOption,
    selectedDates,
    selectedDate,
    intentToggle,
    categoryToggle,
    travelMode,
    constraintValue,
    searchLocation,
    isCollaborationMode,
    isDiscoverable,
    leaderboardVisibility,
    leaderboardStatus,
    availableSeats,
    mapSettings,
  ]);

  // ORCH-0434: Form completion logic — location + date + pills + travel
  const isFormComplete = useMemo(() => {
    // Location: GPS is always valid. Custom requires validated address (has coords = chip state)
    const hasLocation = useGpsLocation || (searchLocation.length > 0 && selectedCoords !== null);

    // Every toggled-ON section must have at least 1 selection
    const intentsOk = !intentToggle || selectedIntents.length > 0;
    const categoriesOk = !categoryToggle || selectedCategories.length > 0;
    // At least one toggle must be ON
    const atLeastOneToggle = intentToggle || categoryToggle;
    const hasPills = intentsOk && categoriesOk && atLeastOneToggle;

    const hasDate = selectedDateOption !== null;
    const hasDateDetails = selectedDateOption === 'pick_dates'
      ? selectedDates.length > 0
      : true;

    const hasTravel = typeof constraintValue === 'number' && constraintValue >= 5;

    return hasLocation && hasPills && hasDate && hasDateDetails && hasTravel;
  }, [useGpsLocation, searchLocation, selectedCoords,
      intentToggle, categoryToggle, selectedIntents, selectedCategories,
      selectedDateOption, selectedDates, constraintValue]);

  // Per-section warnings — shown as orange pills on incomplete sections
  const sectionWarnings = useMemo(() => {
    if (isFormComplete) return { location: null, when: null, intents: null, categories: null, travelMode: null, travelLimit: null };
    const hasLocation = useGpsLocation || (searchLocation.length > 0 && selectedCoords !== null);
    return {
      location: !hasLocation ? "Add a starting point" : null,
      when: selectedDateOption === null ? "Pick a date"
        : (selectedDateOption === 'pick_dates' && selectedDates.length === 0) ? "Select dates"
        : null,
      intents: (intentToggle && selectedIntents.length === 0) ? "Pick an experience" : null,
      categories: (categoryToggle && selectedCategories.length === 0) ? "Pick a category" : null,
      travelMode: null, // travel mode always has a default
      travelLimit: (typeof constraintValue !== 'number' || constraintValue < 5) ? "Set travel distance" : null,
    };
  }, [isFormComplete, useGpsLocation, searchLocation, selectedCoords,
      selectedDateOption, selectedDates,
      intentToggle, selectedIntents, categoryToggle, selectedCategories,
      constraintValue]);

  const ctaHintText = useMemo(() => {
    if (isFormComplete) return null;
    // Show first incomplete section's warning as the CTA hint
    return sectionWarnings.location
      || sectionWarnings.when
      || sectionWarnings.intents
      || sectionWarnings.categories
      || sectionWarnings.travelLimit
      || "Almost there";
  }, [isFormComplete, sectionWarnings]);

  const countChanges = useCallback((): number => {
    if (!initialPreferences) return 1;

    let changes = 0;

    const arraysEqual = (a: any[], b: any[]) => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    if (!arraysEqual(selectedIntents, initialPreferences.selectedIntents))
      changes++;
    if (!arraysEqual(selectedCategories, initialPreferences.selectedCategories))
      changes++;
    if (selectedDateOption !== initialPreferences.selectedDateOption) changes++;
    if (!arraysEqual([...selectedDates].sort(), [...(initialPreferences.selectedDates || [])].sort())) changes++;
    if (intentToggle !== initialPreferences.intentToggle) changes++;
    if (categoryToggle !== initialPreferences.categoryToggle) changes++;

    const datesEqual = (a: Date | null, b: Date | null) => {
      if (a === null && b === null) return true;
      if (a === null || b === null) return false;
      return a.getTime() === b.getTime();
    };
    if (!datesEqual(selectedDate, initialPreferences.selectedDate)) changes++;

    if (travelMode !== initialPreferences.travelMode) changes++;
    if (constraintValue !== initialPreferences.constraintValue) changes++;
    if (searchLocation !== initialPreferences.searchLocation) changes++;

    // ORCH-0437: Leaderboard settings changes
    if (!isCollaborationMode) {
      if (isDiscoverable !== (mapSettings?.is_discoverable ?? false)) changes++;
      if (leaderboardVisibility !== (mapSettings?.visibility_level ?? 'friends')) changes++;
      if (leaderboardStatus !== (mapSettings?.activity_status ?? null)) changes++;
      if (availableSeats !== (mapSettings?.available_seats ?? 1)) changes++;
    }

    return changes;
  }, [
    initialPreferences,
    selectedIntents,
    selectedCategories,
    selectedDateOption,
    selectedDates,
    selectedDate,
    intentToggle,
    categoryToggle,
    travelMode,
    constraintValue,
    searchLocation,
    isCollaborationMode,
    isDiscoverable,
    leaderboardVisibility,
    leaderboardStatus,
    availableSeats,
    mapSettings,
  ]);

  const handleReset = useCallback(() => {
    mixpanelService.trackPreferencesReset(isCollaborationMode);
    setSelectedIntents(defaultPreferences.selectedIntents);
    setSelectedCategories(defaultPreferences.selectedCategories);
    setSelectedDateOption(defaultPreferences.selectedDateOption);
    setSelectedDates(defaultPreferences.selectedDates);
    setSelectedDate(defaultPreferences.selectedDate);
    setIntentToggle(defaultPreferences.intentToggle);
    setCategoryToggle(defaultPreferences.categoryToggle);
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

    // Normalize location fields for consistency
    const normalized = normalizePreferencesForSave({
      date_option: selectedDateOption ? DATE_OPTION_TO_DB[selectedDateOption] : null,
      datetime_pref: selectedDate ? selectedDate.toISOString() : null,
      use_gps_location: useGpsLocation,
      custom_location: customLocationValue,
    });

    const finalCategories = selectedCategories;
    const finalIntents = selectedIntents;

    // ORCH-0434: Clean payload — no budget, price tiers, or time slots
    const preferences = {
      selectedIntents: finalIntents,
      selectedCategories: finalCategories,
      dateOption: selectedDateOption,
      selectedDates,
      selectedDate: normalized.datetime_pref || selectedDate?.toISOString(),
      travelMode,
      constraintType,
      constraintValue,
      useLocation,
      searchLocation,
      useGpsLocation: normalized.use_gps_location ?? useGpsLocation,
      custom_location: normalized.custom_location ?? customLocationValue,
      custom_lat: selectedCoords?.lat ?? null,
      custom_lng: selectedCoords?.lng ?? null,
      intentToggle,
      categoryToggle,
    };

    // === CLOSE SHEET IMMEDIATELY — user sees instant response ===
    onClose?.();

    // === FIRE-AND-FORGET: Save + invalidate ===
    // onSave sets the optimistic React Query cache FIRST, then we invalidate
    // deck/curated to trigger re-fetch with the new params.
    (async () => {
      try {
        if (isCollaborationMode) {
          // PARITY: This is the SOLE preference sheet for both solo and collab modes.
          // CollaborationPreferences.tsx was deleted (ORCH-0316) — this file is the single source of truth.

          // Resolve GPS coordinates for collab persistence (ORCH-0394).
          // Solo passes location inline in API body (resolved at query time by useUserLocation).
          // Collab MUST persist coords to DB because the server aggregates multiple participants'
          // preferences server-side and can't access the device's GPS.
          let collabLat: number | null = selectedCoords?.lat ?? null;
          let collabLng: number | null = selectedCoords?.lng ?? null;

          if (useGpsLocation && collabLat == null) {
            try {
              const gps = await enhancedLocationService.getCurrentLocation();
              if (gps) {
                collabLat = gps.latitude;
                collabLng = gps.longitude;
              }
            } catch {
              // GPS failed — save without coords. Server fallback chain provides defense-in-depth.
            }
          }

          // ORCH-0434: Clean collab save — no budget, price tiers, time slots
          const rawDbPrefs: any = {
            categories: finalCategories,
            intents: finalIntents,
            travel_mode: travelMode,
            travel_constraint_type: 'time' as const,
            travel_constraint_value:
              typeof constraintValue === "number" ? constraintValue : 30,
            datetime_pref: selectedDate ? selectedDate.toISOString() : null,
            date_option: selectedDateOption
              ? DATE_OPTION_TO_DB[selectedDateOption]
              : 'today',
            selected_dates: selectedDates.length > 0 ? selectedDates : null,
            use_gps_location: useGpsLocation,
            custom_location: customLocationValue,
            custom_lat: collabLat,
            custom_lng: collabLng,
            intent_toggle: intentToggle,
            category_toggle: categoryToggle,
          };

          const dbPrefs = normalizePreferencesForSave(rawDbPrefs);

          if (searchLocation) {
            (dbPrefs as Record<string, unknown>).location = searchLocation;
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
        mixpanelService.trackPreferencesUpdated({
          isCollaborationMode,
          changesCount: finalCategories.length + finalIntents.length,
          intents: finalIntents,
          categories: finalCategories,
          travelMode,
          constraintType: 'time',
          constraintValue: typeof constraintValue === 'number' ? constraintValue : 30,
          dateOption: selectedDateOption ?? null,
        });
      } catch (error) {
        console.warn("[PreferencesSheet] Background save failed:", error);
        toastManager.error(t('preferences:sheet.save_error'), 4000);
      }

      // ORCH-0437: Leaderboard settings save via useMapSettings — NEVER via onSave or board prefs
      if (!isCollaborationMode) {
        const lbChanged =
          isDiscoverable !== (mapSettings?.is_discoverable ?? false) ||
          leaderboardVisibility !== (mapSettings?.visibility_level ?? 'friends') ||
          leaderboardStatus !== (mapSettings?.activity_status ?? null) ||
          availableSeats !== (mapSettings?.available_seats ?? 1);

        if (lbChanged) {
          try {
            await updateMapSettings({
              is_discoverable: isDiscoverable,
              visibility_level: leaderboardVisibility,
              activity_status: leaderboardStatus,
              available_seats: availableSeats,
            });
            // Sync transient copy to leaderboard_presence (fire-and-forget)
            const gpsLat = selectedCoords?.lat ?? null;
            const gpsLng = selectedCoords?.lng ?? null;
            if (isDiscoverable && gpsLat && gpsLng) {
              leaderboardService.upsertPresence({
                lat: gpsLat,
                lng: gpsLng,
                is_discoverable: isDiscoverable,
                visibility_level: leaderboardVisibility,
                activity_status: leaderboardStatus || undefined,
                available_seats: availableSeats,
                preference_categories: selectedCategories,
              }).catch((err: unknown) => console.warn('[PreferencesSheet] Presence sync failed:', err));
            }
          } catch (err) {
            console.warn('[PreferencesSheet] Leaderboard settings save failed:', err);
          }
        }
      }

      // RELIABILITY: DO NOT add invalidateQueries here. AppHandlers.handleSavePreferences
      // already handles via: (1) optimistic cache set, (2) preferencesRefreshKey bump,
      // (3) deck history reset on hash change. Adding invalidateQueries(["userPreferences"])
      // causes a RACE: server refetch returns OLD prefs (DB write hasn't completed) and
      // overwrites the optimistic cache. This was the root cause of "wrong cards after
      // preference change" bug.

    })();

    isSavingRef.current = false;
    setIsSaving(false);
  }, [
    selectedIntents,
    selectedCategories,
    selectedDateOption,
    selectedDates,
    selectedDate,
    intentToggle,
    categoryToggle,
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
    isDiscoverable,
    leaderboardVisibility,
    leaderboardStatus,
    availableSeats,
    mapSettings,
    updateMapSettings,
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
                {t('preferences:sheet.session_vibes', { name: sessionName })}
              </Text>
            ) : (
              <Text style={styles.title}>{t('preferences:sheet.title')}</Text>
            )}
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <KeyboardAwareScrollView
            ref={scrollRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
          {/* 1. Starting Point — moved to top (ORCH-0434) */}
          <Animated.View style={{
            opacity: sectionAnims[0],
            transform: [{ translateY: sectionAnims[0].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
          <View
            ref={locationSectionRef}
            style={[styles.section, { marginTop: 20 }]}  // First section: 20px
            onLayout={(event) => {
              const { y } = event.nativeEvent.layout;
              locationSectionY.current = y;
            }}
          >
            <Text style={styles.sectionTitle}>Where should we start looking?</Text>

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
              onClearLocation={handleClearLocation}
              isInputFocused={isInputFocused}
              useGpsLocation={useGpsLocation}
              onToggleGps={handleGpsToggle}
              isLocked={!canAccess('custom_starting_point')}
              onLockedTap={() => {
                setPaywallFeature('custom_starting_point');
                setShowPaywall(true);
              }}
            />
            {sectionWarnings.location && (
              <View style={styles.sectionWarningPill}>
                <Text style={styles.sectionWarningText}>{sectionWarnings.location}</Text>
              </View>
            )}
          </View>

          </Animated.View>

          {/* 2. When */}
          <Animated.View style={{
            opacity: sectionAnims[1],
            transform: [{ translateY: sectionAnims[1].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
          <WhenSection
            dateOption={selectedDateOption}
            onDateOptionChange={handleDateOptionChange}
            selectedDates={selectedDates}
            onDatesChange={setSelectedDates}
            warning={sectionWarnings.when}
          />

          </Animated.View>

          {/* 3. Intents (with toggle) */}
          <Animated.View style={{
            opacity: sectionAnims[2],
            transform: [{ translateY: sectionAnims[2].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
          <ToggleSection
            title="See curated experiences?"
            isOn={intentToggle}
            onToggle={handleIntentToggleChange}
            disabled={!categoryToggle}
            warning={sectionWarnings.intents}
          >
            <ExperienceTypesSection
              experienceTypes={experienceTypes}
              selectedIntents={selectedIntents}
              onIntentToggle={handleIntentToggle}
              minMessage={minSelectionMessage}
              isCuratedLocked={false}
              onLockedTap={() => {
                setPaywallFeature('curated_cards');
                setShowPaywall(true);
              }}
            />
          </ToggleSection>

          </Animated.View>

          {/* 4. Categories (with toggle) */}
          <Animated.View style={{
            opacity: sectionAnims[3],
            transform: [{ translateY: sectionAnims[3].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
          <ToggleSection
            title="See popular options?"
            isOn={categoryToggle}
            onToggle={handleCategoryToggleChange}
            disabled={!intentToggle}
            warning={sectionWarnings.categories}
          >
            <CategoriesSection
              filteredCategories={filteredCategories}
              selectedCategories={selectedCategories}
              onCategoryToggle={handleCategoryToggle}
              minMessage={minSelectionMessage}
            />
          </ToggleSection>

          </Animated.View>

          {/* 5. How are you rolling? */}
          <Animated.View style={{
            opacity: sectionAnims[4],
            transform: [{ translateY: sectionAnims[4].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How are you rolling?</Text>
            <TravelModeSection
              travelModes={travelModes}
              travelMode={travelMode}
              onTravelModeChange={setTravelMode}
            />
          </View>
          </Animated.View>

          {/* 6. How far? */}
          <Animated.View style={{
            opacity: sectionAnims[5],
            transform: [{ translateY: sectionAnims[5].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How far?</Text>
            <TravelLimitSection
            constraintValue={constraintValue}
            onConstraintValueChange={(text) => {
              const numericValue = text.replace(/[^0-9]/g, "");
              if (numericValue === "") {
                setConstraintValue("");
                return;
              }
              const val = Number(numericValue);
              // Accept any value while typing — validation happens in isFormComplete (>= 5)
              if (val <= 120) {
                setConstraintValue(val);
              }
            }}
            onFocus={() => {
              // Force scroll to bottom so keyboard doesn't cover the input
              // The KeyboardAwareScrollView auto-scrolls on keyboard show,
              // but this ensures it works when keyboard is already open
              setTimeout(() => {
                scrollRef.current?.scrollToEnd?.({ animated: true });
              }, 300);
            }}
          />
            {sectionWarnings.travelLimit && (
              <View style={styles.sectionWarningPill}>
                <Text style={styles.sectionWarningText}>{sectionWarnings.travelLimit}</Text>
              </View>
            )}
          </View>
          </Animated.View>

          {/* 7. Near You Leaderboard — solo mode only (ORCH-0437) */}
          {!isCollaborationMode && (
            <Animated.View style={{
              opacity: sectionAnims[6],
              transform: [{ translateY: sectionAnims[6].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            }}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Near You Leaderboard</Text>

              {/* Master toggle */}
              <View style={styles.lbToggleRow}>
                <View style={styles.lbToggleTextArea}>
                  <Text style={styles.lbToggleLabel}>Appear on the leaderboard</Text>
                  <Text style={styles.lbToggleDescription}>Let nearby explorers find you</Text>
                </View>
                <Switch
                  value={isDiscoverable}
                  onValueChange={setIsDiscoverable}
                  trackColor={{ true: '#eb7825', false: '#e5e7eb' }}
                  thumbColor="#fff"
                  accessibilityLabel={`Appear on the Near You leaderboard. Currently ${isDiscoverable ? 'on' : 'off'}.`}
                  accessibilityRole="switch"
                />
              </View>

              {/* Sub-controls — only when discoverable */}
              {isDiscoverable && (
                <View style={styles.lbSubControls}>
                  {/* Who sees you */}
                  <Text style={styles.lbSubLabel}>Who sees you</Text>
                  <View style={styles.lbVisibilityOptions}>
                    {(['everyone', 'friends_of_friends', 'friends', 'paired', 'off'] as VisibilityLevel[]).map((level) => {
                      const labels: Record<string, string> = {
                        everyone: 'Everyone',
                        friends_of_friends: 'Friends of Friends',
                        friends: 'Friends',
                        paired: 'Paired',
                        off: 'Nobody',
                      };
                      const isActive = leaderboardVisibility === level;
                      return (
                        <TouchableOpacity
                          key={level}
                          style={[styles.lbVisOption, isActive && styles.lbVisOptionActive]}
                          onPress={() => setLeaderboardVisibility(level)}
                          activeOpacity={0.7}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isActive }}
                        >
                          <Text style={[styles.lbVisOptionText, isActive && styles.lbVisOptionTextActive]}>
                            {labels[level]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Your status */}
                  <Text style={styles.lbSubLabel}>Your status</Text>
                  {['None', 'Exploring', 'Looking for plans', 'Open to meet', 'Busy'].map((status) => {
                    const value = status === 'None' ? null : status;
                    const isActive = leaderboardStatus === value;
                    return (
                      <TouchableOpacity
                        key={status}
                        style={styles.lbStatusOption}
                        onPress={() => { setLeaderboardStatus(value); setCustomStatusText(''); }}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isActive }}
                      >
                        <View style={[styles.lbRadio, isActive && styles.lbRadioActive]} />
                        <Text style={[styles.lbStatusText, isActive && styles.lbStatusTextActive]}>{status}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {/* Custom status */}
                  <View style={styles.lbStatusOption}>
                    <View style={[
                      styles.lbRadio,
                      leaderboardStatus !== null &&
                      !['Exploring', 'Looking for plans', 'Open to meet', 'Busy'].includes(leaderboardStatus) &&
                      styles.lbRadioActive
                    ]} />
                    <TextInput
                      style={styles.lbCustomInput}
                      value={customStatusText}
                      onChangeText={(text) => {
                        setCustomStatusText(text);
                        if (text.trim()) setLeaderboardStatus(text.trim());
                      }}
                      placeholder="Custom status..."
                      placeholderTextColor="#9ca3af"
                      maxLength={30}
                      returnKeyType="done"
                    />
                  </View>

                  {/* Available seats */}
                  <Text style={styles.lbSubLabel}>Available seats</Text>
                  <Text style={styles.lbSubDescription}>How many people can tag along?</Text>
                  <View style={styles.lbStepperRow}>
                    <TouchableOpacity
                      style={[styles.lbStepperBtn, availableSeats <= 1 && styles.lbStepperBtnDisabled]}
                      onPress={() => setAvailableSeats(Math.max(1, availableSeats - 1))}
                      disabled={availableSeats <= 1}
                      activeOpacity={0.7}
                      accessibilityLabel="Decrease seats"
                    >
                      <Icon name="remove" size={18} color={availableSeats <= 1 ? '#9ca3af' : '#374151'} />
                    </TouchableOpacity>
                    <Text style={styles.lbStepperValue}>{availableSeats}</Text>
                    <TouchableOpacity
                      style={[styles.lbStepperBtn, styles.lbStepperBtnPlus, availableSeats >= 5 && styles.lbStepperBtnDisabled]}
                      onPress={() => setAvailableSeats(Math.min(5, availableSeats + 1))}
                      disabled={availableSeats >= 5}
                      activeOpacity={0.7}
                      accessibilityLabel="Increase seats"
                    >
                      <Icon name="add" size={18} color={availableSeats >= 5 ? '#9ca3af' : '#fff'} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
            </Animated.View>
          )}

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
              accessibilityLabel={ctaHintText ?? (hasChanges ? `${t('preferences:sheet.lock_it_in')}, ${countChanges()} changes` : t('preferences:sheet.lock_it_in'))}
              accessibilityState={{ disabled: isSaving || !isFormComplete || !hasChanges }}
            >
              {isSaving ? (
                <View style={styles.buttonLoadingContainer}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.applyButtonText}>{t('preferences:sheet.saving')}</Text>
                </View>
              ) : (
                <Text style={styles.applyButtonText}>
                  {!isFormComplete && ctaHintText
                    ? ctaHintText
                    : isFormComplete && !hasChanges
                      ? "No changes to save"
                      : hasChanges
                        ? t('preferences:sheet.lock_it_in_count', { count: countChanges() })
                        : t('preferences:sheet.lock_it_in')}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReset}
              style={styles.resetButton}
              disabled={isSaving}
            >
              <Text style={styles.resetButtonText}>{t('preferences:sheet.start_over')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      </SafeAreaView>

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
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
    backgroundColor: '#fff9f5',  // warm glow — glass cards float above this
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#fff9f5',
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 200,
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
  // ORCH-0434 Phase 6D: Glass card treatment
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 24,
    padding: 20,
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: 'rgba(0, 0, 0, 0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: 14,
  },
  noChangesHint: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
  },
  sectionWarningPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 10,
  },
  sectionWarningText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ea580c',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
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
    backgroundColor: 'rgba(255, 249, 245, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.50)',
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
  // ORCH-0437: Leaderboard Section 7 styles
  lbToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  lbToggleTextArea: {
    flex: 1,
    marginRight: 12,
  },
  lbToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  lbToggleDescription: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6b7280',
    marginTop: 2,
  },
  lbSubControls: {
    marginTop: 12,
  },
  lbSubLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 14,
    marginBottom: 6,
  },
  lbSubDescription: {
    fontSize: 11,
    fontWeight: '400',
    color: '#9ca3af',
    marginBottom: 8,
  },
  lbVisibilityOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  lbVisOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  lbVisOptionActive: {
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
    borderColor: 'rgba(235, 120, 37, 0.3)',
  },
  lbVisOptionText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  lbVisOptionTextActive: {
    color: '#eb7825',
    fontWeight: '600',
  },
  lbStatusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 36,
  },
  lbRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#d1d5db',
  },
  lbRadioActive: {
    borderColor: '#eb7825',
    backgroundColor: '#eb7825',
  },
  lbStatusText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#374151',
  },
  lbStatusTextActive: {
    fontWeight: '600',
    color: '#eb7825',
  },
  lbCustomInput: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  lbStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    justifyContent: 'center',
    marginTop: 4,
  },
  lbStepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbStepperBtnPlus: {
    backgroundColor: '#eb7825',
  },
  lbStepperBtnDisabled: {
    opacity: 0.4,
  },
  lbStepperValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    minWidth: 30,
    textAlign: 'center',
  },
});
