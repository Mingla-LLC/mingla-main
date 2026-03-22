import React, { useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Modal,
  Platform,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Icon } from "../ui/Icon";
import { TrackedTouchableOpacity } from "../TrackedTouchableOpacity";
import { useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ExpandedCardData, BookingOption } from "../../types/expandedCardTypes";
import { savedCardsService } from "../../services/savedCardsService";
import { CalendarService } from "../../services/calendarService";
import { useAppStore } from "../../store/appStore";
import { useCalendarEntries } from "../../hooks/useCalendarEntries";
import { toastManager } from "../ui/Toast";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import { useIsPlaceOpen } from "../../hooks/useIsPlaceOpen";
import { extractWeekdayText } from "../../utils/openingHoursUtils";


interface ActionButtonsProps {
  card: ExpandedCardData;
  bookingOptions: BookingOption[];
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onPurchase?: (card: ExpandedCardData, bookingOption: BookingOption) => void;
  onShare?: (card: ExpandedCardData) => void;
  onClose?: () => void;
  isSaved?: boolean;
  userPreferences?: any;
  currentMode?: string;
  onCardRemoved?: (cardId: string) => void; // Callback to remove card from deck
  onScheduleSuccess?: (card: ExpandedCardData) => void; // Callback after successful scheduling
  onOpenBrowser?: (url: string, title: string) => void; // Opens in-app browser (for Policies & Reservations)
  isVisited?: boolean;
  isVisitLoading?: boolean;
  onVisitPress?: () => void;
  onRemoveVisitPress?: () => void;
  hasCalendarEntry?: boolean;
}

