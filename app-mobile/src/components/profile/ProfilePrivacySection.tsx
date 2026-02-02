import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
} from "react-native";
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

const SAVED_EXPERIENCES_OPTIONS: { value: boolean; label: string }[] = [
  { value: false, label: "Private" },
  { value: true, label: "Public" },
];

function visibilityToLabel(mode?: "public" | "friends" | "private"): string {
  const opt = VISIBILITY_OPTIONS.find((o) => o.value === mode);
  return opt?.label ?? "Friends Only";
}

function savedExperiencesToLabel(show?: boolean): string {
  const opt = SAVED_EXPERIENCES_OPTIONS.find((o) => o.value === show);
  return opt?.label ?? "Private";
}

// Self-contained Privacy & Visibility card.
export default function ProfilePrivacySection() {
  const { profile, setProfile } = useAppStore();

  const { updateProfilePrivacy } = useEnhancedProfile();
  const [visibilityDropdownVisible, setVisibilityDropdownVisible] =
    useState(false);
  const [savedExperiencesDropdownVisible, setSavedExperiencesDropdownVisible] =
    useState(false);

  const profileVisibility = visibilityToLabel(profile?.visibility_mode);
  const savedExperiencesLabel = savedExperiencesToLabel(
    profile?.show_saved_experiences
  );

  const handleSelectVisibility = async (
    value: "friends" | "public" | "private"
  ) => {
    setVisibilityDropdownVisible(false);
    const ok = await updateProfilePrivacy(
      { visibility_mode: value },
      profile?.id || ""
    );
    if (ok && profile) {
      setProfile({ ...profile, visibility_mode: value });
    }
  };

  const handleToggleActivityStatus = async () => {
    const ok = await updateProfilePrivacy(
      { show_activity: !profile?.show_activity },
      profile?.id || ""
    );
    if (ok && profile) {
      setProfile({ ...profile, show_activity: !profile?.show_activity });
    }
  };

  const handleSelectSavedExperiences = async (value: boolean) => {
    setSavedExperiencesDropdownVisible(false);
    const ok = await updateProfilePrivacy(
      { show_saved_experiences: value },
      profile?.id || ""
    );
    if (ok && profile) {
      setProfile({ ...profile, show_saved_experiences: value });
    }
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
        onPress={() => setVisibilityDropdownVisible(true)}
      >
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Profile Visibility</Text>
          <Text style={styles.rowHint}>Who can see your profile</Text>
          <Text style={styles.rowValue}>{profileVisibility}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </TouchableOpacity>

      <Modal
        visible={visibilityDropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisibilityDropdownVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setVisibilityDropdownVisible(false)}
        >
          <TouchableOpacity
            style={styles.dropdownCard}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={styles.dropdownTitle}>Profile Visibility</Text>
            {VISIBILITY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={styles.dropdownOption}
                onPress={() => handleSelectVisibility(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownOptionText}>{opt.label}</Text>
                {profile?.visibility_mode === opt.value && (
                  <Ionicons name="checkmark" size={20} color="#eb7825" />
                )}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </Pressable>
      </Modal>

      {/* Activity Status */}
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={handleToggleActivityStatus}
      >
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Activity Status</Text>
          <Text style={styles.rowValue}>Show when you're online</Text>
        </View>
        <View
          style={
            (styles.toggleIndicator,
            profile?.show_activity
              ? styles.toggleIndicatorActive
              : styles.toggleIndicatorInactive)
          }
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

      {/* Saved Experiences */}
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => setSavedExperiencesDropdownVisible(true)}
      >
        <View style={styles.rowTextContainer}>
          <Text style={styles.rowLabel}>Saved Experiences</Text>
          <Text style={styles.rowHint}>Share your saved experiences</Text>
          <Text style={styles.rowValue}>{savedExperiencesLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </TouchableOpacity>

      <Modal
        visible={savedExperiencesDropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSavedExperiencesDropdownVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSavedExperiencesDropdownVisible(false)}
        >
          <TouchableOpacity
            style={styles.dropdownCard}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={styles.dropdownTitle}>Saved Experiences</Text>
            {SAVED_EXPERIENCES_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={String(opt.value)}
                style={styles.dropdownOption}
                onPress={() => handleSelectSavedExperiences(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownOptionText}>{opt.label}</Text>
                {profile?.show_saved_experiences === opt.value && (
                  <Ionicons name="checkmark" size={20} color="#eb7825" />
                )}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </Pressable>
      </Modal>
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
    width: 32,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#22c55e",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  toggleIndicatorInactive: {
    width: 32,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#f4f3f4",
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
