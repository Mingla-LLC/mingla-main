import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { cameraService } from "../../services/cameraService";
import { authService } from "../../services/authService";
import { useAppStore } from "../../store/appStore";

interface ProfilePhotoSectionProps {
  profileImageSrc: string | null;
  onProfileImageUpdate?: (newImageUrl: string) => void;
}

// Standalone Profile Photo section.
// Logic is the same as in ProfileSettings, just moved here.
export default function ProfilePhotoSection({
  profileImageSrc,
  onProfileImageUpdate,
}: ProfilePhotoSectionProps) {
  const [isUploading, setIsUploading] = useState(false);
  const user = useAppStore((state) => state.user);

  const handleAvatarChange = () => {
    Alert.alert(
      "Change Profile Photo",
      "Choose how you want to update your profile photo",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Take Photo",
          onPress: handleTakePhoto,
        },
        {
          text: "Choose from Gallery",
          onPress: handlePickFromLibrary,
        },
      ]
    );
  };

  const handleTakePhoto = async () => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to update your profile photo.");
      return;
    }

    try {
      const result = await cameraService.takePhoto({
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio for profile photos
        quality: 0.8,
        compress: true,
        maxWidth: 800,
        maxHeight: 800,
      });

      if (result && result.uri) {
        await uploadProfilePhoto(result.uri);
      }
    } catch (error) {
      console.error("Error taking photo:", error);
      Alert.alert("Error", "Failed to take photo. Please try again.");
    }
  };

  const handlePickFromLibrary = async () => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to update your profile photo.");
      return;
    }

    try {
      const result = await cameraService.pickFromLibrary({
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio for profile photos
        quality: 0.8,
        compress: true,
        maxWidth: 800,
        maxHeight: 800,
      });

      if (result && result.uri) {
        await uploadProfilePhoto(result.uri);
      }
    } catch (error) {
      console.error("Error picking from library:", error);
      Alert.alert("Error", "Failed to select image. Please try again.");
    }
  };

  const uploadProfilePhoto = async (imageUri: string) => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to update your profile photo.");
      return;
    }

    setIsUploading(true);

    try {
      const publicUrl = await authService.uploadProfilePhoto(user.id, imageUri);

      if (publicUrl) {
        // Notify parent component of the update
        if (onProfileImageUpdate) {
          onProfileImageUpdate(publicUrl);
        }
        Alert.alert("Success", "Profile photo updated successfully!");
      } else {
        Alert.alert("Error", "Failed to upload profile photo. Please try again.");
      }
    } catch (error) {
      console.error("Error uploading profile photo:", error);
      Alert.alert("Error", "Failed to upload profile photo. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Profile Photo</Text>

      <View style={styles.profilePhotoContainer}>
        <View style={styles.avatarContainer}>
          <TouchableOpacity
            onPress={handleAvatarChange}
            style={styles.avatarButton}
            disabled={isUploading}
          >
            {isUploading ? (
              <View style={[styles.avatarImage, styles.uploadingContainer]}>
                <ActivityIndicator size="large" color="#eb7825" />
              </View>
            ) : (
              <>
                <ImageWithFallback
                  source={
                    profileImageSrc
                      ? { uri: profileImageSrc }
                      : {
                          uri: "https://via.placeholder.com/80x80/6b7280/ffffff?text=User",
                        }
                  }
                  style={styles.avatarImage}
                />
                {/* Camera overlay */}
                <View style={styles.cameraOverlay}>
                  <Ionicons name="camera" size={24} color="white" />
                </View>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.photoActions}>
          <TouchableOpacity
            onPress={handleAvatarChange}
            style={[styles.changePhotoButton, isUploading && styles.changePhotoButtonDisabled]}
            disabled={isUploading}
          >
            {isUploading ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator size="small" color="white" style={styles.buttonSpinner} />
                <Text style={styles.changePhotoButtonText}>Uploading...</Text>
              </View>
            ) : (
              <Text style={styles.changePhotoButtonText}>Change Photo</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.photoHint}>
            Upload a new profile photo. Changes are saved automatically.
          </Text>
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
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 50,
    borderWidth: 4,
    borderColor: "#e5e7eb",
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
    backgroundColor: "#eb7825",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
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
  uploadingContainer: {
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  changePhotoButtonDisabled: {
    opacity: 0.6,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonSpinner: {
    marginRight: 4,
  },
});

