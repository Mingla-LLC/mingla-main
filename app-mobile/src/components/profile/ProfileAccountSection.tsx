import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Simple, self-contained Account Information card.
// Currently uses static placeholder values to match the design.
// When real data (email, memberSince, status) is available, wire it in here.
export default function ProfileAccountSection() {
  const email = "jordan.explorer@mingla.com";
  const memberSince = "January 2026";
  const status = "Active";

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Account Information</Text>
      </View>
      <Text style={styles.subtitle}>
        Manage your account details and preferences.
      </Text>

      {/* Email */}
      <View style={styles.row}>
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{email}</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} activeOpacity={0.7}>
          <Ionicons name="create-outline" size={18} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Member Since */}
      <View style={styles.row}>
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Member Since</Text>
          <Text style={styles.rowValue}>{memberSince}</Text>
        </View>
      </View>

      {/* Account Status */}
      <View style={styles.row}>
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Account Status</Text>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
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
  iconButton: {
    padding: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ecfdf3",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#16a34a",
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: "#166534",
    fontWeight: "600",
  },
});
