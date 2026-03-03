import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import { useAppState } from "../AppStateManager";
import { formatMonthYear } from "@/src/utils/dateUtils";
import { mixpanelService } from "../../services/mixpanelService";

// Simple, self-contained Account Information card.
// Currently uses static placeholder values to match the design.
// When real data (email, memberSince, status) is available, wire it in here.
export default function ProfileAccountSection() {
  const { userIdentity, handleUserIdentityUpdate } = useAppState();
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [tempEmail, setTempEmail] = useState(userIdentity?.email || "");

  const handleStartEditEmail = () => {
    setTempEmail(userIdentity?.email || "");
    setIsEditingEmail(true);
  };

  const handleCancelEditEmail = () => {
    setTempEmail(userIdentity?.email || "");
    setIsEditingEmail(false);
  };

  const handleSaveEmail = () => {
    if (!userIdentity) return;

    const updatedIdentity = {
      ...userIdentity,
      email: tempEmail.trim(),
    };

    handleUserIdentityUpdate(updatedIdentity);

    // Track profile setting updated
    mixpanelService.trackProfileSettingUpdated({ field: "email" });

    setIsEditingEmail(false);
  };

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
        <Text style={styles.rowLabel}>Email</Text>
        {isEditingEmail ? (
          <View style={styles.emailEditContainer}>
            <TextInput
              value={tempEmail}
              onChangeText={setTempEmail}
              style={styles.emailInput}
              autoFocus
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Enter email"
            />
            <View style={styles.emailActionButtons}>
              <TouchableOpacity
                onPress={handleSaveEmail}
                style={styles.iconButton}
              >
                <Ionicons name="checkmark" size={16} color="#10b981" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCancelEditEmail}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={16} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.emailValueRow}>
            <Text style={styles.rowValue}>{userIdentity?.email}</Text>
            <TouchableOpacity
              onPress={handleStartEditEmail}
              style={styles.iconButton}
            >
              <Feather name="edit-3" size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Member Since */}
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Member Since</Text>
        <Text style={styles.rowValue}>
          {formatMonthYear(userIdentity.createdAt || "")}
        </Text>
      </View>

      {/* Account Status */}
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Account Status</Text>
        <View
          style={[
            styles.statusBadge,
            userIdentity?.active === false && styles.statusBadgeInactive,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              userIdentity?.active === false && styles.statusDotInactive,
            ]}
          />
          <Text
            style={[
              styles.statusText,
              userIdentity?.active === false && styles.statusTextInactive,
            ]}
          >
            {userIdentity?.active !== false ? "Active" : "Inactive"}
          </Text>
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
  emailValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    padding: 8,
  },
  emailEditContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  emailInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "white",
  },
  emailActionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  statusBadgeInactive: {
    backgroundColor: "#fef2f2",
  },
  statusDotInactive: {
    backgroundColor: "#dc2626",
  },
  statusTextInactive: {
    color: "#991b1b",
  },
});
