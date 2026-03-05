import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "../../store/appStore";
import { useEnhancedProfile } from "../../hooks/useEnhancedProfile";

const VISIBILITY_OPTIONS: {
  value: "friends" | "public" | "private";
  label: string;
}[] = [
  { value: "friends", label: "Friends Only" },
  { value: "public", label: "Everyone" },
  { value: "private", label: "Nobody" },
];

function visibilityToLabel(mode?: "public" | "friends" | "private"): string {
  const opt = VISIBILITY_OPTIONS.find((o) => o.value === mode);
  return opt?.label ?? "Friends Only";
}

// Self-contained Privacy & Visibility card.
export default function ProfilePrivacySection() {
  const { profile, setProfile } = useAppStore();

  const { updateProfilePrivacy } = useEnhancedProfile();

  const profileVisibility = visibilityToLabel(profile?.visibility_mode);

  const handleCycleVisibility = async () => {
    if (!profile) return;

    const order: Array<"friends" | "public" | "private"> = [
      "friends",
      "public",
      "private",
    ];
    const current = profile?.visibility_mode ?? "friends";
    const currentIndex = order.indexOf(current);
    const next = order[(currentIndex + 1) % order.length];

    // Optimistically update local state
    setProfile({ ...profile, visibility_mode: next });

    // Persist change in background
    try {
      await updateProfilePrivacy({ visibility_mode: next }, profile.id || "");
    } catch (e) {
      // Ignore errors for now; UI already updated
    }
  };

  const handleToggleActivityStatus = async () => {
    if (!profile) return;

    const next = !profile.show_activity;
    setProfile({ ...profile, show_activity: next });

    try {
      await updateProfilePrivacy({ show_activity: next }, profile.id || "");
    } catch (e) {}
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Privacy & Visibility</Text>
      </View>
      <Text style={styles.subtitle}>
        Control how others see your profile and activity.
      </Text>

      {/* Profile Visibility */}
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={handleCycleVisibility}
      >
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Profile Visibility</Text>
          <Text style={styles.rowHint}>Who can see your profile</Text>
        </View>
        <Text style={styles.rowValueHighlight}>{profileVisibility}</Text>
      </TouchableOpacity>

      {/* Activity Status */}
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={handleToggleActivityStatus}
      >
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Activity Status</Text>
          <Text style={styles.rowHint}>Show when you're online</Text>
        </View>
        <View
          style={[
            styles.toggleIndicator,
            profile?.show_activity
              ? styles.toggleIndicatorActive
              : styles.toggleIndicatorInactive,
          ]}
        >
          <View
            style={[
              styles.toggleDot,
              profile?.show_activity
                ? styles.toggleDotActive
                : styles.toggleDotInactive,
            ]}
          />
        </View>
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
  rowHint: {
    fontSize: 11,
    color: "#9ca3af",
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },
  rowValueHighlight: {
    fontSize: 13,
    color: "#eb7825",
    fontWeight: "500",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dropdownCard: {
    backgroundColor: "white",
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 260,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  dropdownTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownOptionText: {
    fontSize: 15,
    color: "#111827",
  },
  toggleIndicator: {
    width: 32,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#22c55e",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  toggleIndicatorActive: {
    backgroundColor: "#22c55e",
  },
  toggleIndicatorInactive: {
    backgroundColor: "#f4f3f4",
  },
  toggleDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: "white",
    alignSelf: "flex-end",
  },

  toggleDotActive: {
    alignSelf: "flex-end",
  },
  toggleDotInactive: {
    alignSelf: "flex-start",
    width: 12,
    height: 12,
    borderRadius: 999,
  },
});
