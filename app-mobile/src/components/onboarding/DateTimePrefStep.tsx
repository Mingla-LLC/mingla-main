import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar } from "../ui/calendar";

interface DateTimePrefStepProps {
  onNext: () => void;
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

  // Track if this is initial mount to prevent loop on first render
  const isInitialMount = useRef(true);
  const lastProcessedValues = useRef<string | null>(null);

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
  }, [dateTimePref]);

  const dateOptions: Array<{
    id: DateOption;
    label: string;
    emoji: string;
    description: string;
  }> = [
    { id: "Now", label: "Now", emoji: "⚡", description: "Right this minute" },
    {
      id: "Today",
      label: "Today",
      emoji: "☀️",
      description: "This afternoon/evening",
    },
    {
      id: "This Weekend",
      label: "This Weekend",
      emoji: "📅",
      description: "Saturday or Sunday",
    },
    {
      id: "Pick a Date",
      label: "Pick a Date",
      emoji: "🗓️",
      description: "Choose exact day",
    },
  ];

  const timeSlots: Array<{
    id: TimeSlot;
    label: string;
    emoji: string;
    time: string;
    startHour: number;
    endHour: number;
  }> = [
    {
      id: "brunch",
      label: "Brunch",
      emoji: "🍳",
      time: "11am–1pm",
      startHour: 11,
      endHour: 13,
    },
    {
      id: "afternoon",
      label: "Afternoon",
      emoji: "☀️",
      time: "2–5pm",
      startHour: 14,
      endHour: 17,
    },
    {
      id: "dinner",
      label: "Dinner",
      emoji: "🍽️",
      time: "6–9pm",
      startHour: 18,
      endHour: 21,
    },
    {
      id: "lateNight",
      label: "Late Night",
      emoji: "🌙",
      time: "10pm–12am",
      startHour: 22,
      endHour: 24,
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
      setSelectedWeekendDay(null);
    } else if (option === "Pick a Date") {
      setSelectedTimeSlot(null);
      setSelectedWeekendDay(null);
      if (!selectedDate) {
        setShowCalendar(true);
      }
    }
  };

  const handleTimeSlotSelect = (slot: TimeSlot) => {
    setSelectedTimeSlot(slot);
    updateParentPref();
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

  const updateParentPref = () => {
    if (selectedDateOption) {
      onDateTimePrefChange({
        dateOption: selectedDateOption,
        timeSlot: selectedTimeSlot || undefined,
        selectedDate: selectedDate?.toISOString() || undefined,
        weekendDay: selectedWeekendDay || undefined,
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: "white",
      borderBottomWidth: 1,
      borderBottomColor: "#f3f4f6",
    },
    backButton: {
      padding: 8,
      borderRadius: 20,
    },
    headerCenter: {
      alignItems: "center",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
    },
    headerSubtitle: {
      fontSize: 14,
      color: "#6b7280",
    },
    progressBar: {
      height: 8,
      backgroundColor: "#e5e7eb",
      borderRadius: 4,
      marginHorizontal: 24,
      marginVertical: 16,
    },
    progressFill: {
      height: 8,
      backgroundColor: "#eb7825",
      borderRadius: 4,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
      paddingBottom: 100,
    },
    titleSection: {
      marginBottom: 32,
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
    },
    section: {
      marginBottom: 32,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 16,
    },
    dateOptionsContainer: {
      gap: 12,
    },
    dateOptionCard: {
      flexDirection: "row",
      alignItems: "center",
      padding: 20,
      borderRadius: 16,
      borderWidth: 2,
      backgroundColor: "#f9fafb",
      borderColor: "#e5e7eb",
    },
    dateOptionCardSelected: {
      backgroundColor: "#fef3c7",
      borderColor: "#eb7825",
    },
    dateOptionEmoji: {
      fontSize: 32,
      marginRight: 16,
    },
    dateOptionContent: {
      flex: 1,
    },
    dateOptionLabel: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    dateOptionDescription: {
      fontSize: 14,
      color: "#6b7280",
    },
    dateOptionCheck: {
      marginLeft: 12,
    },
    weekendDaysContainer: {
      flexDirection: "row",
      gap: 12,
      marginTop: 16,
    },
    weekendDayButton: {
      flex: 1,
      padding: 16,
      borderRadius: 12,
      borderWidth: 2,
      alignItems: "center",
      backgroundColor: "white",
      borderColor: "#e5e7eb",
    },
    weekendDayButtonSelected: {
      backgroundColor: "#fef3c7",
      borderColor: "#eb7825",
    },
    weekendDayLabel: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginTop: 8,
    },
    weekendDayDate: {
      fontSize: 12,
      color: "#6b7280",
      marginTop: 4,
    },
    timeSlotsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      marginTop: 16,
    },
    timeSlotCard: {
      flex: 1,
      minWidth: "47%",
      padding: 20,
      borderRadius: 16,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "white",
      borderColor: "#e5e7eb",
    },
    timeSlotCardSelected: {
      backgroundColor: "#fef3c7",
      borderColor: "#eb7825",
    },
    timeSlotEmoji: {
      fontSize: 32,
      marginBottom: 8,
    },
    timeSlotLabel: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    timeSlotTime: {
      fontSize: 14,
      color: "#6b7280",
    },
    calendarContainer: {
      marginTop: 16,
      borderRadius: 12,
      overflow: "hidden",
    },
    navigationContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
      backgroundColor: "white",
    },
    backButtonText: {
      fontSize: 16,
      color: "#6b7280",
      fontWeight: "500",
    },
    nextButton: {
      backgroundColor: "#eb7825",
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    nextButtonDisabled: {
      backgroundColor: "#e5e7eb",
      opacity: 0.7,
    },
    nextButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 8,
    },
    nextButtonTextDisabled: {
      color: "#9ca3af",
    },
  });

  // Validation logic
  const isNextDisabled = () => {
    if (!selectedDateOption) return true;
    if (selectedDateOption === "Now") return false; // "Now" doesn't need time slot
    // Other options require time slot
    if (selectedDateOption === "This Weekend") {
      return !selectedWeekendDay || !selectedTimeSlot;
    }
    if (selectedDateOption === "Pick a Date") {
      return !selectedDate || !selectedTimeSlot;
    }
    // "Today" requires time slot
    return !selectedTimeSlot;
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
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Date & Time</Text>
          <Text style={styles.headerSubtitle}>Step 8 of 10</Text>
        </View>

        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "80%" }]} />
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>When do you prefer to go?</Text>
          <Text style={styles.subtitle}>
            Select your preferred date and time
          </Text>
        </View>

        {/* Date Options Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Date *</Text>
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
                  <Text style={styles.dateOptionEmoji}>{option.emoji}</Text>
                  <View style={styles.dateOptionContent}>
                    <Text style={styles.dateOptionLabel}>{option.label}</Text>
                    <Text style={styles.dateOptionDescription}>
                      {option.description}
                    </Text>
                  </View>
                  {isSelected && (
                    <View style={styles.dateOptionCheck}>
                      <Ionicons
                        name="checkmark-circle"
                        size={24}
                        color="#eb7825"
                      />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Weekend Day Selection (only for "This Weekend") */}
        {selectedDateOption === "This Weekend" && !selectedWeekendDay && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Choose Day</Text>
            <View style={styles.weekendDaysContainer}>
              <TouchableOpacity
                style={[
                  styles.weekendDayButton,
                  selectedWeekendDay === "saturday" &&
                    styles.weekendDayButtonSelected,
                ]}
                onPress={() => handleWeekendDaySelect("saturday")}
              >
                <Text style={{ fontSize: 24 }}>📅</Text>
                <Text style={styles.weekendDayLabel}>Saturday</Text>
                <Text style={styles.weekendDayDate}>
                  {formatWeekendDate(saturday)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.weekendDayButton,
                  selectedWeekendDay === "sunday" &&
                    styles.weekendDayButtonSelected,
                ]}
                onPress={() => handleWeekendDaySelect("sunday")}
              >
                <Text style={{ fontSize: 24 }}>📅</Text>
                <Text style={styles.weekendDayLabel}>Sunday</Text>
                <Text style={styles.weekendDayDate}>
                  {formatWeekendDate(sunday)}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Calendar Picker (only for "Pick a Date") */}
        {selectedDateOption === "Pick a Date" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Date</Text>
            {!selectedDate ? (
              <TouchableOpacity
                style={[
                  styles.dateOptionCard,
                  { justifyContent: "center", paddingVertical: 24 },
                ]}
                onPress={() => setShowCalendar(true)}
              >
                <Ionicons name="calendar-outline" size={32} color="#eb7825" />
                <Text
                  style={[
                    styles.dateOptionLabel,
                    { marginTop: 12, textAlign: "center" },
                  ]}
                >
                  Tap to pick a date
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.calendarContainer}>
                <Calendar
                  selected={selectedDate}
                  onSelect={handleCalendarDateSelect}
                />
              </View>
            )}
          </View>
        )}

        {/* Time Slots Section (shown for all except "Now") */}
        {selectedDateOption &&
          selectedDateOption !== "Now" &&
          (selectedDateOption !== "This Weekend" || selectedWeekendDay) &&
          (selectedDateOption !== "Pick a Date" || selectedDate) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Select Time *</Text>
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
                      <Text style={styles.timeSlotEmoji}>{slot.emoji}</Text>
                      <Text style={styles.timeSlotLabel}>{slot.label}</Text>
                      <Text style={styles.timeSlotTime}>{slot.time}</Text>
                      {isSelected && (
                        <View
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                          }}
                        >
                          <Ionicons
                            name="checkmark-circle"
                            size={24}
                            color="#eb7825"
                          />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
      </ScrollView>

      {/* Navigation Buttons */}
      <View style={styles.navigationContainer}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onNext}
          disabled={isNextDisabled()}
          style={[
            styles.nextButton,
            isNextDisabled() && styles.nextButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.nextButtonText,
              isNextDisabled() && styles.nextButtonTextDisabled,
            ]}
          >
            Next
          </Text>
          {!isNextDisabled() && (
            <Ionicons name="arrow-forward" size={20} color="white" />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default DateTimePrefStep;
