import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { s, vs, SCREEN_HEIGHT } from "../utils/responsive";
import { colors } from "../constants/designSystem";

interface CustomHolidayModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (holiday: {
    name: string;
    month: number;
    day: number;
    year: number;
  }) => void;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isFutureDate(year: number, month: number, day: number): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(year, month, day);
  target.setHours(0, 0, 0, 0);
  return target > today;
}

const MIN_YEAR = 1900;
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from(
  { length: currentYear - MIN_YEAR + 1 },
  (_, i) => currentYear - i
);

const CustomHolidayModal: React.FC<CustomHolidayModalProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ name?: string; date?: string }>({});

  useEffect(() => {
    if (!visible) {
      setName("");
      setSelectedYear(null);
      setSelectedMonth(null);
      setSelectedDay(null);
      setErrors({});
    }
  }, [visible]);

  // Days available for the selected year/month
  const daysInMonth = useMemo(() => {
    if (selectedYear === null || selectedMonth === null) return 0;
    return getDaysInMonth(selectedYear, selectedMonth);
  }, [selectedYear, selectedMonth]);

  // Clamp selectedDay when month/year changes reduce available days
  useEffect(() => {
    if (selectedDay !== null && daysInMonth > 0 && selectedDay > daysInMonth) {
      setSelectedDay(null);
    }
  }, [daysInMonth, selectedDay]);

  const validate = (): boolean => {
    const newErrors: { name?: string; date?: string } = {};
    if (!name.trim()) newErrors.name = "Give this day a name";
    if (selectedYear === null || selectedMonth === null || selectedDay === null) {
      newErrors.date = "Pick a date";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave({
      name: name.trim(),
      month: selectedMonth! + 1, // 1-indexed for storage
      day: selectedDay!,
      year: selectedYear!,
    });
    onClose();
  };

  const handleYearSelect = (year: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedYear(year);
    // If selecting current year, clamp month if needed
    const now = new Date();
    if (selectedMonth !== null && year === now.getFullYear() && selectedMonth > now.getMonth()) {
      setSelectedMonth(null);
      setSelectedDay(null);
    }
    if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
  };

  const handleMonthSelect = (monthIdx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMonth(monthIdx);
    if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
  };

  const handleDaySelect = (day: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDay(day);
    if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
  };

  // Determine which months are disabled (future months in current year)
  const isMonthDisabled = (monthIdx: number): boolean => {
    if (selectedYear === null) return true;
    const now = new Date();
    return selectedYear === now.getFullYear() && monthIdx > now.getMonth();
  };

  // Determine which days are disabled (future days)
  const isDayDisabled = (day: number): boolean => {
    if (selectedYear === null || selectedMonth === null) return true;
    return isFutureDate(selectedYear, selectedMonth, day);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheetContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Mark a day that matters</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={s(24)} color={colors.gray[400]} />
              </TouchableOpacity>
            </View>

            {/* Name */}
            <View style={styles.field}>
              <Text style={styles.label}>What's the day?</Text>
              <TextInput
                style={[styles.textInput, errors.name && styles.inputError]}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
                }}
                placeholder="e.g. Our first trip together"
                placeholderTextColor={colors.gray[400]}
                maxLength={50}
              />
              {errors.name ? (
                <Text style={styles.errorText}>{errors.name}</Text>
              ) : null}
            </View>

            {/* Date Picker — 3 horizontal pill rows */}
            <View style={styles.field}>
              <Text style={styles.label}>When did it happen?</Text>

              {/* Year picker */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillScrollContent}
                style={styles.pillScroll}
              >
                {YEAR_OPTIONS.map((yr) => (
                  <TouchableOpacity
                    key={yr}
                    style={[
                      styles.pill,
                      selectedYear === yr && styles.pillSelected,
                    ]}
                    onPress={() => handleYearSelect(yr)}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        selectedYear === yr && styles.pillTextSelected,
                      ]}
                    >
                      {yr}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Month picker */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillScrollContent}
                style={styles.pillScroll}
              >
                {MONTHS_SHORT.map((m, i) => {
                  const disabled = isMonthDisabled(i);
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.pill,
                        selectedMonth === i && styles.pillSelected,
                      ]}
                      onPress={() => handleMonthSelect(i)}
                      disabled={disabled}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          selectedMonth === i && styles.pillTextSelected,
                          disabled && styles.pillTextDisabled,
                        ]}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Day picker */}
              {daysInMonth > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pillScrollContent}
                  style={styles.pillScroll}
                >
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(
                    (day) => {
                      const disabled = isDayDisabled(day);
                      return (
                        <TouchableOpacity
                          key={day}
                          style={[
                            styles.pill,
                            styles.dayPill,
                            selectedDay === day && styles.pillSelected,
                          ]}
                          onPress={() => handleDaySelect(day)}
                          disabled={disabled}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              selectedDay === day && styles.pillTextSelected,
                              disabled && styles.pillTextDisabled,
                            ]}
                          >
                            {day}
                          </Text>
                        </TouchableOpacity>
                      );
                    }
                  )}
                </ScrollView>
              )}

              {errors.date ? (
                <Text style={styles.errorText}>{errors.date}</Text>
              ) : null}
            </View>

            {/* Save */}
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>Save this day</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    paddingHorizontal: s(24),
    paddingTop: s(12),
    maxHeight: SCREEN_HEIGHT * 0.88,
    width: "100%",
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: vs(8),
  },
  handle: {
    width: s(36),
    height: s(4),
    borderRadius: s(2),
    backgroundColor: colors.gray[300],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: vs(20),
  },
  title: {
    fontSize: s(20),
    fontWeight: "700",
    color: colors.gray[800],
  },
  field: {
    marginBottom: vs(18),
  },
  label: {
    fontSize: s(14),
    fontWeight: "600",
    color: colors.gray[700],
    marginBottom: vs(8),
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: s(12),
    paddingHorizontal: s(14),
    paddingVertical: vs(12),
    fontSize: s(15),
    color: colors.gray[800],
    backgroundColor: colors.gray[50] ?? "#F9FAFB",
  },
  inputError: {
    borderColor: "#E53935",
  },
  errorText: {
    fontSize: s(12),
    color: "#E53935",
    marginTop: vs(4),
  },
  // Pill selectors
  pillScroll: {
    marginBottom: vs(8),
  },
  pillScrollContent: {
    gap: s(6),
    paddingRight: s(8),
  },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: vs(7),
    borderRadius: s(10),
    backgroundColor: colors.gray[100],
  },
  dayPill: {
    paddingHorizontal: s(12),
    minWidth: s(40),
    alignItems: "center",
  },
  pillSelected: {
    backgroundColor: "#eb7825",
  },
  pillText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[600],
  },
  pillTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  pillTextDisabled: {
    color: colors.gray[300],
  },
  saveButton: {
    backgroundColor: "#eb7825",
    borderRadius: s(14),
    paddingVertical: vs(16),
    alignItems: "center",
    marginTop: vs(8),
  },
  saveButtonText: {
    fontSize: s(16),
    fontWeight: "700",
    color: "#FFFFFF",
  },
});

export default CustomHolidayModal;
