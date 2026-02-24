import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Platform,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.mingla.app.v2";
const APP_STORE_URL =
  "https://apps.apple.com/app/mingla/id000000000"; // Update with real App Store ID

interface FeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmitFeedback?: (feedback: {
    rating: number;
    message: string;
    category: string;
  }) => Promise<void> | void;
}

const FEEDBACK_CATEGORIES = [
  { id: "general", label: "General", icon: "chatbubble-outline" },
  { id: "bug", label: "Bug Report", icon: "bug-outline" },
  { id: "feature", label: "Feature Request", icon: "bulb-outline" },
  { id: "experience", label: "Experience", icon: "heart-outline" },
];

type Step = "rate" | "feedback" | "store-prompt" | "thank-you";

export default function FeedbackModal({
  visible,
  onClose,
  onSubmitFeedback,
}: FeedbackModalProps) {
  const [step, setStep] = useState<Step>("rate");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("general");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetState = () => {
    setStep("rate");
    setRating(0);
    setHoverRating(0);
    setFeedbackText("");
    setSelectedCategory("general");
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleRatingSelect = (star: number) => {
    setRating(star);
    // If 4-5 stars, go to store prompt first, then feedback
    // If 1-3 stars, go to feedback form directly
    if (star >= 4) {
      setStep("store-prompt");
    } else {
      setStep("feedback");
    }
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackText.trim() && rating === 0) return;

    setIsSubmitting(true);
    try {
      if (onSubmitFeedback) {
        await onSubmitFeedback({
          rating,
          message: feedbackText.trim(),
          category: selectedCategory,
        });
      }
      setStep("thank-you");
    } catch (error) {
      console.error("Error submitting feedback:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenStore = async () => {
    const url = Platform.OS === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch (error) {
      console.error("Error opening store:", error);
    }
    // After attempting to open store, show feedback form
    setStep("feedback");
  };

  const handleSkipStore = () => {
    setStep("feedback");
  };

  const renderStars = () => {
    const displayRating = hoverRating || rating;
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => handleRatingSelect(star)}
            onPressIn={() => setHoverRating(star)}
            onPressOut={() => setHoverRating(0)}
            activeOpacity={0.7}
            style={styles.starButton}
          >
            <Ionicons
              name={star <= displayRating ? "star" : "star-outline"}
              size={40}
              color={star <= displayRating ? "#FBBF24" : "#D1D5DB"}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderRateStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.emojiContainer}>
        <Text style={styles.emoji}>💬</Text>
      </View>
      <Text style={styles.title}>How's your experience?</Text>
      <Text style={styles.subtitle}>
        We'd love to hear how Mingla is working for you
      </Text>
      {renderStars()}
      <Text style={styles.ratingHint}>Tap a star to rate</Text>
    </View>
  );

  const renderStorePrompt = () => (
    <View style={styles.stepContent}>
      <View style={styles.emojiContainer}>
        <Text style={styles.emoji}>🎉</Text>
      </View>
      <Text style={styles.title}>We're glad you love Mingla!</Text>
      <Text style={styles.subtitle}>
        Would you mind leaving us a review on the{" "}
        {Platform.OS === "ios" ? "App Store" : "Play Store"}? It really helps!
      </Text>

      <View style={styles.storeStarsDisplay}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= rating ? "star" : "star-outline"}
            size={28}
            color={star <= rating ? "#FBBF24" : "#D1D5DB"}
          />
        ))}
      </View>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleOpenStore}
        activeOpacity={0.8}
      >
        <Ionicons
          name={Platform.OS === "ios" ? "logo-apple" : "logo-google-playstore"}
          size={20}
          color="#FFFFFF"
        />
        <Text style={styles.primaryButtonText}>
          Rate on {Platform.OS === "ios" ? "App Store" : "Play Store"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.textButton}
        onPress={handleSkipStore}
        activeOpacity={0.6}
      >
        <Text style={styles.textButtonLabel}>
          Skip, I'll leave written feedback instead
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderFeedbackStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.feedbackHeader}>
        <Text style={styles.title}>
          {rating >= 4 ? "Anything else to add?" : "Tell us more"}
        </Text>
        <Text style={styles.subtitle}>
          {rating >= 4
            ? "Share any additional thoughts or suggestions"
            : "Your feedback helps us improve Mingla"}
        </Text>
      </View>

      {/* Category pills */}
      <View style={styles.categoriesRow}>
        {FEEDBACK_CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.categoryPill,
              selectedCategory === cat.id && styles.categoryPillSelected,
            ]}
            onPress={() => setSelectedCategory(cat.id)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={cat.icon as any}
              size={14}
              color={selectedCategory === cat.id ? "#FFFFFF" : colors.gray500}
            />
            <Text
              style={[
                styles.categoryPillText,
                selectedCategory === cat.id && styles.categoryPillTextSelected,
              ]}
            >
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Selected rating display */}
      {rating > 0 && (
        <View style={styles.ratingDisplay}>
          <Text style={styles.ratingDisplayLabel}>Your rating:</Text>
          <View style={styles.ratingDisplayStars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={star <= rating ? "star" : "star-outline"}
                size={16}
                color={star <= rating ? "#FBBF24" : "#D1D5DB"}
              />
            ))}
          </View>
        </View>
      )}

      {/* Feedback text input */}
      <TextInput
        style={styles.feedbackInput}
        multiline
        placeholder="What's on your mind? Share your thoughts, report a bug, or suggest a feature..."
        placeholderTextColor={colors.gray400}
        value={feedbackText}
        onChangeText={setFeedbackText}
        textAlignVertical="top"
        maxLength={1000}
      />
      <Text style={styles.charCount}>
        {feedbackText.length}/1000
      </Text>

      {/* Submit button */}
      <TouchableOpacity
        style={[
          styles.primaryButton,
          (!feedbackText.trim() && rating === 0) && styles.primaryButtonDisabled,
        ]}
        onPress={handleSubmitFeedback}
        disabled={(!feedbackText.trim() && rating === 0) || isSubmitting}
        activeOpacity={0.8}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="send" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Submit Feedback</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderThankYou = () => (
    <View style={styles.stepContent}>
      <View style={styles.emojiContainer}>
        <Text style={styles.emoji}>✨</Text>
      </View>
      <Text style={styles.title}>Thank You!</Text>
      <Text style={styles.subtitle}>
        Your feedback means the world to us. We'll use it to make Mingla even
        better.
      </Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleClose}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  const renderContent = () => {
    switch (step) {
      case "rate":
        return renderRateStep();
      case "store-prompt":
        return renderStorePrompt();
      case "feedback":
        return renderFeedbackStep();
      case "thank-you":
        return renderThankYou();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.modalContainer}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={20} color={colors.gray500} />
          </TouchableOpacity>

          {/* Step indicator */}
          {step !== "thank-you" && (
            <View style={styles.stepIndicator}>
              {(["rate", "feedback"] as Step[]).map((s, i) => (
                <View
                  key={s}
                  style={[
                    styles.stepDot,
                    (step === s ||
                      (step === "store-prompt" && s === "rate")) &&
                      styles.stepDotActive,
                    (step === "feedback" && s === "rate") && styles.stepDotCompleted,
                    (step === "store-prompt" && s === "rate") && styles.stepDotCompleted,
                  ]}
                />
              ))}
            </View>
          )}

          {renderContent()}

          {/* Back button for feedback and store-prompt steps */}
          {(step === "feedback" || step === "store-prompt") && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setStep("rate");
                setRating(0);
              }}
              activeOpacity={0.6}
            >
              <Ionicons name="chevron-back" size={18} color={colors.gray500} />
              <Text style={styles.backButtonText}>Change rating</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  overlayBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContainer: {
    width: SCREEN_WIDTH - 40,
    maxWidth: 400,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray100,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  stepIndicator: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 20,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gray200,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  stepDotCompleted: {
    backgroundColor: colors.primary,
  },
  stepContent: {
    alignItems: "center",
    paddingTop: 8,
  },
  emojiContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FEF3E7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emoji: {
    fontSize: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.gray900,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.gray500,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  starsContainer: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  starButton: {
    padding: 4,
  },
  ratingHint: {
    fontSize: 13,
    color: colors.gray400,
    marginTop: 4,
  },
  storeStarsDisplay: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 24,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    width: "100%",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    backgroundColor: "#FDDCAB",
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  textButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  textButtonLabel: {
    fontSize: 14,
    color: colors.gray500,
    fontWeight: "500",
  },
  feedbackHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  categoriesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginBottom: 16,
    width: "100%",
  },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: "#FFFFFF",
  },
  categoryPillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.gray600,
  },
  categoryPillTextSelected: {
    color: "#FFFFFF",
  },
  ratingDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.gray50,
    borderRadius: 10,
  },
  ratingDisplayLabel: {
    fontSize: 13,
    color: colors.gray500,
    fontWeight: "500",
  },
  ratingDisplayStars: {
    flexDirection: "row",
    gap: 2,
  },
  feedbackInput: {
    width: "100%",
    height: 120,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.gray800,
    backgroundColor: colors.gray50,
    marginBottom: 4,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 12,
    color: colors.gray400,
    textAlign: "right",
    width: "100%",
    marginBottom: 16,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 8,
  },
  backButtonText: {
    fontSize: 14,
    color: colors.gray500,
    fontWeight: "500",
  },
});
