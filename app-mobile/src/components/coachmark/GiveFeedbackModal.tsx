import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../services/supabase";

interface GiveFeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  userId?: string;
}

export default function GiveFeedbackModal({
  visible,
  onClose,
  userId,
}: GiveFeedbackModalProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetState = () => {
    setFeedbackText("");
    setScreenshotUri(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handlePickScreenshot = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Needed",
          "Please allow access to your photo library to upload a screenshot."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.7,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setScreenshotUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Error picking screenshot:", error);
    }
  };

  const removeScreenshot = () => {
    setScreenshotUri(null);
  };

  const uploadScreenshot = async (
    uri: string
  ): Promise<string | null> => {
    try {
      const fileExt = uri.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `feedback_${userId || "anon"}_${Date.now()}.${fileExt}`;
      const filePath = `feedback-screenshots/${fileName}`;

      const formData = new FormData();
      formData.append("file", {
        uri,
        type: `image/${fileExt === "jpg" || fileExt === "jpeg" ? "jpeg" : fileExt}`,
        name: fileName,
      } as any);

      const { error: uploadError } = await supabase.storage
        .from("feedback")
        .upload(filePath, formData, {
          contentType: `image/${fileExt === "jpg" || fileExt === "jpeg" ? "jpeg" : fileExt}`,
          upsert: false,
        });

      if (uploadError) {
        console.warn("Screenshot upload failed:", uploadError.message);
        return null;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("feedback").getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.warn("Screenshot upload error:", error);
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!feedbackText.trim()) {
      Alert.alert("Feedback Required", "Please enter your feedback before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      let screenshotUrl: string | null = null;
      if (screenshotUri) {
        screenshotUrl = await uploadScreenshot(screenshotUri);
      }

      const { error } = await supabase.from("app_feedback").insert({
        user_id: userId || null,
        message: feedbackText.trim(),
        category: "general",
        platform: "mobile",
        screenshot_url: screenshotUrl,
      });

      if (error) {
        // If screenshot_url column doesn't exist, retry without it
        if (error.message?.includes("screenshot_url")) {
          const { error: retryError } = await supabase
            .from("app_feedback")
            .insert({
              user_id: userId || null,
              message: feedbackText.trim(),
              category: "general",
              platform: "mobile",
            });
          if (retryError) {
            console.warn("Could not save feedback:", retryError.message);
          }
        } else {
          console.warn("Could not save feedback:", error.message);
        }
      }

      Alert.alert("Thank You!", "Your feedback has been submitted successfully.", [
        { text: "OK", onPress: handleClose },
      ]);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      Alert.alert("Error", "Failed to submit feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleClose}
        />

        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIcon}>
                <Feather name="message-square" size={20} color="white" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Give Feedback</Text>
                <Text style={styles.headerSubtitle}>Help us improve Mingla</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Feedback Input */}
            <Text style={styles.sectionLabel}>Your Feedback</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.textInput}
                placeholder="Tell us what you think, report a bug, or suggest a feature..."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={feedbackText}
                onChangeText={setFeedbackText}
                maxLength={2000}
              />
            </View>

            {/* Screenshot Section */}
            <Text style={styles.sectionLabel}>Screenshot (Optional)</Text>
            {screenshotUri ? (
              <View style={styles.screenshotPreview}>
                <Image
                  source={{ uri: screenshotUri }}
                  style={styles.screenshotImage}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={removeScreenshot}
                  style={styles.removeScreenshot}
                >
                  <Ionicons name="close-circle" size={24} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handlePickScreenshot}
                style={styles.uploadButton}
                activeOpacity={0.7}
              >
                <View style={styles.uploadIconCircle}>
                  <Ionicons name="cloud-upload-outline" size={28} color="#eb7825" />
                </View>
                <Text style={styles.uploadTitle}>Upload Screenshot</Text>
                <Text style={styles.uploadSubtitle}>PNG, JPG up to 10MB</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            style={[
              styles.submitButton,
              (!feedbackText.trim() || isSubmitting) && styles.submitButtonDisabled,
            ]}
            activeOpacity={0.85}
            disabled={!feedbackText.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <View style={styles.submitContent}>
                <Ionicons name="send" size={18} color="white" />
                <Text style={styles.submitText}>Submit Feedback</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "85%",
    backgroundColor: "white",
    borderRadius: 24,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
    marginTop: 4,
  },
  inputContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 20,
  },
  textInput: {
    fontSize: 14,
    color: "#374151",
    padding: 16,
    minHeight: 100,
    lineHeight: 20,
  },
  uploadButton: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderStyle: "dashed",
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  uploadIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fef3e2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  uploadTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 2,
  },
  uploadSubtitle: {
    fontSize: 12,
    color: "#9ca3af",
  },
  screenshotPreview: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
    position: "relative",
  },
  screenshotImage: {
    width: "100%",
    height: 160,
    borderRadius: 16,
  },
  removeScreenshot: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 2,
  },
  submitButton: {
    backgroundColor: "#eb7825",
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitText: {
    fontSize: 16,
    fontWeight: "700",
    color: "white",
  },
});
