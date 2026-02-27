import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar } from "../ui/calendar";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";

interface DateTimePrefStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  dateTimePref:
    | string
    | {
        dateOption?: string;
        timeSlot?: string;
        selectedDate?: string;
        weekendDay?: string;
      }
    | null;
  onDateTimePrefChange: (pref: {
    dateOption: string;
    timeSlot?: string;
    selectedDate?: string;
    weekendDay?: string;
    exactTime?: string;
  }) => void;
}

type DateOption = "Now" | "Today" | "This Weekend" | "Pick a Date";
type TimeSlot = "brunch" | "afternoon" | "dinner" | "lateNight";
type WeekendDay = "saturday" | "sunday";

const DateTimePrefStep = ({
  onNext,
  onBack,
  dateTimePref,
  onDateTimePrefChange,
}: DateTimePrefStepProps) => {
  // Parse existing preference
  const parseDateTimePref = () => {
    if (!dateTimePref) {
      return {
        dateOption: null,
        timeSlot: null,
        selectedDate: null,
        weekendDay: null,
      };
    }
    if (typeof dateTimePref === "string") {
      // Legacy format - treat as "Now"
      return {
        dateOption: "Now",
        timeSlot: null,
        selectedDate: null,
        weekendDay: null,
      };
    }
    return {
      dateOption: dateTimePref.dateOption || null,
      timeSlot: dateTimePref.timeSlot || null,
      selectedDate: dateTimePref.selectedDate || null,
      weekendDay: dateTimePref.weekendDay || null,
      exactTime: (dateTimePref as any).exactTime || null,
    };
  };

  const [selectedDateOption, setSelectedDateOption] =
    useState<DateOption | null>(parseDateTimePref().dateOption as DateOption);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<TimeSlot | null>(
    parseDateTimePref().timeSlot as TimeSlot
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(
    parseDateTimePref().selectedDate
      ? new Date(parseDateTimePref().selectedDate!)
      : null
  );
  const [selectedWeekendDay, setSelectedWeekendDay] =
    useState<WeekendDay | null>(parseDateTimePref().weekendDay as WeekendDay);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedTime, setSelectedTime] = useState<Date>(() => {
    // Parse existing exactTime if available, otherwise default to current time
    const parsed = parseDateTimePref();
    if (parsed.exactTime) {
      const timeStr = parsed.exactTime;
      // Parse "HH:MM AM/PM" format
      const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const ampm = match[3].toUpperCase();
        let hour24 = hours;
        if (ampm === "PM" && hours !== 12) hour24 = hours + 12;
        if (ampm === "AM" && hours === 12) hour24 = 0;
        const date = new Date();
        date.setHours(hour24, minutes, 0, 0);
        return date;
      }
    }
    return new Date();
  });
  const [exactTime, setExactTime] = useState<string>(
    parseDateTimePref().exactTime || ""
  );
  const [isLoading, setIsLoading] = useState(false);

  // Track if this is initial mount to prevent loop on first render
  const isInitialMount = useRef(true);
  const lastProcessedValues = useRef<string | null>(null);
  const isInternalUpdate = useRef(false);

  // Update local state when prop changes (only from external changes, not our own updates)
  useEffect(() => {
    // Skip on initial mount - state is already initialized from parseDateTimePref()
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Store the initial values for comparison
      const initial = JSON.stringify(parseDateTimePref());
      lastProcessedValues.current = initial;
      return;
    }

    // Skip if this is an internal update (we just updated the parent)
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      // Still update lastProcessedValues to reflect the new state
      const current = JSON.stringify(parseDateTimePref());
      lastProcessedValues.current = current;
      return;
    }

    // Create a stable string representation for comparison
    const current = JSON.stringify(parseDateTimePref());

    // Only update if the values actually changed (not just reference)
    if (lastProcessedValues.current === current) {
      return; // Values are the same, no update needed
    }

    lastProcessedValues.current = current;
    const parsed = parseDateTimePref();

    // Update state - but only if values are actually different
    // This prevents loops when parent updates with same values
    setSelectedDateOption((prev) => {
      if (prev !== parsed.dateOption) return parsed.dateOption as DateOption;
      return prev;
    });
    setSelectedTimeSlot((prev) => {
      if (prev !== parsed.timeSlot) return parsed.timeSlot as TimeSlot;
      return prev;
    });
    setSelectedDate((prev) => {
      if (parsed.selectedDate) {
        const newDate = new Date(parsed.selectedDate);
        if (!prev || newDate.getTime() !== prev.getTime()) {
          return newDate;
        }
      } else if (prev !== null) {
        return null;
      }
      return prev;
    });
    setSelectedWeekendDay((prev) => {
      if (prev !== parsed.weekendDay) return parsed.weekendDay as WeekendDay;
      return prev;
    });
    setExactTime((prev) => {
      if (prev !== parsed.exactTime) {
        const timeStr = parsed.exactTime || "";
        // Update selectedTime if exactTime exists
        if (timeStr) {
          const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (match) {
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const ampm = match[3].toUpperCase();
            let hour24 = hours;
            if (ampm === "PM" && hours !== 12) hour24 = hours + 12;
            if (ampm === "AM" && hours === 12) hour24 = 0;
            const date = new Date();
            date.setHours(hour24, minutes, 0, 0);
            setSelectedTime(date);
          }
        }
        return timeStr;
      }
      return prev;
    });
  }, [dateTimePref]);

  const dateOptions: Array<{
    id: DateOption;
    label: string;
    description: string;
  }> = [
    { id: "Now", label: "Now", description: "Leave immediately" },
    {
      id: "Today",
      label: "Today",
      description: "Pick a time",
    },
    {
      id: "This Weekend",
      label: "This Weekend",
      description: "Fri-Sun",
    },
    {
      id: "Pick a Date",
      label: "Pick a Date",
      description: "Custom date",
    },
  ];

  const timeSlots: Array<{
    id: TimeSlot;
    label: string;
    time: string;
    startHour: number;
    endHour: number;
    icon: string;
  }> = [
    {
      id: "brunch",
      label: "Brunch",
      time: "11:00 AM - 1:00 PM",
      startHour: 11,
      endHour: 13,
      icon: "cafe",
    },
    {
      id: "afternoon",
      label: "Afternoon",
      time: "2:00 PM - 5:00 PM",
      startHour: 14,
      endHour: 17,
      icon: "sunny",
    },
    {
      id: "dinner",
      label: "Dinner",
      time: "6:00 PM - 9:00 PM",
      startHour: 18,
      endHour: 21,
      icon: "restaurant",
    },
    {
      id: "lateNight",
      label: "Late Night",
      time: "10:00 PM - 12:00 AM",
      startHour: 22,
      endHour: 24,
      icon: "moon",
    },
  ];

  const handleDateOptionSelect = (option: DateOption) => {
    setSelectedDateOption(option);
    // Reset dependent selections when changing date option
    if (option === "Now") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
      setSelectedWeekendDay(null);
      onDateTimePrefChange({ dateOption: option });
    } else if (option === "Today") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
      setSelectedWeekendDay(null);
    } else if (option === "This Weekend") {
      setSelectedTimeSlot(null);
      setSelectedDate(null);
      // Don't reset weekendDay for "This Weekend" - we'll handle it differently
    } else if (option === "Pick a Date") {
      setSelectedTimeSlot(null);
      setSelectedWeekendDay(null);
      // Don't automatically show calendar - user will click the input field
    }
  };

  const handleTimeSlotSelect = (slot: TimeSlot) => {
    // Update state immediately
    setSelectedTimeSlot(slot);
    // Clear exact time when a time slot is selected
    setExactTime("");
    // Pass the new values directly to updateParentPref to avoid stale state
    // This ensures the parent gets the new value immediately, not the old state value
    updateParentPref({ timeSlot: slot, exactTime: "" });
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
      // Clear time slot when exact time is selected
      setSelectedTimeSlot(null);
      // Pass the formatted time directly to ensure it's used immediately
      updateParentPref({ exactTime: formattedTime, timeSlot: null });
    }

    if (Platform.OS === "ios") {
      // On iOS, keep picker open until user confirms
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
    // Pass the formatted time directly to ensure it's used immediately
    updateParentPref({ exactTime: formattedTime, timeSlot: null });
  };

  const handleWeekendDaySelect = (day: WeekendDay) => {
    setSelectedWeekendDay(day);
    updateParentPref();
  };

  const handleCalendarDateSelect = (date: Date) => {
    setSelectedDate(date);
    setShowCalendar(false);
    updateParentPref();
  };

  const formatDateForDisplay = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const updateParentPref = (overrides?: {
    timeSlot?: TimeSlot | null;
    exactTime?: string;
  }) => {
    if (selectedDateOption) {
      // Mark that this is an internal update to prevent useEffect from overwriting our state
      isInternalUpdate.current = true;

      onDateTimePrefChange({
        dateOption: selectedDateOption,
        timeSlot:
          overrides?.timeSlot !== undefined
            ? overrides.timeSlot || undefined
            : selectedTimeSlot || undefined,
        selectedDate: selectedDate?.toISOString() || undefined,
        weekendDay: selectedWeekendDay || undefined,
        exactTime:
          overrides?.exactTime !== undefined
            ? overrides.exactTime
            : exactTime || undefined,
      });
    }
  };

  // Calculate weekend dates
  const getWeekendDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
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

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    progressSection: {
      paddingHorizontal: 24,
      /*       paddingTop: 8, */
      paddingBottom: 8,
    },
    progressBarContainer: {
      marginBottom: 8,
    },
    progressBar: {
      height: 4,
      backgroundColor: "#e5e7eb",
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: {
      height: 4,
      backgroundColor: "#eb7825",
      borderRadius: 2,
    },
    progressText: {
      fontSize: 12,
      color: "#6b7280",
      marginTop: 4,
      textAlign: "center",
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 120,
    },
    titleSection: {
      marginBottom: 32,
    },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      lineHeight: 22,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 16,
      textAlign: "left",
    },
    dateOptionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
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
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    dateOptionDescriptionSelected: {
      color: "#ffffff",
      opacity: 0.9,
    },
    instructionText: {
      fontSize: 14,
      color: "#9ca3af",
      marginTop: 8,
      textAlign: "center",
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
    quickPresetsLabel: {
      fontSize: 14,
      color: "#9ca3af",
      marginTop: 8,
      marginBottom: 12,
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
    timePicker: {
      width: "100%",
      height: 200,
    },
    modalConfirmButton: {
      fontSize: 16,
      color: "#eb7825",
      fontWeight: "600",
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
    calendarContainer: {
      marginTop: 16,
      borderRadius: 12,
      overflow: "hidden",
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
    navigationContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: "white",
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
    },
    backButton: {
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    backButtonText: {
      fontSize: 16,
      color: "#111827",
      fontWeight: "500",
    },
    nextButton: {
      backgroundColor: "#eb7825",
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 100,
    },
    nextButtonDisabled: {
      backgroundColor: "#e5e7eb",
    },
    nextButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 6,
    },
    nextButtonTextDisabled: {
      color: "#9ca3af",
    },
  });

  // Validation logic
  const isNextDisabled = () => {
    if (!selectedDateOption) return true;
    if (selectedDateOption === "Now") return false; // "Now" doesn't need time slot
    // "This Weekend" requires time slot or exact time
    if (selectedDateOption === "This Weekend") {
      return !selectedTimeSlot && !exactTime;
    }
    if (selectedDateOption === "Pick a Date") {
      return !selectedDate || (!selectedTimeSlot && !exactTime);
    }
    // "Today" requires time slot or exact time
    return !selectedTimeSlot && !exactTime;
  };

  const { saturday, sunday } = getWeekendDates();
  const formatWeekendDate = (date: Date) => {
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
  };

  return (
    <View style={styles.container}>
      {/* <StatusBar barStyle="dark-content" backgroundColor="white" /> */}

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "80%" }]} />
          </View>
          <Text style={styles.progressText}>80% complete • Step 8 of 10</Text>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>When do you want to go?</Text>
          <Text style={styles.subtitle}>
            Choose your preferred date and time
          </Text>
        </View>

        {/* Date Options Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Date</Text>
          <View style={styles.dateOptionsContainer}>
            {dateOptions.map((option) => {
              const isSelected = selectedDateOption === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.dateOptionCard,
                    isSelected && styles.dateOptionCardSelected,
                  ]}
                  onPress={() => handleDateOptionSelect(option.id)}
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
          {/* This Weekend Info Card (only for "This Weekend") */}
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

          <Text style={styles.instructionText}>
            You can adjust this preference anytime
          </Text>
        </View>

        {/* Date Input Field (only for "Pick a Date") */}
        {selectedDateOption === "Pick a Date" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pick a Date</Text>
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
          </View>
        )}

        {/* Time Slots Section (shown for "Today", "This Weekend", and "Pick a Date") */}
        {selectedDateOption && selectedDateOption !== "Now" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Time</Text>
            <Text style={styles.quickPresetsLabel}>Quick Presets</Text>
            <View style={styles.timeSlotsContainer}>
              {timeSlots.map((slot) => {
                const isSelected = selectedTimeSlot === slot.id;
                return (
                  <TouchableOpacity
                    key={slot.id}
                    style={[
                      styles.timeSlotCard,
                      isSelected && styles.timeSlotCardSelected,
                    ]}
                    onPress={() => handleTimeSlotSelect(slot.id)}
                  >
                    <View style={styles.timeSlotContent}>
                      <Ionicons
                        name={
                          slot.icon === "cafe"
                            ? "cafe-outline"
                            : slot.icon === "sunny"
                            ? "sunny-outline"
                            : slot.icon === "restaurant"
                            ? "restaurant-outline"
                            : "moon-outline"
                        }
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
          </View>
        )}
      </ScrollView>

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
          <SafeAreaView style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Date</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowCalendar(false)}
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
              <SafeAreaView style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Time</Text>
                  <TouchableOpacity
                    style={styles.modalCloseButton}
                    onPress={handleTimePickerConfirm}
                  >
                    <Text style={styles.modalConfirmButton}>Done</Text>
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

      {/* Navigation Buttons */}
      <View style={styles.navigationContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={async () => {
            if (isNextDisabled() || isLoading) return;
            setIsLoading(true);
            try {
              await onNext();
            } catch (error) {
              console.error("Error in onNext:", error);
            } finally {
              setIsLoading(false);
            }
          }}
          disabled={isNextDisabled() || isLoading}
          style={[
            styles.nextButton,
            (isNextDisabled() || isLoading) && styles.nextButtonDisabled,
          ]}
        >
          {isLoading ? (
            <>
              <Text
                style={[
                  styles.nextButtonText,
                  isLoading && styles.nextButtonTextDisabled,
                ]}
              >
                Saving...
              </Text>
              <Ionicons
                name="hourglass-outline"
                size={18}
                color={isLoading ? "#9ca3af" : "white"}
              />
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.nextButtonText,
                  isNextDisabled() && styles.nextButtonTextDisabled,
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={isNextDisabled() ? "#9ca3af" : "white"}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default DateTimePrefStep;
