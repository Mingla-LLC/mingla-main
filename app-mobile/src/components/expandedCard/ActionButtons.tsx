import React, { useState, useMemo } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ExpandedCardData, BookingOption } from "../../types/expandedCardTypes";
import { savedCardsService } from "../../services/savedCardsService";
import { CalendarService } from "../../services/calendarService";
import { useAppStore } from "../../store/appStore";
import { useCalendarEntries } from "../../hooks/useCalendarEntries";
import { toastManager } from "../ui/Toast";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";

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
}: ActionButtonsProps) {
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
        !entry.archived_at
    );
  }, [calendarEntries, card.id]);

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
    dateToCheck: Date
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

    const openingHours = card.openingHours;

    // If no opening hours data, assume open (user schedules at own risk)
    if (
      !openingHours ||
      typeof openingHours !== "object" ||
      openingHours === null ||
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
    const dayHours = openingHours.weekday_text.find((entry: string) =>
      entry.startsWith(selectedDayName)
    );

    if (!dayHours) {
      // No hours found for this day, assume closed
      return {
        isOpen: false,
        isAssumption: false,
      };
    }

    // Parse the time range (e.g., "Monday: 9:00 AM – 12:00 AM")
    const timeRangeMatch = dayHours.match(/:\s*(.+?)\s*–\s*(.+)$/);
    if (!timeRangeMatch) {
      // Can't parse the time range, assume open
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

  const handleSave = async () => {
    if (isSaving) return; // Prevent multiple saves

    setIsSaving(true);
    try {
      // onSave will handle saving, moving to next card, and closing modal
      await onSave(card);
    } catch (error: any) {
      // Error saving - show alert but don't close modal
      // (onSave already handles 23505 "already saved" case and closes modal)
      Alert.alert("Error", "Failed to save the card. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSchedule = () => {
    if (isScheduling || isScheduled || !user?.id) return;

    // If we have a selected date/time and availability was checked, proceed with scheduling
    if (selectedDateTime && availabilityCheck) {
      if (availabilityCheck.isOpen) {
        // Place is open at selected time, proceed with scheduling
        proceedWithScheduling(selectedDateTime);
        return;
      } else {
        // Place is closed, reset and show picker again
        setSelectedDateTime(null);
        setAvailabilityCheck(null);
      }
    }

    // Reset availability check when showing picker
    setAvailabilityCheck(null);
    setSelectedDateTime(null);

    // Show date/time picker
    // Initialize with current date and time
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

          // Check availability
          const availability = checkPlaceAvailability(combinedDateTime);
          setAvailabilityCheck(availability);

          // If open, proceed with scheduling
          if (availability.isOpen) {
            proceedWithScheduling(combinedDateTime);
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

    // Check availability
    const availability = checkPlaceAvailability(combinedDateTime);
    setAvailabilityCheck(availability);

    // If open, proceed with scheduling
    if (availability.isOpen) {
      proceedWithScheduling(combinedDateTime);
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
      const scheduledDateISO = scheduledDateTime.toISOString();

      // Determine source based on current mode
      const source: "solo" | "collaboration" =
        currentMode === "solo" ? "solo" : "collaboration";

      // If the card is saved, remove it from saved_cards table when scheduling
      if (isSaved) {
        try {
          // Use currentMode to determine source instead of card.source
          console.log(
            "Removing card from saved_cards service",
            user.id,
            card.id,
            source
          );
          await savedCardsService.removeCard(user.id, card.id, source);
          // Invalidate savedCards query to refresh the list
          queryClient.invalidateQueries({ queryKey: ["savedCards", user.id] });
        } catch (error) {
          // Log error but don't block scheduling
          console.error(
            "Error removing card from saved_cards when scheduling:",
            error
          );
        }
      }

      // Prepare card data with source
      const cardWithSource = {
        ...card,
        source,
      };

      // Add to calendar in Supabase (lockedIn)
      const record = await CalendarService.addEntryFromSavedCard(
        user.id,
        cardWithSource,
        scheduledDateISO
      );

      // Invalidate calendar entries query to refresh after adding to lockedIn
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // Add to device calendar
      try {
        const deviceEvent = DeviceCalendarService.createEventFromCard(
          card,
          scheduledDateTime,
          record.duration_minutes || 120
        );
        await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
      } catch (deviceCalendarError) {
        // Don't fail the whole operation if device calendar fails
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Show success toast
      toastManager.success(
        `Scheduled! ${card.title} has been moved to your calendar`,
        3000
      );

      // Remove card from deck if callback is provided
      if (onCardRemoved) {
        onCardRemoved(card.id);
      }

      // Close modal only on success
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error("Error scheduling card:", error);
      Alert.alert(
        "Schedule failed",
        "We couldn't add this to your calendar. Please try again."
      );
    } finally {
      setIsScheduling(false);
    }
  };

  const handleBuyNow = () => {
    if (bookingOptions.length > 0) {
      const primaryOption = bookingOptions[0];
      if (onPurchase) {
        onPurchase(card, primaryOption);
      } else if (primaryOption.url) {
        // Open booking URL
        Linking.openURL(primaryOption.url);
      } else if (primaryOption.phone) {
        // Open phone dialer
        Linking.openURL(`tel:${primaryOption.phone.replace(/[^0-9+]/g, "")}`);
      } else {
        Alert.alert("Booking", primaryOption.message);
      }
    } else if (card.website) {
      // Fallback to website
      let url = card.website;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }
      Linking.openURL(url);
    } else if (card.phone) {
      // Fallback to phone
      Linking.openURL(`tel:${card.phone.replace(/[^0-9+]/g, "")}`);
    } else {
      Alert.alert(
        "Booking",
        "Booking options are not available for this experience"
      );
    }
  };

  const handleShare = () => {
    if (onShare) {
      onShare(card);
    } else {
      Alert.alert("Share", `Share ${card.title} with friends`);
    }
  };

  const handleNavigateFullRoute = () => {
    // Check if this is a stroll card with route data
    if (card.strollData?.timeline && card.strollData.timeline.length > 0) {
      const timeline = card.strollData.timeline;

      // Collect all waypoints with valid locations
      const waypoints: string[] = [];

      timeline.forEach((step) => {
        if (step.location) {
          if (step.location.lat && step.location.lng) {
            waypoints.push(`${step.location.lat},${step.location.lng}`);
          } else if (step.location.address) {
            // Use address if coordinates not available
            waypoints.push(encodeURIComponent(step.location.address));
          } else if (step.location.name) {
            // Use name as fallback
            waypoints.push(encodeURIComponent(step.location.name));
          }
        }
      });

      // If we have waypoints, create a Google Maps directions URL
      if (waypoints.length > 0) {
        // Use the first waypoint as origin and last as destination
        const origin = waypoints[0];
        const destination = waypoints[waypoints.length - 1];
        const intermediateWaypoints = waypoints.slice(1, -1);

        // Build Google Maps directions URL
        let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;

        if (intermediateWaypoints.length > 0) {
          // Google Maps supports up to 25 waypoints
          const waypointStr = intermediateWaypoints.join("|");
          url += `&waypoints=${waypointStr}`;
        }

        Linking.openURL(url).catch((err) => {
          console.error("Error opening maps:", err);
          Alert.alert("Error", "Could not open maps application");
        });
      } else {
        // Fallback to main card location
        if (card.location) {
          const url = `https://www.google.com/maps/search/?api=1&query=${card.location.lat},${card.location.lng}`;
          Linking.openURL(url).catch((err) => {
            console.error("Error opening maps:", err);
            Alert.alert("Error", "Could not open maps application");
          });
        } else {
          Alert.alert(
            "Navigation",
            "Location data not available for this route"
          );
        }
      }
    } else {
      // For non-stroll cards, navigate to the address
      if (card.address) {
        const encodedAddress = encodeURIComponent(card.address);
        const url = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        Linking.openURL(url).catch((err) => {
          console.error("Error opening maps:", err);
          Alert.alert("Error", "Could not open maps application");
        });
      } else if (card.location) {
        // Fallback to coordinates if address not available
        const url = `https://www.google.com/maps/search/?api=1&query=${card.location.lat},${card.location.lng}`;
        Linking.openURL(url).catch((err) => {
          console.error("Error opening maps:", err);
          Alert.alert("Error", "Could not open maps application");
        });
      } else {
        Alert.alert("Navigation", "Location data not available");
      }
    }
  };

  const hasBookingOptions =
    bookingOptions.length > 0 || card.website || card.phone;

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
                <SafeAreaView style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {pickerMode === "date" ? "Select Date" : "Select Time"}
                    </Text>
                    <View style={styles.modalHeaderButtons}>
                      <TouchableOpacity
                        style={styles.modalCancelButton}
                        onPress={() => setShowDateTimePicker(false)}
                      >
                        <Text style={styles.modalCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      {pickerMode === "time" && (
                        <TouchableOpacity
                          style={styles.modalConfirmButton}
                          onPress={handleTimePickerConfirm}
                        >
                          <Text style={styles.modalConfirmText}>Done</Text>
                        </TouchableOpacity>
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
      <View style={styles.topRow}>
        <View style={styles.scheduleButtonContainer}>
          <TouchableOpacity
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
                <Ionicons
                  name={isScheduled ? "checkmark-circle" : "calendar-outline"}
                  size={20}
                  color="#ffffff"
                />
                <Text style={styles.scheduleButtonText}>
                  {isScheduled ? "Scheduled" : "Schedule"}
                </Text>
              </>
            )}
          </TouchableOpacity>
          {availabilityCheck && !availabilityCheck.isOpen && (
            <Text style={styles.closedMessage}>
              This place is closed at the selected date and time. Please choose
              a different time.
            </Text>
          )}
          {availabilityCheck && availabilityCheck.isAssumption && (
            <Text style={styles.warningMessage}>
              {availabilityCheck.reason ||
                "Opening hours data not available - schedule at your own risk"}
            </Text>
          )}
        </View>

        {/* Share and Bookmark Button */}
        <View style={styles.iconButtonsContainer}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleShare}
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={18} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, isSaved && styles.iconButtonSaved]}
            onPress={handleSave}
            activeOpacity={0.7}
            disabled={isSaving || isSaved}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#eb7825" />
            ) : (
              <Ionicons
                name={isSaved ? "bookmark" : "bookmark-outline"}
                size={18}
                color={isSaved ? "#eb7825" : "#6b7280"}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Navigate Full Route Button - Available for all cards */}
      <TouchableOpacity
        style={styles.navigateButton}
        onPress={handleNavigateFullRoute}
        activeOpacity={0.7}
      >
        <Ionicons name="paper-plane" size={20} color="#ffffff" />
        <Text style={styles.navigateButtonText}>Navigate Full Route</Text>
        <Ionicons name="open-outline" size={16} color="#ffffff" />
      </TouchableOpacity>

      {/* Buy Now Button - Full Width */}
      {hasBookingOptions && (
        <TouchableOpacity
          style={styles.buyNowButton}
          onPress={handleBuyNow}
          activeOpacity={0.8}
        >
          <Ionicons name="card" size={20} color="#ffffff" />
          <Text style={styles.buyNowButtonText}>Buy Now</Text>
          {bookingOptions.length > 0 && (
            <View style={styles.bookingBadge}>
              <Text style={styles.bookingBadgeText}>
                {bookingOptions[0].provider === "opentable"
                  ? "Reserve"
                  : bookingOptions[0].provider === "eventbrite"
                  ? "Get Tickets"
                  : bookingOptions[0].provider === "viator"
                  ? "Book"
                  : "Book Now"}
              </Text>
            </View>
          )}
        </TouchableOpacity>
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
  scheduleButtonContainer: {
    flex: 1,
    gap: 6,
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
  iconButtonsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  iconButton: {
    width: 48,
    height: 48,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonSaved: {
    opacity: 0.6,
  },
  navigateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  navigateButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  buyNowButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    position: "relative",
  },
  buyNowButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  bookingBadge: {
    position: "absolute",
    top: 8,
    right: 12,
    backgroundColor: "#eb7825",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bookingBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
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
  closedMessage: {
    fontSize: 12,
    color: "#ef4444",
    textAlign: "center",
    marginTop: 4,
    fontWeight: "500",
  },
  warningMessage: {
    fontSize: 12,
    color: "#f59e0b",
    textAlign: "center",
    marginTop: 4,
    fontWeight: "500",
  },
});
