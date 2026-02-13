import * as React from "react";
import { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { SafeAreaView } from "react-native-safe-area-context";
import ProfileAccountSection from "./ProfileAccountSection";
import ProfilePrivacySection from "./ProfilePrivacySection";
// Profile photo moved to hero on ProfilePage
import ProfilePersonalInfoSection from "./ProfilePersonalInfoSection";
import { colors } from "@/src/constants/colors";
import { useAppState } from "../AppStateManager";
// import profileImage from '../../../assets/16b1d70844c656f5fea042714a1a4d861495a60b.png';

interface ProfileSettingsProps {
  onUpdateIdentity: (identity: any) => void;
  onNavigateBack: () => void;
}

export default function ProfileSettings({
  onUpdateIdentity,
  onNavigateBack,
}: ProfileSettingsProps) {
  // Removed unused handleKeyPress function

  const { userIdentity, handleUserIdentityUpdate } = useAppState();
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={onNavigateBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile Settings</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {/* Content */}
        <ScrollView style={styles.content}>
          {/* Profile Photo is handled in the ProfilePage hero now. */}

          {/* Personal Information */}
          <ProfilePersonalInfoSection />

          {/* Account Information & Privacy Sections */}
          <ProfileAccountSection />
          <ProfilePrivacySection />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    paddingTop: 8,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  profilePhotoContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatarContainer: {
    position: "relative",
  },
  avatarButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: "hidden",
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  photoActions: {
    flex: 1,
  },
  changePhotoButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    maxWidth: 150,
  },
  changePhotoButtonText: {
    color: "white",
    fontWeight: "500",
    fontSize: 16,
  },
  photoHint: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 8,
    lineHeight: 20,
  },
  formFields: {
    gap: 0,
  },
  formField: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  fieldContainer: {
    flex: 1,
  },
  fieldLabel: {
    color: "#374151",
    fontWeight: "500",
    fontSize: 14,
    marginBottom: 8,
  },
  inlineFieldLabel: {
    color: "#374151",
    fontWeight: "500",
    fontSize: 14,
  },
  fieldValue: {
    fontSize: 16,
    color: "#111827",
    fontWeight: "500",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editContainer: {
    gap: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "white",
  },
  textInputFocused: {
    borderColor: colors.primary,
  },
  usernameInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 12,
  },
  usernameInputContainerFocused: {
    borderColor: colors.primary,
  },
  usernameTextInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "white",
  },
  usernamePrefix: {
    fontSize: 16,
    color: "#6b7280",
    marginRight: 4,
  },
  usernameHint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
    fontStyle: "italic",
  },
  actionButtons: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  saveButton: {
    padding: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    padding: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  editButton: {
    padding: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadge: {
    backgroundColor: "#dcfce7",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: "#16a34a",
    fontSize: 14,
    fontWeight: "600",
  },
  labelDescriptionContainer: {
    flex: 1,
  },
  fieldDescription: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  primaryValueText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.primary,
  },
  onlineIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#10b981",
  },
  noteSection: {
    padding: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    backgroundColor: "#f5e6dc",
    marginTop: 16,
  },
  noteText: {
    color: colors.primary,
    fontSize: 12,
  },
});
