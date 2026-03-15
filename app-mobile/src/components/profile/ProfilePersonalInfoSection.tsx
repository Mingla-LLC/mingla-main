import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import { useAppState } from "../AppStateManager";
import { useAppStore } from "../../store/appStore";
import { authService } from "../../services/authService";
import { mixpanelService } from "../../services/mixpanelService";


interface UserIdentity {
  firstName: string;
  lastName: string;
  username: string;
  profileImage: string | null;
}

// Personal Information section moved out of ProfileSettings.
// Logic is the same, just localized here.
const BIO_MAX_LENGTH = 160;

export default function ProfilePersonalInfoSection() {
  const { userIdentity, handleUserIdentityUpdate } = useAppState();
  const profile = useAppStore((s) => s.profile);

  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [tempValues, setTempValues] = useState({
    firstName: userIdentity.firstName,
    lastName: userIdentity.lastName,
    username: userIdentity.username,
  });
  const [tempBio, setTempBio] = useState(profile?.bio ?? "");

  const handleEditField = (field: string) => {
    setIsEditing(field);
    if (field === "bio") {
      setTempBio(profile?.bio ?? "");
    } else {
      setTempValues((prev) => ({
        ...prev,
        [field]: userIdentity[field as keyof typeof userIdentity],
      }));
    }
  };

  const handleSaveField = async (field: string) => {
    if (field === "bio") {
      if (!profile?.id) return;
      try {
        await authService.updateBio(profile.id, tempBio.trim());
        mixpanelService.trackProfileSettingUpdated({ field: "bio" });
      } catch {
        Alert.alert("Error", "Failed to update bio. Please try again.");
      }
      setIsEditing(null);
      return;
    }

    const updatedIdentity = {
      ...userIdentity,
      [field]: tempValues[field as keyof typeof tempValues],
    };
    handleUserIdentityUpdate(updatedIdentity);

    // Track profile setting updated
    mixpanelService.trackProfileSettingUpdated({ field });

    setIsEditing(null);
  };

  const handleCancelEdit = () => {
    setTempValues({
      firstName: userIdentity.firstName,
      lastName: userIdentity.lastName,
      username: userIdentity.username,
    });
    setTempBio(profile?.bio ?? "");
    setIsEditing(null);
  };

  const handleInputChange = (field: string, value: string) => {
    setTempValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Personal Information</Text>

      <View style={styles.formFields}>
        {/* First Name */}
        <View style={styles.formField}>
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>First Name</Text>
            {isEditing === "firstName" ? (
              <View style={styles.editContainer}>
                <TextInput
                  value={tempValues.firstName}
                  onChangeText={(text) => handleInputChange("firstName", text)}
                  style={styles.textInput}
                  autoFocus
                  placeholder="Enter first name"
                />
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    onPress={() => handleSaveField("firstName")}
                    style={styles.saveButton}
                  >
                    <Ionicons name="checkmark" size={16} color="#10b981" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelEdit}
                    style={styles.cancelButton}
                  >
                    <Ionicons name="close" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.fieldRow}>
                <Text style={styles.fieldValue}>{userIdentity.firstName}</Text>
                <TouchableOpacity
                  onPress={() => handleEditField("firstName")}
                  style={styles.editButton}
                >
                  <Feather name="edit-3" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Last Name */}
        <View style={styles.formField}>
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Last Name</Text>
            {isEditing === "lastName" ? (
              <View style={styles.editContainer}>
                <TextInput
                  value={tempValues.lastName}
                  onChangeText={(text) => handleInputChange("lastName", text)}
                  style={styles.textInput}
                  autoFocus
                  placeholder="Enter last name"
                />
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    onPress={() => handleSaveField("lastName")}
                    style={styles.saveButton}
                  >
                    <Ionicons name="checkmark" size={16} color="#10b981" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelEdit}
                    style={styles.cancelButton}
                  >
                    <Ionicons name="close" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.fieldRow}>
                <Text style={styles.fieldValue}>{userIdentity.lastName}</Text>
                <TouchableOpacity
                  onPress={() => handleEditField("lastName")}
                  style={styles.editButton}
                >
                  <Feather name="edit-3" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Username */}
        <View style={styles.formField}>
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Username</Text>
            {isEditing === "username" ? (
              <View style={styles.editContainer}>
                <TextInput
                  value={tempValues.username}
                  onChangeText={(text) =>
                    handleInputChange(
                      "username",
                      text.toLowerCase().replace(/[^a-z0-9_]/g, "")
                    )
                  }
                  style={styles.textInput}
                  autoFocus
                  placeholder="username"
                  autoCapitalize="none"
                />
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    onPress={() => handleSaveField("username")}
                    style={styles.saveButton}
                  >
                    <Ionicons name="checkmark" size={16} color="#10b981" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelEdit}
                    style={styles.cancelButton}
                  >
                    <Ionicons name="close" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.fieldRow}>
                <Text style={styles.fieldValue}>@{userIdentity.username}</Text>
                <TouchableOpacity
                  onPress={() => handleEditField("username")}
                  style={styles.editButton}
                >
                  <Feather name="edit-3" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>
            )}
            {isEditing === "username" && (
              <Text style={styles.usernameHint}>
                Username can only contain lowercase letters, numbers, and
                underscores.
              </Text>
            )}
          </View>
        </View>

        {/* Bio */}
        <View style={[styles.formField, styles.formFieldLast]}>
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Bio</Text>
            {isEditing === "bio" ? (
              <View style={styles.bioEditContainer}>
                <TextInput
                  value={tempBio}
                  onChangeText={setTempBio}
                  style={styles.bioInput}
                  autoFocus
                  multiline
                  numberOfLines={3}
                  maxLength={BIO_MAX_LENGTH}
                  placeholder="Tell people about yourself"
                  placeholderTextColor="#9ca3af"
                  textAlignVertical="top"
                />
                <View style={styles.bioFooter}>
                  <Text
                    style={[
                      styles.bioCounter,
                      tempBio.length >= BIO_MAX_LENGTH && styles.bioCounterLimit,
                    ]}
                  >
                    {tempBio.length}/{BIO_MAX_LENGTH}
                  </Text>
                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      onPress={() => handleSaveField("bio")}
                      style={styles.saveButton}
                    >
                      <Ionicons name="checkmark" size={16} color="#10b981" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleCancelEdit}
                      style={styles.cancelButton}
                    >
                      <Ionicons name="close" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.fieldRow}>
                <Text
                  style={[
                    styles.fieldValue,
                    !profile?.bio && styles.fieldValuePlaceholder,
                  ]}
                >
                  {profile?.bio || "Not set"}
                </Text>
                <TouchableOpacity
                  onPress={() => handleEditField("bio")}
                  style={styles.editButton}
                >
                  <Feather name="edit-3" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 16,
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
  usernameInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 12,
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
    alignSelf: "flex-end",
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
  formFieldLast: {
    borderBottomWidth: 0,
  },
  fieldValuePlaceholder: {
    color: "#9ca3af",
    fontStyle: "italic",
  },
  bioEditContainer: {
    gap: 8,
  },
  bioInput: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "white",
    height: 80,
  },
  bioFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bioCounter: {
    fontSize: 12,
    color: "#6b7280",
  },
  bioCounterLimit: {
    color: "#ef4444",
  },
});
