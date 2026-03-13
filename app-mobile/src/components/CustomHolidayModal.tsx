import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareView } from "./ui/KeyboardAwareView";
import * as Haptics from "expo-haptics";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
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

const MONTHS_LIST = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number): number {
  // month is 0-indexed here (JS Date convention)
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  // month is 0-indexed
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

const CustomHolidayModal: React.FC<CustomHolidayModalProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState("");
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth()); // 0-indexed for display
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
    setViewMonth(newMonth);
    setViewYear(newYear);
  };

  // Can't navigate forward past the current month
  const canGoForward = useMemo(() => {
    const now = new Date();
    if (viewYear < now.getFullYear()) return true;
    if (viewYear === now.getFullYear() && viewMonth < now.getMonth()) return true;
    return false;
  }, [viewYear, viewMonth]);

  // Build calendar grid
  const calendarRows = useMemo(() => {
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfWeek(viewYear, viewMonth);

    const rows: (number | null)[][] = [];
    let currentRow: (number | null)[] = [];

    // Fill empty slots before the 1st
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

    // Fill remaining slots in the last row
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
      selectedDate.month === viewMonth + 1 && // selectedDate.month is 1-indexed
      selectedDate.day === day
    );
  };

  const handleDayPress = (day: number) => {
    if (isFutureDate(viewYear, viewMonth, day)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDate({
      month: viewMonth + 1, // Store as 1-indexed
      day,
      year: viewYear,
    });
    if (errors.date) setErrors((e) => ({ ...e, date: undefined }));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAwareView
          style={styles.centeredView}
          dismissOnTap={false}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
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

              {/* Calendar Date Picker */}
              <View style={styles.field}>
                <Text style={styles.label}>When is it?</Text>

                {/* Month/Year Navigation */}
                <View style={styles.calendarNav}>
                  <TouchableOpacity
                    onPress={() => navigateMonth(-1)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={s(20)}
                      color={colors.gray[700]}
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
          </Pressable>
        </KeyboardAwareView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  centeredView: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: s(20),
    padding: s(24),
    marginHorizontal: s(24),
    maxHeight: SCREEN_HEIGHT * 0.85,
    width: SCREEN_WIDTH - s(48),
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
  // Calendar
  calendarNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: vs(12),
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
