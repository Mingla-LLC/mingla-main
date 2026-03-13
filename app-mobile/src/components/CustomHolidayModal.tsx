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

const MONTHS_LIST = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isToday(year: number, month: number, day: number): boolean {
  const now = new Date();
  return (
    now.getFullYear() === year &&
    now.getMonth() === month &&
    now.getDate() === day
  );
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
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<{
    month: number;
    day: number;
    year: number;
  } | null>(null);
  const [errors, setErrors] = useState<{ name?: string; date?: string }>({});

  useEffect(() => {
    if (!visible) {
      setName("");
      setViewYear(new Date().getFullYear());
      setViewMonth(new Date().getMonth());
      setSelectedDate(null);
      setErrors({});
    }
  }, [visible]);

  // If the currently selected date doesn't exist in the new month/year (e.g., Feb 29 in non-leap year), clear it
  const clearInvalidSelection = (yr: number, mo: number) => {
    if (!selectedDate) return;
    if (selectedDate.year === yr && selectedDate.month === mo + 1) {
      const maxDay = getDaysInMonth(yr, mo);
      if (selectedDate.day > maxDay) {
        setSelectedDate(null);
      }
    }
  };

  const validate = (): boolean => {
    const newErrors: { name?: string; date?: string } = {};
    if (!name.trim()) newErrors.name = "Give this day a name";
    if (!selectedDate) newErrors.date = "Pick a date";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave({
      name: name.trim(),
      month: selectedDate!.month,
      day: selectedDate!.day,
      year: selectedDate!.year,
    });
    onClose();
  };

  const navigateMonth = (direction: -1 | 1) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let newMonth = viewMonth + direction;
    let newYear = viewYear;
    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }
    // Don't navigate past current month or below MIN_YEAR
    const now = new Date();
    if (newYear > now.getFullYear() || (newYear === now.getFullYear() && newMonth > now.getMonth())) {
      return;
    }
    if (newYear < MIN_YEAR) return;
    setViewMonth(newMonth);
    setViewYear(newYear);
    clearInvalidSelection(newYear, newMonth);
  };

  const handleYearSelect = (year: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = new Date();
    // If selecting current year and viewMonth is in the future, clamp to current month
    const effectiveMonth = (year === now.getFullYear() && viewMonth > now.getMonth())
      ? now.getMonth()
      : viewMonth;
    if (effectiveMonth !== viewMonth) setViewMonth(effectiveMonth);
    setViewYear(year);
    clearInvalidSelection(year, effectiveMonth);
  };

  const handleMonthSelect = (monthIdx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = new Date();
    // Don't allow selecting a future month in the current year
    if (viewYear === now.getFullYear() && monthIdx > now.getMonth()) return;
    setViewMonth(monthIdx);
    clearInvalidSelection(viewYear, monthIdx);
  };

  const canGoBack = useMemo(() => {
    if (viewYear > MIN_YEAR) return true;
    if (viewYear === MIN_YEAR && viewMonth > 0) return true;
    return false;
  }, [viewYear, viewMonth]);

  const canGoForward = useMemo(() => {
    const now = new Date();
    if (viewYear < now.getFullYear()) return true;
    if (viewYear === now.getFullYear() && viewMonth < now.getMonth()) return true;
    return false;
  }, [viewYear, viewMonth]);

  const calendarRows = useMemo(() => {
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfWeek(viewYear, viewMonth);

    const rows: (number | null)[][] = [];
    let currentRow: (number | null)[] = [];

    for (let i = 0; i < firstDay; i++) {
      currentRow.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      currentRow.push(day);
      if (currentRow.length === 7) {
        rows.push(currentRow);
        currentRow = [];
      }
    }

    if (currentRow.length > 0) {
      while (currentRow.length < 7) {
        currentRow.push(null);
      }
      rows.push(currentRow);
    }

    return rows;
  }, [viewYear, viewMonth]);

  const isSelected = (day: number): boolean => {
    if (!selectedDate) return false;
    return (
      selectedDate.year === viewYear &&
      selectedDate.month === viewMonth + 1 &&
      selectedDate.day === day
    );
  };

  const handleDayPress = (day: number) => {
    if (isFutureDate(viewYear, viewMonth, day)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDate({
      month: viewMonth + 1,
      day,
      year: viewYear,
    });
    if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
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

            {/* Date Picker */}
            <View style={styles.field}>
              <Text style={styles.label}>When is it?</Text>

              {/* Year selector — horizontal scroll */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.yearScrollContent}
                style={styles.yearScroll}
              >
                {YEAR_OPTIONS.map((yr) => (
                  <TouchableOpacity
                    key={yr}
                    style={[
                      styles.yearPill,
                      viewYear === yr && styles.yearPillSelected,
                    ]}
                    onPress={() => handleYearSelect(yr)}
                  >
                    <Text
                      style={[
                        styles.yearPillText,
                        viewYear === yr && styles.yearPillTextSelected,
                      ]}
                    >
                      {yr}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Month selector — horizontal scroll */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.monthScrollContent}
                style={styles.monthScroll}
              >
                {MONTHS_SHORT.map((m, i) => {
                  const now = new Date();
                  const isFutureMonth =
                    viewYear === now.getFullYear() && i > now.getMonth();
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.monthPill,
                        viewMonth === i && styles.monthPillSelected,
                      ]}
                      onPress={() => handleMonthSelect(i)}
                      disabled={isFutureMonth}
                    >
                      <Text
                        style={[
                          styles.monthPillText,
                          viewMonth === i && styles.monthPillTextSelected,
                          isFutureMonth && styles.monthPillDisabled,
                        ]}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Month/Year Navigation with arrows */}
              <View style={styles.calendarNav}>
                <TouchableOpacity
                  onPress={() => navigateMonth(-1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={!canGoBack}
                >
                  <Ionicons
                    name="chevron-back"
                    size={s(20)}
                    color={canGoBack ? colors.gray[700] : colors.gray[300]}
                  />
                </TouchableOpacity>
                <Text style={styles.calendarMonthYear}>
                  {MONTHS_LIST[viewMonth]} {viewYear}
                </Text>
                <TouchableOpacity
                  onPress={() => navigateMonth(1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={!canGoForward}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={s(20)}
                    color={canGoForward ? colors.gray[700] : colors.gray[300]}
                  />
                </TouchableOpacity>
              </View>

              {/* Day Headers */}
              <View style={styles.calendarHeaderRow}>
                {DAY_HEADERS.map((dh) => (
                  <View key={dh} style={styles.calendarCell}>
                    <Text style={styles.calendarDayHeader}>{dh}</Text>
                  </View>
                ))}
              </View>

              {/* Calendar Grid */}
              {calendarRows.map((row, rowIdx) => (
                <View key={rowIdx} style={styles.calendarRow}>
                  {row.map((day, colIdx) => {
                    if (day === null) {
                      return <View key={`empty-${colIdx}`} style={styles.calendarCell} />;
                    }
                    const future = isFutureDate(viewYear, viewMonth, day);
                    const selected = isSelected(day);
                    const todayMark = isToday(viewYear, viewMonth, day);

                    return (
                      <View key={day} style={styles.calendarCell}>
                        <TouchableOpacity
                          style={[
                            styles.calendarDayButton,
                            selected && styles.calendarDaySelected,
                          ]}
                          onPress={() => handleDayPress(day)}
                          disabled={future}
                          activeOpacity={future ? 1 : 0.6}
                        >
                          <Text
                            style={[
                              styles.calendarDayText,
                              future && styles.calendarDayDisabled,
                              selected && styles.calendarDayTextSelected,
                            ]}
                          >
                            {day}
                          </Text>
                        </TouchableOpacity>
                        {todayMark && !selected ? (
                          <View style={styles.todayDot} />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}

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
  // Year selector
  yearScroll: {
    marginBottom: vs(8),
  },
  yearScrollContent: {
    gap: s(6),
    paddingRight: s(8),
  },
  yearPill: {
    paddingHorizontal: s(14),
    paddingVertical: vs(7),
    borderRadius: s(10),
    backgroundColor: colors.gray[100],
  },
  yearPillSelected: {
    backgroundColor: "#eb7825",
  },
  yearPillText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[600],
  },
  yearPillTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  // Month selector
  monthScroll: {
    marginBottom: vs(12),
  },
  monthScrollContent: {
    gap: s(6),
    paddingRight: s(8),
  },
  monthPill: {
    paddingHorizontal: s(12),
    paddingVertical: vs(7),
    borderRadius: s(10),
    backgroundColor: colors.gray[100],
  },
  monthPillSelected: {
    backgroundColor: "#eb7825",
  },
  monthPillText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[600],
  },
  monthPillTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  monthPillDisabled: {
    color: colors.gray[300],
  },
  // Calendar
  calendarNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: vs(8),
    paddingHorizontal: s(4),
  },
  calendarMonthYear: {
    fontSize: s(16),
    fontWeight: "600",
    color: colors.gray[800],
  },
  calendarHeaderRow: {
    flexDirection: "row",
    marginBottom: vs(4),
  },
  calendarRow: {
    flexDirection: "row",
  },
  calendarCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: s(40),
  },
  calendarDayHeader: {
    fontSize: s(12),
    fontWeight: "600",
    color: colors.gray[400],
  },
  calendarDayButton: {
    width: s(34),
    height: s(34),
    borderRadius: s(17),
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDaySelected: {
    backgroundColor: "#eb7825",
  },
  calendarDayText: {
    fontSize: s(14),
    fontWeight: "500",
    color: colors.gray[800],
  },
  calendarDayDisabled: {
    color: colors.gray[300],
  },
  calendarDayTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  todayDot: {
    width: s(4),
    height: s(4),
    borderRadius: s(2),
    backgroundColor: "#eb7825",
    marginTop: vs(1),
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
