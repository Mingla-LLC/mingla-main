import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Self-contained Privacy & Visibility card.
// Uses static placeholder values that match the design.
export default function ProfilePrivacySection() {
  const profileVisibility = "Friends Only";
  const savedExperiences = "Private";

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Privacy & Visibility</Text>
      </View>
      <Text style={styles.subtitle}>
        Control how others see your profile and activity.
      </Text>

      {/* Profile Visibility */}
      <TouchableOpacity style={styles.row} activeOpacity={0.7}>
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Profile Visibility</Text>
          <Text style={styles.rowValue}>{profileVisibility}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </TouchableOpacity>

      {/* Activity Status */}
      <TouchableOpacity style={styles.row} activeOpacity={0.7}>
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Activity Status</Text>
          <Text style={styles.rowValue}>Show when you're online</Text>
        </View>
        <View style={styles.toggleIndicator}>
          <View style={styles.toggleDot} />
        </View>
      </TouchableOpacity>

      {/* Saved Experiences */}
      <TouchableOpacity style={styles.row} activeOpacity={0.7}>
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Saved Experiences</Text>
          <Text style={styles.rowValue}>{savedExperiences}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  subtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  rowTextContainer: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },
  toggleIndicator: {
    width: 32,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#22c55e",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  toggleDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: "white",
    alignSelf: "flex-end",
  },
});
