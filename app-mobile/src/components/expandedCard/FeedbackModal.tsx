import React, { useState, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "../../store/appStore";
import { experienceFeedbackService } from "../../services/experienceFeedbackService";
import { toastManager } from "../ui/Toast";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface FeedbackModalProps {
  visible: boolean;
  experienceTitle: string;
  cardId: string;
  onClose: () => void;
}

export default function FeedbackModal({
  visible,
  experienceTitle,
  cardId,
  onClose,
}: FeedbackModalProps) {
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAppStore();

  const MAX_CHARS = 500;

  const resetState = useCallback(() => {
    setRating(0);
    setFeedbackText("");
    setIsSubmitting(false);
  }, []);

  const handleSkip = () => {
    resetState();
    onClose();
  };

  const handleSubmit = async () => {
    if (rating === 0) return;
    if (!user?.id) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      await experienceFeedbackService.submitFeedback(user.id, {
        card_id: cardId,
        experience_title: experienceTitle,
        rating,
        feedback_text: feedbackText.trim() || undefined,
      });
      toastManager.success("Thanks for your feedback!", 2000);
    } catch (error) {
      console.error("Error submitting feedback:", error);
      // Don't block — still close the modal
    } finally {
      resetState();
      onClose();
    }
  };

  const renderStars = () => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <TouchableOpacity
          key={i}
          onPress={() => setRating(i)}
          activeOpacity={0.7}
          style={styles.starButton}
        >
          <Ionicons
            name={i <= rating ? "star" : "star-outline"}
            size={40}
            color={i <= rating ? "#F59E0B" : "#D1D5DB"}
          />
        </TouchableOpacity>,
      );
    }
    return stars;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleSkip}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={handleSkip}
        />
        <View style={styles.modalContainer}>
          {/* Orange Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>How was your experience?</Text>
            <Text style={styles.headerSubtitle} numberOfLines={2}>
              {experienceTitle}
            </Text>
          </View>

          {/* Content */}
          <View style={styles.content}>
            {/* Star Rating */}
            <View style={styles.starsContainer}>{renderStars()}</View>

            {/* Text Input */}
            <Text style={styles.inputLabel}>
              Share your thoughts (optional)
            </Text>
            <View style={styles.textInputContainer}>
              <TextInput
                style={styles.textInput}
                placeholder="What did you like or dislike about this experience?"
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={MAX_CHARS}
                value={feedbackText}
                onChangeText={setFeedbackText}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>
                {feedbackText.length}/{MAX_CHARS}
              </Text>
            </View>

            {/* Buttons */}
            <View style={styles.buttonsRow}>
              <TouchableOpacity
                style={styles.skipButton}
                onPress={handleSkip}
                activeOpacity={0.7}
              >
                <Text style={styles.skipButtonText}>Skip</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  rating === 0 && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                activeOpacity={0.7}
                disabled={rating === 0 || isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  overlayBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    maxHeight: "80%",
  },
  header: {
    backgroundColor: "#EA580C",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.85)",
  },
  content: {
    padding: 24,
  },
  starsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 28,
    marginTop: 8,
  },
  starButton: {
    padding: 4,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  textInputContainer: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
    marginBottom: 24,
  },
  textInput: {
    minHeight: 100,
    padding: 14,
    fontSize: 15,
    color: "#1F2937",
    lineHeight: 22,
  },
  charCount: {
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "right",
    paddingRight: 14,
    paddingBottom: 10,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 12,
  },
  skipButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6B7280",
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#EA580C",
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    backgroundColor: "#FDBA74",
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
