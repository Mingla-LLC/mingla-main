import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from './ui/Icon';
import DateTimePicker from "@react-native-community/datetimepicker";
import { voiceReviewService } from "../services/voiceReviewService";
import { CalendarService } from "../services/calendarService";
import { useAppStore } from "../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { toastManager } from "./ui/Toast";
import { colors } from "../constants/colors";
import { PendingExperienceReview } from "../hooks/usePostExperienceCheck";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = "prompt" | "rate" | "thank-you" | "reschedule";

interface PostExperienceModalProps {
  visible: boolean;
  review: PendingExperienceReview;
  onComplete: () => void;
  dismissible?: boolean;
  calendarEntryId?: string | null;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PostExperienceModal({
  visible,
  review,
  onComplete,
  dismissible = false,
  calendarEntryId,
}: PostExperienceModalProps) {
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // Step state machine
  const [step, setStep] = useState<Step>("prompt");

  // Rating
  const [rating, setRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reschedule
  const [rescheduleDate, setRescheduleDate] = useState<Date | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedDateOption, setSelectedDateOption] = useState<
    "today" | "weekend" | "custom" | null
  >(null);
  const [isRescheduling, setIsRescheduling] = useState(false);

  // ── Reset on visibility change ─────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      setStep("prompt");
      setRating(0);
      setIsSubmitting(false);
      setSubmitError(null);
      setRescheduleDate(null);
      setRescheduleTime(null);
      setShowDatePicker(false);
      setShowTimePicker(false);
      setSelectedDateOption(null);
      setIsRescheduling(false);
    }
  }, [visible]);

  // ── Submit handler ─────────────────────────────────────────────────────

  // Resolve the calendar entry ID: prop override takes precedence
  const resolvedCalendarEntryId =
    calendarEntryId !== undefined ? calendarEntryId : review.calendarEntryId;

  const handleSubmit = useCallback(async () => {
    if (!user?.id || rating === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await voiceReviewService.submitVoiceReview(user.id, {
        calendarEntryId: resolvedCalendarEntryId as string,
        cardId: review.cardId,
        placeName: review.placeName,
        placeAddress: review.placeAddress,
        placeCategory: review.placeCategory,
        placePoolId: review.placePoolId,
        googlePlaceId: review.googlePlaceId,
        rating,
        didAttend: true,
        audioClips: [],
      });
      setStep("thank-you");
    } catch (error) {
      console.error("[PostExperienceModal] Submit failed:", error);
      setSubmitError("Something went wrong. Try again.");
      setIsSubmitting(false);
    }
  }, [user, review, rating, resolvedCalendarEntryId]);

  // ── Reschedule ─────────────────────────────────────────────────────────

  const computedRescheduleDateTime = useMemo(() => {
    if (!rescheduleDate) return null;
    const dt = new Date(rescheduleDate);
    if (rescheduleTime) {
      dt.setHours(rescheduleTime.getHours(), rescheduleTime.getMinutes(), 0, 0);
    }
    return dt;
  }, [rescheduleDate, rescheduleTime]);

  const isRescheduleReady = computedRescheduleDateTime !== null;

  const handleSelectDateOption = useCallback(
    (option: "today" | "weekend" | "custom") => {
      setSelectedDateOption(option);

      if (option === "today") {
        const today = new Date();
        setRescheduleDate(today);
        setShowTimePicker(true);
        setShowDatePicker(false);
      } else if (option === "weekend") {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysUntilSaturday = dayOfWeek === 6 ? 0 : 6 - dayOfWeek;
        const saturday = new Date(now);
        saturday.setDate(now.getDate() + daysUntilSaturday);
        saturday.setHours(12, 0, 0, 0);
        setRescheduleDate(saturday);
        setShowTimePicker(true);
        setShowDatePicker(false);
      } else if (option === "custom") {
        setShowDatePicker(true);
        setShowTimePicker(false);
        setRescheduleDate(null);
        setRescheduleTime(null);
      }
    },
    []
  );

  const handleConfirmReschedule = useCallback(async () => {
    if (!computedRescheduleDateTime || !user?.id) return;

    setIsRescheduling(true);
    try {
      const newDateISO = computedRescheduleDateTime.toISOString();

      await CalendarService.updateEntry(review.calendarEntryId, user.id, {
        scheduled_at: newDateISO,
      });

      await supabase
        .from("calendar_entries")
        .update({ feedback_status: null })
        .eq("id", review.calendarEntryId)
        .eq("user_id", user.id);

      queryClient.invalidateQueries({ queryKey: ["calendarEntries"] });
      toastManager.success("Experience rescheduled!");
      onComplete();
    } catch (error) {
      console.error("[PostExperienceModal] Reschedule failed:", error);
      toastManager.error("Failed to reschedule. Please try again.");
    } finally {
      setIsRescheduling(false);
    }
  }, [computedRescheduleDateTime, user, review, onComplete]);

  // ── Render: prompt step ────────────────────────────────────────────────

  const renderPromptStep = () => (
    <View style={styles.container}>
      {review.placeImage ? (
        <Image
          source={{ uri: review.placeImage }}
          style={styles.promptImage}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.promptImageFallback}>
          <Icon name="location-outline" size={60} color="#D1D5DB" />
        </View>
      )}
      <View style={styles.promptContent}>
        <Text style={styles.promptTitle}>{review.placeName}</Text>
        <Text style={styles.promptQuestion}>
          Did you go to {review.placeName}?
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => setStep("rate")}
        >
          <Icon name="checkmark-circle-outline" size={24} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Yes, I went</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setStep("reschedule")}
        >
          <Icon name="calendar-outline" size={24} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>No, I'll go later</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Render: rate step ──────────────────────────────────────────────────

  const renderRateStep = () => (
    <View style={styles.rateContainer}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setStep("prompt")}
      >
        <Icon name="arrow-back" size={24} color={colors.gray800} />
      </TouchableOpacity>

      <Text style={styles.rateTitle}>How was {review.placeName}?</Text>

      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setRating(i)}
            style={styles.starButton}
          >
            <Icon
              name={i <= rating ? "star" : "star-outline"}
              size={40}
              color={i <= rating ? "#F59E0B" : "#D1D5DB"}
            />
          </TouchableOpacity>
        ))}
      </View>

      {submitError && (
        <Text style={styles.errorText}>{submitError}</Text>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, (rating === 0 || isSubmitting) && styles.disabledButton]}
        onPress={handleSubmit}
        disabled={rating === 0 || isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Submit</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  // ── Render: thank-you step ─────────────────────────────────────────────

  const renderThankYouStep = () => (
    <View style={styles.centerContainer}>
      <Icon name="checkmark-circle" size={80} color="#10B981" />
      <Text style={styles.thankYouTitle}>Thank you!</Text>
      <Text style={styles.thankYouSubtitle}>
        Your feedback helps everyone find better experiences.
      </Text>
      <TouchableOpacity
        style={[styles.primaryButton, styles.thankYouButton]}
        onPress={onComplete}
      >
        <Text style={styles.primaryButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Render: reschedule step ────────────────────────────────────────────

  const renderRescheduleStep = () => (
    <View style={styles.rescheduleContainer}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setStep("prompt")}
      >
        <Icon name="arrow-back" size={24} color={colors.gray800} />
      </TouchableOpacity>

      <Text style={styles.rescheduleTitle}>
        Pick a new date for {review.placeName}
      </Text>

      <View style={styles.dateOptionsContainer}>
        <TouchableOpacity
          style={[
            styles.dateOptionButton,
            selectedDateOption === "today" && styles.dateOptionButtonSelected,
          ]}
          onPress={() => handleSelectDateOption("today")}
        >
          <Icon
            name="today-outline"
            size={20}
            color={selectedDateOption === "today" ? "#FFFFFF" : colors.gray700}
          />
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "today" && styles.dateOptionTextSelected,
            ]}
          >
            Today
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.dateOptionButton,
            selectedDateOption === "weekend" && styles.dateOptionButtonSelected,
          ]}
          onPress={() => handleSelectDateOption("weekend")}
        >
          <Icon
            name="sunny-outline"
            size={20}
            color={selectedDateOption === "weekend" ? "#FFFFFF" : colors.gray700}
          />
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "weekend" && styles.dateOptionTextSelected,
            ]}
          >
            This weekend
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.dateOptionButton,
            selectedDateOption === "custom" && styles.dateOptionButtonSelected,
          ]}
          onPress={() => handleSelectDateOption("custom")}
        >
          <Icon
            name="calendar-outline"
            size={20}
            color={selectedDateOption === "custom" ? "#FFFFFF" : colors.gray700}
          />
          <Text
            style={[
              styles.dateOptionText,
              selectedDateOption === "custom" && styles.dateOptionTextSelected,
            ]}
          >
            Custom date
          </Text>
        </TouchableOpacity>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={rescheduleDate || new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          minimumDate={new Date()}
          onChange={(event, selectedDate) => {
            if (Platform.OS === "android") {
              setShowDatePicker(false);
            }
            if (selectedDate) {
              setRescheduleDate(selectedDate);
              setShowTimePicker(true);
            }
          }}
        />
      )}

      {showTimePicker && rescheduleDate && (
        <DateTimePicker
          value={rescheduleTime || rescheduleDate}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, selectedTime) => {
            if (Platform.OS === "android") {
              setShowTimePicker(false);
            }
            if (selectedTime) {
              setRescheduleTime(selectedTime);
            }
          }}
        />
      )}

      <TouchableOpacity
        style={[
          styles.primaryButton,
          !isRescheduleReady && styles.disabledButton,
        ]}
        onPress={handleConfirmReschedule}
        disabled={!isRescheduleReady || isRescheduling}
      >
        {isRescheduling ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Confirm</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  // ── Root render ────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={() => {}}
    >
      <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]} edges={['top', 'left', 'right']}>
        {dismissible && (
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={onComplete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Icon name="close" size={24} color={colors.gray800} />
          </TouchableOpacity>
        )}
        {step === "prompt" && renderPromptStep()}
        {step === "rate" && renderRateStep()}
        {step === "thank-you" && renderThankYouStep()}
        {step === "reschedule" && renderRescheduleStep()}
      </SafeAreaView>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  dismissButton: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  // -- Prompt Step --
  promptImage: {
    width: "100%",
    height: 280,
  },
  promptImageFallback: {
    width: "100%",
    height: 280,
    backgroundColor: colors.gray100,
    alignItems: "center",
    justifyContent: "center",
  },
  promptContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  promptTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.gray900,
    textAlign: "center",
    marginBottom: 8,
  },
  promptQuestion: {
    fontSize: 18,
    color: colors.gray600,
    textAlign: "center",
    marginBottom: 32,
  },
  // -- Buttons --
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 24,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 24,
    marginTop: 12,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.4,
  },
  // -- Back Button --
  backButton: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  // -- Rate Step --
  rateContainer: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 24,
  },
  rateTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.gray900,
    textAlign: "center",
  },
  starsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginVertical: 32,
  },
  starButton: {
    padding: 4,
  },
  // -- Thank You --
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 24,
  },
  thankYouTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.gray900,
    marginTop: 24,
  },
  thankYouButton: {
    marginTop: 32,
  },
  thankYouSubtitle: {
    fontSize: 16,
    color: colors.gray500,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 32,
  },
  // -- Reschedule Step --
  rescheduleContainer: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 24,
  },
  rescheduleTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.gray900,
    textAlign: "center",
    marginBottom: 8,
  },
  dateOptionsContainer: {
    flexDirection: "column",
    gap: 12,
    marginVertical: 24,
  },
  dateOptionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    backgroundColor: "#FFFFFF",
  },
  dateOptionButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dateOptionText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.gray700,
  },
  dateOptionTextSelected: {
    color: "#FFFFFF",
  },
});
