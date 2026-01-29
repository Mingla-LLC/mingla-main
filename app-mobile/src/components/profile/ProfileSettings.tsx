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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Feather from '@expo/vector-icons/Feather';
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../../constants/colors";
// import profileImage from '../../../assets/16b1d70844c656f5fea042714a1a4d861495a60b.png';

interface ProfileSettingsProps {
  userIdentity: {
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    memberSince: string;
    profileImage: string | null;
  };
  onUpdateIdentity: (identity: any) => void;
  onNavigateBack: () => void;
}

export default function ProfileSettings({
  userIdentity,
  onUpdateIdentity,
  onNavigateBack,
}: ProfileSettingsProps) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [tempValues, setTempValues] = useState({
    firstName: userIdentity.firstName,
    lastName: userIdentity.lastName,
    username: userIdentity.username,
    email: userIdentity.email,
  });
  const [profileImageSrc] = useState(userIdentity.profileImage || null);

  const handleEditField = (field: string) => {
    setIsEditing(field);
    setTempValues((prev) => ({
      ...prev,
      [field]: userIdentity[field as keyof typeof userIdentity],
    }));
  };

  const handleSaveField = (field: string) => {
    const updatedIdentity = {
      ...userIdentity,
      [field]: tempValues[field as keyof typeof tempValues],
    };
    onUpdateIdentity(updatedIdentity);
    setIsEditing(null);
  };

  const handleCancelEdit = () => {
    setTempValues({
      firstName: userIdentity.firstName,
      lastName: userIdentity.lastName,
      username: userIdentity.username,
      email: userIdentity.email,
    });
    setIsEditing(null);
  };

  const handleAvatarChange = () => {
    // In React Native, you would use a library like react-native-image-picker
    // For now, we'll show an alert with options
    Alert.alert(
      "Change Profile Photo",
      "Choose how you want to update your profile photo",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Take Photo",
          onPress: () => {
            // In a real app, this would open the camera
            Alert.alert(
              "Camera",
              "Camera functionality would be implemented here"
            );
          },
        },
        {
          text: "Choose from Gallery",
          onPress: () => {
            // In a real app, this would open the image picker
            Alert.alert(
              "Gallery",
              "Image picker functionality would be implemented here"
            );
          },
        },
      ]
    );
  };

  const handleInputChange = (field: string, value: string) => {
    setTempValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Removed unused handleKeyPress function

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={onNavigateBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content}>
        {/* Profile Photo Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile Photo</Text>

          <View style={styles.profilePhotoContainer}>
            <View style={styles.avatarContainer}>
              <TouchableOpacity
                onPress={handleAvatarChange}
                style={styles.avatarButton}
              >
                <ImageWithFallback
                  source={
                    profileImageSrc
                      ? { uri: profileImageSrc }
                      : {
                          uri: "https://via.placeholder.com/80x80/6b7280/ffffff?text=User",
                        }
                  }
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 50,
                    borderWidth: 4,
                    borderColor: "#e5e7eb",
                  }}
                />
                {/* Camera overlay */}
                <View style={styles.cameraOverlay}>
                  <Ionicons name="camera" size={24} color="white" />
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.photoActions}>
              <TouchableOpacity
                onPress={handleAvatarChange}
                style={styles.changePhotoButton}
              >
                <Text style={styles.changePhotoButtonText}>Change Photo</Text>
              </TouchableOpacity>
              <Text style={styles.photoHint}>
                Upload a new profile photo. Changes are saved automatically.
              </Text>
            </View>
          </View>
        </View>

        {/* Personal Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <Text style={styles.photoHint}>Your personal details are private and only used to personalize your experience.</Text>

          <View style={styles.formFields}>
            {/* First Name */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>First Name</Text>
                {isEditing === "firstName" ? (
                  <View style={styles.editContainer}>
                    <TextInput
                      value={tempValues.firstName}
                      onChangeText={(text) =>
                        handleInputChange("firstName", text)
                      }
                      style={[styles.textInput, focusedField === "firstName" && styles.textInputFocused]}
                      autoFocus
                      placeholder="Enter first name"
                      onFocus={() => setFocusedField("firstName")}
                      onBlur={() => setFocusedField(null)}
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
                    <Text style={styles.fieldValue}>
                      {userIdentity.firstName}
                    </Text>
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
                      onChangeText={(text) =>
                        handleInputChange("lastName", text)
                      }
                      style={[styles.textInput, focusedField === "lastName" && styles.textInputFocused]}
                      autoFocus
                      placeholder="Enter last name"
                      onFocus={() => setFocusedField("lastName")}
                      onBlur={() => setFocusedField(null)}
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
                    <Text style={styles.fieldValue}>
                      {userIdentity.lastName}
                    </Text>
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
                    <View style={[styles.usernameInputContainer, focusedField === "username" && styles.usernameInputContainerFocused]}>
                      <Text style={styles.usernamePrefix}>@</Text>
                      <TextInput
                        value={tempValues.username}
                        onChangeText={(text) =>
                          handleInputChange(
                            "username",
                            text.toLowerCase().replace(/[^a-z0-9_]/g, "")
                          )
                        }
                        style={styles.usernameTextInput}
                        autoFocus
                        placeholder="username"
                        autoCapitalize="none"
                        onFocus={() => setFocusedField("username")}
                        onBlur={() => setFocusedField(null)}
                      />
                    </View>
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
                    <Text style={styles.fieldValue}>
                      @{userIdentity.username}
                    </Text>
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
          </View>
        </View>

        {/* Account Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>
          <Text style={styles.photoHint}>Manage your account information and preferences.</Text>

          <View style={styles.formFields}>
            {/* Email */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Email</Text>
                {isEditing === "email" ? (
                  <View style={styles.editContainer}>
                    <TextInput
                      value={tempValues.email}
                      onChangeText={(text) =>
                        handleInputChange("email", text)
                      }
                      style={[styles.textInput, focusedField === "email" && styles.textInputFocused]}
                      autoFocus
                      placeholder="Enter email"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      onFocus={() => setFocusedField("email")}
                      onBlur={() => setFocusedField(null)}
                    />
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        onPress={() => handleSaveField("email")}
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
                    <Text style={styles.fieldValue}>
                      {userIdentity.email}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleEditField("email")}
                      style={styles.editButton}
                    >
                      <Feather name="edit-3" size={16} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            {/* Member Since */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <View style={styles.fieldRow}>
                  <Text style={styles.inlineFieldLabel}>Member Since</Text>
                  <Text style={styles.fieldValue}>
                    {userIdentity.memberSince}
                  </Text>
                </View>
              </View>
            </View>

            {/* Account Status */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <View style={styles.fieldRow}>
                  <Text style={styles.inlineFieldLabel}>Account Status</Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>Active</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Privacy and Visibility */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy and Visibility</Text>
          <Text style={styles.photoHint}>Control how others see your profile and activity.</Text>

          <View style={styles.formFields}>
            {/* Profile Visibility */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <View style={styles.fieldRow}>
                  <View style={styles.labelDescriptionContainer}>
                    <Text style={styles.inlineFieldLabel}>Profile Visibility</Text>
                    <Text style={styles.fieldDescription}>Who can see your profile</Text>
                  </View>
                  <Text style={styles.primaryValueText}>Friends only</Text>
                </View>
              </View>
            </View>

            {/* Activity Status */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <View style={styles.fieldRow}>
                  <View style={styles.labelDescriptionContainer}>
                    <Text style={styles.inlineFieldLabel}>Activity Status</Text>
                    <Text style={styles.fieldDescription}>Show when you're online</Text>
                  </View>
                  <View style={styles.onlineIndicator} />
                </View>
              </View>
            </View>

            {/* Saved Experiences */}
            <View style={styles.formField}>
              <View style={styles.fieldContainer}>
                <View style={styles.fieldRow}>
                  <View style={styles.labelDescriptionContainer}>
                    <Text style={styles.inlineFieldLabel}>Saved Experiences</Text>
                    <Text style={styles.fieldDescription}>Share your saved experiences</Text>
                  </View>
                  <Text style={styles.primaryValueText}>Private</Text>
                </View>
              </View>
            </View>

            <View style={styles.noteSection}>
              <Text style={styles.noteText}>
                <Text style={{fontWeight: '700'}}>Note:</Text> These settings affect how your profile appears to other Mingla users. Your personal information is always kept.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    paddingBottom: 50
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
    maxWidth: 150
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
  }
});