export default function ActionButtons({
  card,
  bookingOptions,
  onSave,
  onPurchase,
  onShare,
  onClose,
  isSaved = false,
  userPreferences,
  currentMode = "solo",
  onCardRemoved,
  onScheduleSuccess,
  onOpenBrowser,
  isVisited = false,
  isVisitLoading = false,
  onVisitPress,
  onRemoveVisitPress,
  hasCalendarEntry = false,
}: ActionButtonsProps) {
  const insets = useSafeAreaInsets();
  const [isSaving, setIsSaving] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());
  const [pickerMode, setPickerMode] = useState<"date" | "time">("date");
  const [selectedDateTime, setSelectedDateTime] = useState<Date | null>(null);
  const [availabilityCheck, setAvailabilityCheck] = useState<{
    isOpen: boolean;
    isAssumption: boolean;
    reason?: string;
  } | null>(null);
  const [hasCheckedAvailability, setHasCheckedAvailability] = useState(false);
  const [showAllHours, setShowAllHours] = useState(false);
  const visitScaleAnim = useRef(new Animated.Value(1)).current;

  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const { data: calendarEntries = [] } = useCalendarEntries(user?.id);
  // Check if card is already scheduled
  const isScheduled = useMemo(() => {
    return calendarEntries.some(
      (entry) =>
        (entry.card_id === card.id ||
          entry.card_data?.id === card.id ||
          entry.card_data?.experience_id === card.id) &&
        entry.status === "pending" &&
        !entry.archived_at,
    );
  }, [calendarEntries, card.id]);

  // Normalize opening hours for display — uses the same canonical parser
  // as useIsPlaceOpen so both hours list and Open/Closed badge always agree.
  const parsedOpeningHours = useMemo(() => {
    const lines = extractWeekdayText(card.openingHours);
    return lines ? { lines } : null;
  }, [card.openingHours]);

  // Live open/closed status computed from weekday_text against local clock
  const liveOpenStatus = useIsPlaceOpen(card.openingHours);

  // Get today's day name for highlighting
  const todayDayName = useMemo(() => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[new Date().getDay()];
  }, []);

  // Parse time string like "9:00 AM" to minutes since midnight
  const parseTimeString = (timeStr: string): number => {
    const trimmed = timeStr.trim();
    const match = trimmed.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 0;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    // Convert to 24-hour format
    if (period === "AM") {
      if (hours === 12) hours = 0; // 12 AM = midnight
    } else {
      // PM
      if (hours !== 12) hours += 12; // 1 PM = 13:00, but 12 PM stays 12
    }

    return hours * 60 + minutes; // Return minutes since midnight
  };

  // Check if place is open at the selected date/time
  const checkPlaceAvailability = (
    dateToCheck: Date,
  ): {
    isOpen: boolean;
    isAssumption: boolean;
    reason?: string;
  } => {
    if (!card || !dateToCheck) {
      return {
        isOpen: true,
        isAssumption: true,
        reason: "No card or time selected",
      };
    }

    let openingHours: any = card.openingHours;

    // If openingHours is a string, try to unwrap (may be JSON-stringified once or more)
    if (typeof openingHours === "string") {
      const trimmed = openingHours.trim();
      if (trimmed === "" || trimmed === '""') {
        return {
          isOpen: true,
          isAssumption: true,
          reason: "Opening hours data not available",
        };
      }
      let attempts = 0;
      while (typeof openingHours === "string" && attempts < 3) {
        try {
          openingHours = JSON.parse(openingHours);
          attempts++;
        } catch {
          break;
        }
      }
    }

    // If no opening hours data, assume open (user schedules at own risk)
    if (
      !openingHours ||
      openingHours === null ||
      typeof openingHours !== "object" ||
      !Array.isArray(openingHours.weekday_text) ||
      openingHours.weekday_text.length === 0
    ) {
      return {
        isOpen: true,
        isAssumption: true,
        reason: "Opening hours data not available",
      };
    }

    // Get the day of the week from date (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = dateToCheck.getDay();
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const selectedDayName = dayNames[dayOfWeek];

    // Find the opening hours for the selected day
    const dayHours = openingHours.weekday_text?.find((entry: string) =>
      entry.startsWith(selectedDayName),
    );

    if (!dayHours) {
      // No hours found for this day, assume closed
      return {
        isOpen: false,
        isAssumption: false,
      };
    }

    // Ensure dayHours is a string
    if (typeof dayHours !== "string") {
      return {
        isOpen: true,
        isAssumption: true,
        reason: "Invalid opening hours data format",
      };
    }

    // Handle special case: "Open 24 hours"
    if (/open\s*24\s*hours?/i.test(dayHours)) {
      return {
        isOpen: true,
        isAssumption: false,
      };
    }

    // Handle special case: "Closed"
    if (/closed/i.test(dayHours)) {
      return {
        isOpen: false,
        isAssumption: false,
      };
    }

    // Parse the time range (e.g., "Monday: 9:00 AM – 12:00 AM")
    // Try different patterns to handle various formats
    let timeRangeMatch = dayHours.match(/:\s*(.+?)\s*–\s*(.+)$/);

    // If that doesn't work, try with different dash characters
    if (!timeRangeMatch) {
      timeRangeMatch = dayHours.match(/:\s*(.+?)\s*-\s*(.+)$/); // Regular dash
    }
    if (!timeRangeMatch) {
      timeRangeMatch = dayHours.match(/:\s*(.+?)\s*to\s*(.+)$/i); // "to" separator
    }
    if (!timeRangeMatch) {
      // Can't parse the time range, assume open with warning
      return {
        isOpen: true,
        isAssumption: true,
        reason: "Could not parse opening hours format",
      };
    }

    const openTimeStr = timeRangeMatch[1].trim();
    const closeTimeStr = timeRangeMatch[2].trim();

    // Parse times to minutes since midnight
    const openTimeMinutes = parseTimeString(openTimeStr);
    const closeTimeMinutes = parseTimeString(closeTimeStr);

    // Get selected time in minutes since midnight
    const selectedHours = dateToCheck.getHours();
    const selectedMinutes = dateToCheck.getMinutes();
    const selectedTimeMinutes = selectedHours * 60 + selectedMinutes;

    // Handle case where closing time is midnight (12:00 AM)
    if (closeTimeMinutes === 0) {
      const isOpen = selectedTimeMinutes >= openTimeMinutes;
      return { isOpen, isAssumption: false };
    }

    // Normal case: check if selected time is within the range
    if (openTimeMinutes < closeTimeMinutes) {
      // Normal case: opening and closing on same day (e.g., 9 AM - 6 PM)
      const isOpen =
        selectedTimeMinutes >= openTimeMinutes &&
        selectedTimeMinutes < closeTimeMinutes;
      return { isOpen, isAssumption: false };
    } else {
      // Case where closing time is next day (e.g., 9 PM - 2 AM)
      const isOpen =
        selectedTimeMinutes >= openTimeMinutes ||
        selectedTimeMinutes < closeTimeMinutes;
      return { isOpen, isAssumption: false };
    }
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

  const handleVisitPress = () => {
    if (isVisitLoading) return;
    if (isVisited) {
      onRemoveVisitPress?.();
    } else {
      // Scale down → color transition → scale back + haptic
      Animated.sequence([
        Animated.timing(visitScaleAnim, {
          toValue: 0.95,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(visitScaleAnim, {
          toValue: 1.0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      });
      onVisitPress?.();
    }
  };

  // Show visit button when card is saved and has no calendar entry
  const showVisitButton = isSaved && !hasCalendarEntry && (onVisitPress || onRemoveVisitPress);

  const handleSave = async () => {
    if (isSaving) return; // Prevent multiple saves

    setIsSaving(true);
    try {
      await onSave(card);
    } catch (error: any) {
      Alert.alert("Error", "Failed to save the card. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSchedule = () => {
    if (isScheduling || isScheduled || !user?.id) return;
    // Always reset and show date/time picker
    setAvailabilityCheck(null);
    setHasCheckedAvailability(false);
    setSelectedDateTime(null);

    const now = new Date();
    setSelectedDate(now);
    setSelectedTime(now);
    setPickerMode("date");
    setShowDateTimePicker(true);
  };

  const handleDateTimePickerChange = (event: any, date?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "dismissed") {
        setShowDateTimePicker(false);
        return;
      }

      if (date) {
        if (pickerMode === "date") {
          // Date selected on Android - show time picker next
          setSelectedDate(date);
          setSelectedTime(date);
          setPickerMode("time");
          // Keep picker visible for time selection
        } else {
          // Time selected on Android - check availability
          const combinedDateTime = new Date(selectedDate);
          combinedDateTime.setHours(date.getHours());
          combinedDateTime.setMinutes(date.getMinutes());
          setSelectedTime(combinedDateTime);
          setSelectedDateTime(combinedDateTime);
          setShowDateTimePicker(false);

          // Check availability and auto-schedule if open
          const availability = checkPlaceAvailability(combinedDateTime);
          setAvailabilityCheck(availability);
          setHasCheckedAvailability(true);

          if (availability.isOpen) {
            proceedWithScheduling(combinedDateTime);
          } else {
            Alert.alert(
              "Place Closed",
              "This place is closed at the selected date and time. Please choose a different time.",
              [
                {
                  text: "Choose Another Time",
                  onPress: () => {
                    setAvailabilityCheck(null);
                    setHasCheckedAvailability(false);
                    setSelectedDateTime(null);
                    const now = new Date();
                    setSelectedDate(now);
                    setSelectedTime(now);
                    setPickerMode("date");
                    setShowDateTimePicker(true);
                  },
                },
                { text: "Cancel", style: "cancel" },
              ],
            );
          }
        }
      }
    } else {
      // iOS flow
      if (date) {
        if (pickerMode === "date") {
          setSelectedDate(date);
          setSelectedTime(date);
          setPickerMode("time");
        } else {
          // Time selected - wait for Done button
          const combinedDateTime = new Date(selectedDate);
          combinedDateTime.setHours(date.getHours());
          combinedDateTime.setMinutes(date.getMinutes());
          setSelectedTime(combinedDateTime);
        }
      }
    }
  };

  const handleTimePickerConfirm = () => {
    const combinedDateTime = new Date(selectedDate);
    combinedDateTime.setHours(selectedTime.getHours());
    combinedDateTime.setMinutes(selectedTime.getMinutes());
    setSelectedDateTime(combinedDateTime);
    setShowDateTimePicker(false);

    // Check availability and auto-schedule if open
    const availability = checkPlaceAvailability(combinedDateTime);
    setAvailabilityCheck(availability);
    setHasCheckedAvailability(true);

    if (availability.isOpen) {
      proceedWithScheduling(combinedDateTime);
    } else {
      Alert.alert(
        "Place Closed",
        "This place is closed at the selected date and time. Please choose a different time.",
        [
          {
            text: "Choose Another Time",
            onPress: () => {
              setAvailabilityCheck(null);
              setHasCheckedAvailability(false);
              setSelectedDateTime(null);
              const now = new Date();
              setSelectedDate(now);
              setSelectedTime(now);
              setPickerMode("date");
              setShowDateTimePicker(true);
            },
          },
          { text: "Cancel", style: "cancel" },
        ],
      );
    }
  };

  const proceedWithScheduling = async (scheduledDateTime: Date) => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to schedule cards.");
      setIsScheduling(false);
      return;
    }

    setIsScheduling(true);
    try {
      if (isNaN(scheduledDateTime.getTime())) {
        Alert.alert("Invalid Date", "The selected date is not valid. Please try again.");
        setIsScheduling(false);
        return;
      }
      const scheduledDateISO = scheduledDateTime.toISOString();

      // Determine source based on current mode
      const source: "solo" | "collaboration" =
        currentMode === "solo" ? "solo" : "collaboration";

      // If the card is saved, remove it from saved_cards table when scheduling
      if (isSaved) {
        try {
          // Use currentMode to determine source instead of card.source

          await savedCardsService.removeCard(user.id, card.id, source);
          // Invalidate savedCards query to refresh the list
          queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });
        } catch (error) {
          // Log error but don't block scheduling
          console.error(
            "Error removing card from saved_cards when scheduling:",
            error,
          );
        }
      }

      // Explicitly construct a clean, JSON-serializable card object.
      const sanitizedCard = {
        id: card.id,
        placeId: card.placeId ?? card.id,
        title: card.title,
        category: card.category,
        categoryIcon: card.categoryIcon,
        description: card.description,
        fullDescription: card.fullDescription || card.description,
        image: card.image,
        images: card.images || (card.image ? [card.image] : []),
        rating: card.rating || 0,
        reviewCount: card.reviewCount || 0,
        priceRange: card.priceRange || '',
        distance: card.distance || '',
        travelTime: card.travelTime || '',
        address: card.address || '',
        openingHours: card.openingHours,
        highlights: card.highlights || [],
        tags: card.tags || [],
        matchScore: card.matchScore || 0,
        matchFactors: card.matchFactors || {},
        location: card.location
          ? { lat: card.location.lat, lng: card.location.lng }
          : undefined,
        cardType: card.cardType,
        tagline: card.tagline,
        stops: card.stops,
        totalPriceMin: card.totalPriceMin,
        totalPriceMax: card.totalPriceMax,
        estimatedDurationMinutes: card.estimatedDurationMinutes,
        experienceType: card.experienceType,
        source,
      };

      const record = await CalendarService.addEntryFromSavedCard(
        user.id,
        sanitizedCard,
        scheduledDateISO,
      );

      // Invalidate calendar entries query to refresh after adding to lockedIn
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // Add to device calendar
      try {
        const deviceEvent = DeviceCalendarService.createEventFromCard(
          card,
          scheduledDateTime,
          record.duration_minutes || 120,
        );
        await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
      } catch (deviceCalendarError) {
        // Don't fail the whole operation if device calendar fails
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Show success toast
      toastManager.success(
        `Scheduled! ${card.title} has been moved to your calendar`,
        3000,
      );

      // Remove card from deck if callback is provided
      if (onCardRemoved) {
        onCardRemoved(card.id);
      }

      // Trigger feedback flow or close modal
      if (onScheduleSuccess) {
        onScheduleSuccess(card);
      } else if (onClose) {
        onClose();
      }
    } catch (error: any) {
      console.error("[ActionButtons] Scheduling error:", error);
      const detail = __DEV__ && error?.message ? `\n\nDEV: ${error.message}` : "";
      Alert.alert(
        "Schedule failed",
        `We couldn't add this to your calendar. Please try again.${detail}`,
      );
    } finally {
      setIsScheduling(false);
      // Reset availability check state after scheduling completes
      setHasCheckedAvailability(false);
      setAvailabilityCheck(null);
      setSelectedDateTime(null);
    }
  };

  const handleShare = () => {
    if (onShare) {
      onShare(card);
    } else {
      Alert.alert("Share", `Share ${card.title} with friends`);
    }
  };

  const handlePoliciesAndReservations = () => {
    if (!onOpenBrowser || !card.website) return;

    let url = card.website;
    if (url.startsWith('http://')) {
      // Force HTTPS — iOS ATS blocks insecure HTTP connections in WebView
      url = url.replace('http://', 'https://');
    } else if (!url.startsWith('https://')) {
      url = `https://${url}`;
    }
    onOpenBrowser(url, card.title);
  };

  const showPoliciesButton = !!card.website;

  return (
    <View style={styles.container}>
      {/* Date/Time Picker Modal */}
      {showDateTimePicker && (
        <>
          {Platform.OS === "ios" ? (
            <Modal
              visible={showDateTimePicker}
              transparent={true}
              animationType="slide"
              onRequestClose={() => setShowDateTimePicker(false)}
            >
              <View style={styles.modalOverlay}>
                <TrackedTouchableOpacity
                  logComponent="ActionButtons"
                  logId="picker_dismiss"
                  style={styles.backdropTouch}
                  activeOpacity={1}
                  onPress={() => setShowDateTimePicker(false)}
                />
                <SafeAreaView style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]} edges={['bottom', 'left', 'right']}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {pickerMode === "date" ? "Select Date" : "Select Time"}
                    </Text>
                    <View style={styles.modalHeaderButtons}>
                      <TrackedTouchableOpacity
                        logComponent="ActionButtons"
                        logId="picker_cancel"
                        style={styles.modalCancelButton}
                        onPress={() => setShowDateTimePicker(false)}
                      >
                        <Text style={styles.modalCancelText}>Cancel</Text>
                      </TrackedTouchableOpacity>
                      {pickerMode === "time" && (
                        <TrackedTouchableOpacity
                          logComponent="ActionButtons"
                          logId="picker_done"
                          style={styles.modalConfirmButton}
                          onPress={handleTimePickerConfirm}
                        >
                          <Text style={styles.modalConfirmText}>Done</Text>
                        </TrackedTouchableOpacity>
                      )}
                    </View>
                  </View>
                  <DateTimePicker
                    value={pickerMode === "date" ? selectedDate : selectedTime}
                    mode={pickerMode}
                    is24Hour={false}
                    display="spinner"
                    onChange={handleDateTimePickerChange}
                    minimumDate={new Date()}
                    style={styles.dateTimePicker}
                  />
                </SafeAreaView>
              </View>
            </Modal>
          ) : (
            <DateTimePicker
              value={pickerMode === "date" ? selectedDate : selectedTime}
              mode={pickerMode}
              is24Hour={false}
              display="default"
              onChange={handleDateTimePickerChange}
              minimumDate={new Date()}
            />
          )}
        </>
      )}

      {/* Top Row: Schedule Button + Share/Bookmark Button */}

      {/* Opening Hours Section */}
      {parsedOpeningHours && (
        <View style={styles.openingHoursSection}>
          <View style={styles.openingHoursHeader}>
            <Icon name="time" size={18} color="#ea580c" />
            <Text style={styles.openingHoursTitle}>Opening Hours</Text>
            {liveOpenStatus !== null && (
              <View style={[
                styles.openNowBadge,
                liveOpenStatus ? styles.openNowBadgeOpen : styles.openNowBadgeClosed,
              ]}>
                <View style={[
                  styles.openNowDot,
                  liveOpenStatus ? styles.openNowDotOpen : styles.openNowDotClosed,
                ]} />
                <Text style={[
                  styles.openNowText,
                  liveOpenStatus ? styles.openNowTextOpen : styles.openNowTextClosed,
                ]}>
                  {liveOpenStatus ? "Open Now" : "Closed"}
                </Text>
              </View>
            )}
          </View>
          {parsedOpeningHours.lines.map((line: string, index: number) => {
            const isToday = line.startsWith(todayDayName);
            // Show today always, show others only when expanded
            if (!showAllHours && !isToday) return null;
            return (
              <View key={index} style={[
                styles.openingHoursRow,
                isToday && styles.openingHoursRowToday,
              ]}>
                {isToday && <View style={styles.todayIndicator} />}
                <Text style={[
                  styles.openingHoursText,
                  isToday && styles.openingHoursTextToday,
                ]}>{line}</Text>
              </View>
            );
          })}
          {parsedOpeningHours.lines.length > 1 && (
            <TrackedTouchableOpacity logComponent="ActionButtons" logId="toggle_hours" onPress={() => setShowAllHours(!showAllHours)} style={styles.showAllHoursButton}>
              <Text style={styles.showAllHoursText}>
                {showAllHours ? "Show less" : "Show all hours"}
              </Text>
              <Icon name={showAllHours ? "chevron-up" : "chevron-down"} size={14} color="#ea580c" />
            </TrackedTouchableOpacity>
          )}
        </View>
      )}

      {/* Action Buttons Row: Save + Schedule + Share */}
      <View style={styles.topRow}>
        {/* Save Button */}
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="save"
          style={[
            styles.saveButton,
            (isSaving || isSaved) && styles.actionButtonDisabled,
          ]}
          onPress={handleSave}
          activeOpacity={0.7}
          disabled={isSaving || isSaved}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Icon
                name={isSaved ? "bookmark" : "bookmark-outline"}
                size={20}
                color="#ffffff"
              />
              <Text style={styles.saveButtonText}>
                {isSaved ? "Saved" : "Save"}
              </Text>
            </>
          )}
        </TrackedTouchableOpacity>

        {/* Schedule Button */}
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="schedule"
          style={[
            styles.scheduleButton,
            (isScheduling || isScheduled) && styles.scheduleButtonDisabled,
          ]}
          onPress={handleSchedule}
          activeOpacity={0.7}
          disabled={isScheduling || isScheduled}
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Icon
                name={isScheduled ? "checkmark-circle" : "calendar-outline"}
                size={20}
                color="#ffffff"
              />
              <Text style={styles.scheduleButtonText}>
                {isScheduled ? "Scheduled" : "Schedule"}
              </Text>
            </>
          )}
        </TrackedTouchableOpacity>

        {/* Share Button */}
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="share"
          style={styles.shareIconButton}
          onPress={handleShare}
          activeOpacity={0.7}
        >
          <Icon name="share-outline" size={20} color="#6b7280" />
        </TrackedTouchableOpacity>
      </View>

      {/* Policies & Reservations — all categories with website or placeId */}
      {showPoliciesButton && (
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="policies"
          style={styles.policiesButton}
          onPress={handlePoliciesAndReservations}
          activeOpacity={0.8}
        >
          <Icon name="globe-outline" size={18} color="#ffffff" />
          <Text style={styles.policiesButtonText}>
            Policies & Reservations
          </Text>
        </TrackedTouchableOpacity>
      )}

      {/* Visit Button */}
      {showVisitButton && (
        <Animated.View style={{ transform: [{ scale: visitScaleAnim }] }}>
          <TrackedTouchableOpacity
            logComponent="ActionButtons"
            logId="visit"
            style={[
              styles.visitButton,
              isVisited && styles.visitButtonVisited,
              isVisitLoading && styles.visitButtonLoading,
            ]}
            onPress={handleVisitPress}
            activeOpacity={0.7}
            disabled={isVisitLoading}
            accessibilityLabel={
              isVisited
                ? "You visited this place"
                : "Mark this place as visited"
            }
            accessibilityHint={
              isVisited
                ? "Tap to remove your visit marker"
                : "Records your visit and opens the review flow"
            }
          >
            {isVisitLoading ? (
              <>
                <ActivityIndicator size="small" color="#9ca3af" />
                <Text style={styles.visitButtonTextLoading}>On it...</Text>
              </>
            ) : isVisited ? (
              <>
                <Icon
                  name="checkmark-circle"
                  size={20}
                  color="#16a34a"
                />
                <Text style={styles.visitButtonTextVisited}>
                  Been there ✓
                </Text>
              </>
            ) : (
              <>
                <Icon
                  name="checkmark-circle-outline"
                  size={20}
                  color="#9ca3af"
                />
                <Text style={styles.visitButtonTextDefault}>I went here</Text>
              </>
            )}
          </TrackedTouchableOpacity>
        </Animated.View>
      )}

      {/* Availability Messages */}
      {hasCheckedAvailability &&
        availabilityCheck &&
        !availabilityCheck.isOpen &&
        !availabilityCheck.isAssumption && (
          <View style={styles.closedMessageContainer}>
            <Icon name="alert-circle" size={16} color="#9a3412" />
            <Text style={styles.closedMessage}>
              This place is closed at the selected date and time. Tap "Schedule" to choose a different time.
            </Text>
          </View>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  saveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366F1",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  scheduleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  scheduleButtonDisabled: {
    opacity: 0.6,
    backgroundColor: "#eb7825",
  },
  scheduleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  shareIconButton: {
    width: 48,
    height: 48,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  policiesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f2937",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  policiesButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 15,
    color: "#6b7280",
    fontWeight: "500",
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
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
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
    color: "#6b7280",
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
  closedMessageContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  closedMessage: {
    flex: 1,
    fontSize: 13,
    color: "#9a3412",
    fontWeight: "500",
    lineHeight: 18,
  },
  warningMessageContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  warningMessage: {
    flex: 1,
    fontSize: 13,
    color: "#9a3412",
    fontWeight: "500",
    lineHeight: 18,
  },
  visitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  visitButtonVisited: {
    backgroundColor: "#f0fdf4",
    borderColor: "#22c55e",
  },
  visitButtonLoading: {
    borderColor: "#e5e7eb",
  },
  visitButtonTextDefault: {
    fontSize: 15,
    fontWeight: "600",
    color: "#4b5563",
  },
  visitButtonTextLoading: {
    fontSize: 15,
    fontWeight: "600",
    color: "#9ca3af",
  },
  visitButtonTextVisited: {
    fontSize: 15,
    fontWeight: "600",
    color: "#15803d",
  },
  openingHoursSection: {
    backgroundColor: "#eb78251a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 14,
    marginBottom: 16,
  },
  openingHoursHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  openingHoursTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333333",
    flex: 1,
  },
  openNowBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5,
  },
  openNowBadgeOpen: {
    backgroundColor: "#fff7ed",
  },
  openNowBadgeClosed: {
    backgroundColor: "#fef2f2",
  },
  openNowDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  openNowDotOpen: {
    backgroundColor: "#eb7825",
  },
  openNowDotClosed: {
    backgroundColor: "#ef4444",
  },
  openNowText: {
    fontSize: 12,
    fontWeight: "600",
  },
  openNowTextOpen: {
    color: "#9a3412",
  },
  openNowTextClosed: {
    color: "#991b1b",
  },
  openingHoursRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  openingHoursRowToday: {
    backgroundColor: "#fff7ed",
  },
  todayIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ea580c",
    marginRight: 8,
  },
  openingHoursText: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 20,
  },
  openingHoursTextToday: {
    fontWeight: "700",
    color: "#9a3412",
  },
  showAllHoursButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    gap: 4,
  },
  showAllHoursText: {
    fontSize: 13,
    color: "#ea580c",
    fontWeight: "600",
  },
});
