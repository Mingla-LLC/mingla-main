import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';

interface WeekendDaySelectionProps {
  selectedWeekendDay: "saturday" | "sunday" | null;
  onSelectDay: (day: "saturday" | "sunday") => void;
  dark?: boolean;
}

export default function WeekendDaySelection({
  selectedWeekendDay,
  onSelectDay,
  dark = false,
}: WeekendDaySelectionProps) {
  const btnStyle = dark ? styles.weekendDayButtonDark : styles.weekendDayButton;
  const btnSelectedStyle = dark
    ? styles.weekendDayButtonSelectedDark
    : styles.weekendDayButtonSelected;
  const txtStyle = dark
    ? styles.weekendDayButtonTextDark
    : styles.weekendDayButtonText;
  const txtSelectedStyle = dark
    ? styles.weekendDayButtonTextSelectedDark
    : styles.weekendDayButtonTextSelected;

  return (
    <View style={styles.weekendDaySelection}>
      <TrackedTouchableOpacity logComponent="WeekendDaySelection"
        style={[
          btnStyle,
          selectedWeekendDay === "saturday" && btnSelectedStyle,
        ]}
        onPress={() => onSelectDay("saturday")}
      >
        <Text
          style={[
            txtStyle,
            selectedWeekendDay === "saturday" && txtSelectedStyle,
          ]}
        >
          Saturday
        </Text>
      </TrackedTouchableOpacity>
      <TrackedTouchableOpacity logComponent="WeekendDaySelection"
        style={[
          btnStyle,
          selectedWeekendDay === "sunday" && btnSelectedStyle,
        ]}
        onPress={() => onSelectDay("sunday")}
      >
        <Text
          style={[
            txtStyle,
            selectedWeekendDay === "sunday" && txtSelectedStyle,
          ]}
        >
          Sunday
        </Text>
      </TrackedTouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  weekendDaySelection: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    width: "100%",
  },
  // --- Light theme ---
  weekendDayButton: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  weekendDayButtonSelected: {
    backgroundColor: "#fef3c7",
    borderColor: "#ea580c",
    borderWidth: 2,
  },
  weekendDayButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1f2937",
  },
  weekendDayButtonTextSelected: {
    color: "#ea580c",
    fontWeight: "600",
  },
  // --- Dark theme ---
  weekendDayButtonDark: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  weekendDayButtonSelectedDark: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderColor: "#F59E0B",
    borderWidth: 1.5,
  },
  weekendDayButtonTextDark: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255,255,255,0.7)",
  },
  weekendDayButtonTextSelectedDark: {
    color: "#F59E0B",
    fontWeight: "700",
  },
});

