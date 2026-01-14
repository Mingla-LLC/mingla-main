import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface DateOptionsGridProps {
  selectedDateOption: "now" | "today" | "weekend" | "custom" | null;
  onSelectOption: (option: "now" | "today" | "weekend" | "custom") => void;
}

export default function DateOptionsGrid({
  selectedDateOption,
  onSelectOption,
}: DateOptionsGridProps) {
  return (
    <View style={styles.dateOptionsGrid}>
      <View style={styles.dateOptionsRow}>
        <TouchableOpacity
          style={[
            styles.dateOption,
            selectedDateOption === "now" && styles.dateOptionSelected,
          ]}
          onPress={() => onSelectOption("now")}
        >
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "now" && styles.dateOptionTextSelected,
            ]}
          >
            Now
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.dateOption,
            selectedDateOption === "today" && styles.dateOptionSelected,
          ]}
          onPress={() => onSelectOption("today")}
        >
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "today" && styles.dateOptionTextSelected,
            ]}
          >
            Today
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.dateOptionsRow}>
        <TouchableOpacity
          style={[
            styles.dateOption,
            selectedDateOption === "weekend" && styles.dateOptionSelected,
          ]}
          onPress={() => onSelectOption("weekend")}
        >
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "weekend" && styles.dateOptionTextSelected,
            ]}
          >
            This Weekend
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.dateOption,
            selectedDateOption === "custom" && styles.dateOptionSelected,
          ]}
          onPress={() => onSelectOption("custom")}
        >
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "custom" && styles.dateOptionTextSelected,
            ]}
          >
            Pick a Date
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: "#fdf8f5",
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
});
