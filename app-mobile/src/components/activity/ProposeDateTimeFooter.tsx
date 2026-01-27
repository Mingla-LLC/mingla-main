import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ProposeDateTimeFooterProps {
  selectedDateOption: "now" | "today" | "weekend" | "custom" | null;
  selectedWeekendDay?: "saturday" | "sunday" | null;
  isAvailabilityChecked: boolean;
  isPlaceOpen: boolean;
  isCheckingAvailability: boolean;
  onCheckAvailability: () => void;
  onSchedule: () => void;
  isScheduling?: boolean;
}

export default function ProposeDateTimeFooter({
  selectedDateOption,
  selectedWeekendDay,
  isAvailabilityChecked,
  isPlaceOpen,
  isCheckingAvailability,
  onCheckAvailability,
  onSchedule,
  isScheduling = false,
}: ProposeDateTimeFooterProps) {
  // Show Schedule button only if availability is checked and place is open
  if (isAvailabilityChecked && isPlaceOpen) {
    return (
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.scheduleButton,
            isScheduling && styles.scheduleButtonDisabled,
          ]}
          onPress={onSchedule}
          disabled={isScheduling}
          activeOpacity={0.7}
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Ionicons name="calendar" size={20} color="white" />
          )}
          <Text style={styles.scheduleButtonText}>
            {isScheduling ? "Scheduling..." : "Schedule"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show Check Availability button
  const isButtonDisabled =
    !selectedDateOption ||
    isCheckingAvailability ||
    (selectedDateOption === "weekend" && !selectedWeekendDay);

  return (
    <View style={styles.footer}>
      <TouchableOpacity
        style={[
          styles.checkCompatibilityButton,
          isButtonDisabled && styles.checkCompatibilityButtonDisabled,
        ]}
        onPress={onCheckAvailability}
        disabled={isButtonDisabled}
        activeOpacity={0.7}
      >
        {isCheckingAvailability ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <Ionicons name="sparkles" size={20} color="white" />
        )}
        <Text style={styles.checkCompatibilityText}>
          {isCheckingAvailability ? "Checking..." : "Check Availability"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    padding: 20,
    paddingTop: 0,
    backgroundColor: "white",
  },
  checkCompatibilityButton: {
    backgroundColor: "#ea580c",
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  checkCompatibilityButtonDisabled: {
    opacity: 0.5,
  },
  checkCompatibilityText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  scheduleButton: {
    backgroundColor: "#ea580c",
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  scheduleButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  scheduleButtonDisabled: {
    opacity: 0.7,
  },
});
