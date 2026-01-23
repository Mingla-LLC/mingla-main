import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import DateOptionsGrid from "./DateOptionsGrid";
import WeekendDaySelection from "./WeekendDaySelection";
import ProposeDateTimeFooter from "./ProposeDateTimeFooter";

interface SavedCard {
  id: string;
  title: string;
  [key: string]: any;
}

interface ProposeDateTimeModalProps {
  visible: boolean;
  onClose: () => void;
  card: SavedCard | null;
  currentScheduledDate?: Date | string | null;
  onProposeDateTime: (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom",
  ) => void;
}

export default function ProposeDateTimeModal({
  visible,
  onClose,
  card,
  currentScheduledDate,
  onProposeDateTime,
}: ProposeDateTimeModalProps) {
  const [selectedDateOption, setSelectedDateOption] = useState<
    "now" | "today" | "weekend" | "custom" | null
  >(null);
  const [selectedWeekendDay, setSelectedWeekendDay] = useState<
    "saturday" | "sunday" | null
  >(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [customTime, setCustomTime] = useState<Date | null>(null);
  const [isAvailabilityChecked, setIsAvailabilityChecked] = useState(false);
  const [isPlaceOpen, setIsPlaceOpen] = useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [proposedDateTime, setProposedDateTime] = useState<Date | null>(null);
  const [availabilityAssumption, setAvailabilityAssumption] = useState<
    string | null
  >(null);

  const handleDateOptionSelect = (
    option: "now" | "today" | "weekend" | "custom",
  ) => {
    setSelectedDateOption(option);
    setSelectedWeekendDay(null); // Reset weekend day selection
    setIsAvailabilityChecked(false); // Reset availability check when option changes
    setIsPlaceOpen(false);
    setProposedDateTime(null);
    setAvailabilityAssumption(null);

    if (option === "custom") {
      setShowDatePicker(true);
    } else if (option === "today") {
      // Show time picker immediately for "today"
      setShowTimePicker(true);
    }
    // For "now" - wait for "Check Compatibility" button
    // For "weekend" - show weekend day selection buttons
  };

  const handleWeekendDaySelect = (day: "saturday" | "sunday") => {
    setSelectedWeekendDay(day);
    setIsAvailabilityChecked(false); // Reset availability check when day changes
    setIsPlaceOpen(false);
    setProposedDateTime(null);
    setAvailabilityAssumption(null);
    // Show time picker after selecting weekend day
    setShowTimePicker(true);
  };

  const calculateProposedDateTime = (): Date | null => {
    if (!selectedDateOption) return null;

    const now = new Date();

    switch (selectedDateOption) {
      case "now":
        return now;
      case "today":
        // Use selected time
        const today = new Date(now);
        if (customTime) {
          today.setHours(customTime.getHours());
          today.setMinutes(customTime.getMinutes());
        } else {
          // Default to current time if no time selected
          return now;
        }
        return today;
      case "weekend":
        if (!selectedWeekendDay) return null;
        // Calculate the selected day's date
        const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
        let daysToAdd = 0;

        if (selectedWeekendDay === "saturday") {
          daysToAdd = dayOfWeek === 0 ? 6 : (6 - dayOfWeek + 7) % 7 || 7;
        } else {
          // Sunday
          daysToAdd = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
        }

        const weekendDate = new Date(now);
        weekendDate.setDate(now.getDate() + daysToAdd);
        if (customTime) {
          weekendDate.setHours(customTime.getHours());
          weekendDate.setMinutes(customTime.getMinutes());
        } else {
          // Default to 2 PM if no time selected
          weekendDate.setHours(14, 0, 0, 0);
        }
        return weekendDate;
      case "custom":
        // Use custom date and time
        const combinedDateTime = new Date(customDate);
        if (customTime) {
          combinedDateTime.setHours(customTime.getHours());
          combinedDateTime.setMinutes(customTime.getMinutes());
        } else {
          // Default to noon if no time selected
          combinedDateTime.setHours(12, 0, 0, 0);
        }
        return combinedDateTime;
      default:
        return null;
    }
  };

  const parseTimeString = (timeStr: string): number => {
    // Parse time string like "9:00 AM" or "12:00 AM" to minutes since midnight
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

  const checkPlaceAvailability = (
    dateToCheck: Date | null = null,
  ): {
    isOpen: boolean;
    isAssumption: boolean;
    reason?: string;
  } => {
    const date = dateToCheck || proposedDateTime;

    if (!card || !date) {
      return {
        isOpen: true,
        isAssumption: true,
        reason: "No card or time selected",
      };
    }

    let openingHours = (card as any).openingHours;

    // If openingHours is a string, parse it to an object
    if (typeof openingHours === "string") {
      try {
        openingHours = JSON.parse(openingHours);
        console.log("Parsed openingHours from string:", openingHours);
      } catch (error) {
        console.error("Failed to parse openingHours string:", error);
        return {
          isOpen: true,
          isAssumption: true,
          reason: "Invalid opening hours data format",
        };
      }
    }

    // If no opening hours data, assume open (user schedules at own risk)
    if (
      !openingHours ||
      openingHours === null ||
      typeof openingHours !== "object"
    ) {
      return {
        isOpen: true,
        isAssumption: true,
        reason: "Opening hours data not available",
      };
    }

    // Get the day of the week from date (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = date.getDay();
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
      console.log("Failed to parse dayHours:", dayHours);
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
    const selectedHours = date.getHours();
    const selectedMinutes = date.getMinutes();
    const selectedTimeMinutes = selectedHours * 60 + selectedMinutes;

    // Handle case where closing time is midnight (12:00 AM) - it means it closes at end of day
    // If closeTimeMinutes is 0 (midnight), it means the place closes at midnight (end of current day)
    if (closeTimeMinutes === 0) {
      // Place closes at midnight, so check if selected time is after opening time
      const isOpen = selectedTimeMinutes >= openTimeMinutes;
      return {
        isOpen,
        isAssumption: false,
      };
    }

    // Normal case: check if selected time is within the range
    if (openTimeMinutes < closeTimeMinutes) {
      // Normal case: opening and closing on same day (e.g., 9 AM - 6 PM)
      const isOpen =
        selectedTimeMinutes >= openTimeMinutes &&
        selectedTimeMinutes < closeTimeMinutes;
      return {
        isOpen,
        isAssumption: false,
      };
    } else {
      // Opening time is after closing time (e.g., 9 PM - 2 AM) - spans midnight
      // This means it's open from openTime to midnight, then from midnight to closeTime
      const isOpen =
        selectedTimeMinutes >= openTimeMinutes ||
        selectedTimeMinutes < closeTimeMinutes;
      return {
        isOpen,
        isAssumption: false,
      };
    }
  };

  const handleDatePickerChange = (event: any, date?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }

    if (date) {
      setCustomDate(date);
      setIsAvailabilityChecked(false); // Reset availability check when date changes
      setIsPlaceOpen(false);
      setProposedDateTime(null);
      setAvailabilityAssumption(null);
      if (Platform.OS === "ios") {
        // On iOS, show time picker after date is selected
        setShowTimePicker(true);
      } else {
        // On Android, show time picker immediately
        setShowTimePicker(true);
      }
    }
  };

  const handleTimePickerChange = (event: any, time?: Date) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }

    if (time) {
      setCustomTime(time);
      setIsAvailabilityChecked(false); // Reset availability check when time changes
      setIsPlaceOpen(false);
      setProposedDateTime(null);
      setAvailabilityAssumption(null);

      if (Platform.OS === "ios") {
        setShowTimePicker(false);
      }
      // Don't schedule immediately - wait for "Check Availability" button
    }
  };

  const handleCheckCompatibility = async () => {
    if (!selectedDateOption) return;

    // Validate that required selections are made
    if (selectedDateOption === "weekend" && !selectedWeekendDay) {
      return; // Can't check availability without selecting a day
    }

    if (selectedDateOption === "custom" && !customDate) {
      return; // Can't check availability without selecting a date
    }

    // For options that require time selection, ensure time is selected
    if (
      (selectedDateOption === "today" ||
        selectedDateOption === "weekend" ||
        selectedDateOption === "custom") &&
      !customTime
    ) {
      // Time picker should have been shown, but if somehow time wasn't selected, return
      return;
    }

    setIsCheckingAvailability(true);

    // Calculate the proposed date/time
    const proposedDate = calculateProposedDateTime();
    if (!proposedDate) {
      setIsCheckingAvailability(false);
      return;
    }

    setProposedDateTime(proposedDate);

    // Simulate async availability check (in real app, this might call an API)
    // For now, we'll check if the place is currently open
    setTimeout(() => {
      const result = checkPlaceAvailability(proposedDate);
      setIsPlaceOpen(result.isOpen);
      setAvailabilityAssumption(
        result.isAssumption ? result.reason || "Availability assumed" : null,
      );
      setIsAvailabilityChecked(true);
      setIsCheckingAvailability(false);
    }, 500);
  };

  const handleSchedule = () => {
    if (!proposedDateTime || !selectedDateOption) return;

    // Schedule the card with the proposed date/time
    onProposeDateTime(proposedDateTime, selectedDateOption);
  };

  const formatDate = (dateStr: Date | string): string => {
    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: Date | string): string => {
    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const resetModal = () => {
    setSelectedDateOption(null);
    setSelectedWeekendDay(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setCustomDate(new Date());
    setCustomTime(null);
    setIsAvailabilityChecked(false);
    setIsPlaceOpen(false);
    setIsCheckingAvailability(false);
    setProposedDateTime(null);
    setAvailabilityAssumption(null);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleClose}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={handleClose}
        >
          <TouchableOpacity
            style={styles.modalContainer}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Ionicons name="calendar" size={24} color="white" />
                <View style={styles.headerTextContainer}>
                  <Text style={styles.headerTitle}>
                    Propose New Date & Time
                  </Text>
                  {card && (
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                      {card.title}
                    </Text>
                  )}
                </View>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color="white" />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <View style={styles.content}>
              {/* Current Scheduled Date & Time Section */}
              {currentScheduledDate && (
                <View style={styles.currentScheduleSection}>
                  <View style={styles.currentScheduleHeader}>
                    <Ionicons name="calendar" size={20} color="#ea580c" />
                    <Text style={styles.currentScheduleTitle}>
                      Current Scheduled Date & Time
                    </Text>
                  </View>
                  <View style={styles.currentScheduleItem}>
                    <Ionicons
                      name="calendar-outline"
                      size={18}
                      color="#ea580c"
                    />
                    <View style={styles.currentScheduleItemContent}>
                      <Text style={styles.currentScheduleLabel}>
                        Scheduled For
                      </Text>
                      <Text style={styles.currentScheduleValue}>
                        {formatDate(currentScheduledDate)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.currentScheduleItem}>
                    <Ionicons name="time-outline" size={18} color="#ea580c" />
                    <View style={styles.currentScheduleItemContent}>
                      <Text style={styles.currentScheduleLabel}>Time</Text>
                      <Text style={styles.currentScheduleValue}>
                        {formatTime(currentScheduledDate)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Propose New Schedule Section */}
              <View style={styles.proposeSection}>
                <Text style={styles.proposeTitle}>Propose New Schedule</Text>
                <Text style={styles.dateLabel}>Date</Text>
                <DateOptionsGrid
                  selectedDateOption={selectedDateOption}
                  onSelectOption={handleDateOptionSelect}
                />

                {/* Weekend Day Selection */}
                {selectedDateOption === "weekend" && (
                  <WeekendDaySelection
                    selectedWeekendDay={selectedWeekendDay}
                    onSelectDay={handleWeekendDaySelect}
                  />
                )}

                {/* Availability Status Message */}
                {isAvailabilityChecked && !isPlaceOpen && (
                  <View style={styles.availabilityMessage}>
                    <Ionicons name="warning" size={20} color="#ef4444" />
                    <Text style={styles.availabilityMessageText}>
                      This place is currently closed. Please select a different
                      time.
                    </Text>
                  </View>
                )}

                {/* Assumption Warning Message */}
                {isAvailabilityChecked &&
                  isPlaceOpen &&
                  availabilityAssumption && (
                    <View style={styles.assumptionWarning}>
                      <Ionicons
                        name="information-circle"
                        size={20}
                        color="#f59e0b"
                      />
                      <Text style={styles.assumptionWarningText}>
                        {availabilityAssumption}. Please verify opening hours
                        before scheduling.
                      </Text>
                    </View>
                  )}
              </View>
            </View>

            {/* Footer Button */}
            <ProposeDateTimeFooter
              selectedDateOption={selectedDateOption}
              selectedWeekendDay={selectedWeekendDay}
              isAvailabilityChecked={isAvailabilityChecked}
              isPlaceOpen={isPlaceOpen}
              isCheckingAvailability={isCheckingAvailability}
              onCheckAvailability={handleCheckCompatibility}
              onSchedule={handleSchedule}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Date Picker */}
      {showDatePicker && (
        <DateTimePicker
          value={customDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDatePickerChange}
          minimumDate={new Date()}
        />
      )}

      {/* Time Picker */}
      {showTimePicker && (
        <DateTimePicker
          value={customTime || new Date()}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleTimePickerChange}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 20,
    width: "100%",
    maxWidth: 400,
    maxHeight: "90%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    backgroundColor: "#ea580c",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 16,
  },
  headerTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "white",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "white",
    opacity: 0.9,
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 20,
    backgroundColor: "white",
  },
  currentScheduleSection: {
    backgroundColor: "#fdf8f5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fbe8d9",
    padding: 16,
    marginBottom: 24,
  },
  currentScheduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  currentScheduleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333333",
    marginLeft: 8,
  },
  currentScheduleItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fdf8f5",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fbe8d9",
    padding: 12,
    marginBottom: 8,
  },
  currentScheduleItemContent: {
    marginLeft: 12,
    flex: 1,
  },
  currentScheduleLabel: {
    fontSize: 13,
    color: "#666666",
    marginBottom: 4,
  },
  currentScheduleValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333333",
  },
  proposeSection: {
    width: "100%",
  },
  proposeTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 16,
    textAlign: "center",
  },
  dateLabel: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 12,
  },
  dateOptionsGrid: {
    flexDirection: "column",
    gap: 12,
    width: "100%",
  },
  dateOptionsRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  dateOption: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dateOptionSelected: {
    backgroundColor: "#fef3c7",
    borderColor: "#ea580c",
    borderWidth: 2,
  },
  dateOptionText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1f2937",
  },
  dateOptionTextSelected: {
    color: "#ea580c",
    fontWeight: "600",
  },
  availabilityMessage: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  availabilityMessageText: {
    flex: 1,
    fontSize: 14,
    color: "#991b1b",
    fontWeight: "500",
  },
  assumptionWarning: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  assumptionWarningText: {
    flex: 1,
    fontSize: 14,
    color: "#92400e",
    fontWeight: "500",
  },
});
