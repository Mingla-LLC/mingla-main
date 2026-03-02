import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface DateOptionsGridProps {
  selectedDateOption: "now" | "today" | "weekend" | "custom" | null;
  onSelectOption: (option: "now" | "today" | "weekend" | "custom") => void;
  dark?: boolean;
}

export default function DateOptionsGrid({
  selectedDateOption,
  onSelectOption,
  dark = false,
}: DateOptionsGridProps) {
  const optionStyle = dark ? styles.dateOptionDark : styles.dateOption;
  const optionSelectedStyle = dark
    ? styles.dateOptionSelectedDark
    : styles.dateOptionSelected;
  const textStyle = dark ? styles.dateOptionTextDark : styles.dateOptionText;
  const textSelectedStyle = dark
    ? styles.dateOptionTextSelectedDark
    : styles.dateOptionTextSelected;

  return (
    <View style={styles.dateOptionsGrid}>
      <View style={styles.dateOptionsRow}>
        <TouchableOpacity
          style={[
            optionStyle,
            selectedDateOption === "now" && optionSelectedStyle,
          ]}
          onPress={() => onSelectOption("now")}
        >
          <Text
            style={[
              textStyle,
              selectedDateOption === "now" && textSelectedStyle,
            ]}
          >
            Now
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            optionStyle,
            selectedDateOption === "today" && optionSelectedStyle,
          ]}
          onPress={() => onSelectOption("today")}
        >
          <Text
            style={[
              textStyle,
              selectedDateOption === "today" && textSelectedStyle,
            ]}
          >
            Today
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.dateOptionsRow}>
        <TouchableOpacity
          style={[
            optionStyle,
            selectedDateOption === "weekend" && optionSelectedStyle,
          ]}
          onPress={() => onSelectOption("weekend")}
        >
          <Text
            style={[
              textStyle,
              selectedDateOption === "weekend" && textSelectedStyle,
            ]}
          >
            This Weekend
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            optionStyle,
            selectedDateOption === "custom" && optionSelectedStyle,
          ]}
          onPress={() => onSelectOption("custom")}
        >
          <Text
            style={[
              textStyle,
              selectedDateOption === "custom" && textSelectedStyle,
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
    gap: 10,
    width: "100%",
  },
  dateOptionsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  // --- Light theme ---
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
  // --- Dark theme ---
  dateOptionDark: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dateOptionSelectedDark: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderColor: "#F59E0B",
    borderWidth: 1.5,
  },
  dateOptionTextDark: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255,255,255,0.7)",
  },
  dateOptionTextSelectedDark: {
    color: "#F59E0B",
    fontWeight: "700",
  },
});
