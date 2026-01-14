import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface WeekendDaySelectionProps {
  selectedWeekendDay: "saturday" | "sunday" | null;
  onSelectDay: (day: "saturday" | "sunday") => void;
}

export default function WeekendDaySelection({
  selectedWeekendDay,
  onSelectDay,
}: WeekendDaySelectionProps) {
  return (
    <View style={styles.weekendDaySelection}>
      <TouchableOpacity
        style={[
          styles.weekendDayButton,
          selectedWeekendDay === "saturday" && styles.weekendDayButtonSelected,
        ]}
        onPress={() => onSelectDay("saturday")}
      >
        <Text
          style={[
            styles.weekendDayButtonText,
            selectedWeekendDay === "saturday" &&
              styles.weekendDayButtonTextSelected,
          ]}
        >
          Saturday
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.weekendDayButton,
          selectedWeekendDay === "sunday" && styles.weekendDayButtonSelected,
        ]}
        onPress={() => onSelectDay("sunday")}
      >
        <Text
          style={[
            styles.weekendDayButtonText,
            selectedWeekendDay === "sunday" && styles.weekendDayButtonTextSelected,
          ]}
        >
          Sunday
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  weekendDaySelection: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
    width: "100%",
  },
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
});

