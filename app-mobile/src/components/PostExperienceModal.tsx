import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Animated,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  voiceReviewService,
  voiceReviewRecorder,
  VoiceClip,
} from "../services/voiceReviewService";
import { CalendarService } from "../services/calendarService";
import { useAppStore } from "../store/appStore";
import { toastManager } from "./ui/Toast";
import { colors } from "../constants/colors";
import { PendingExperienceReview } from "../hooks/usePostExperienceCheck";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = "prompt" | "rate" | "record" | "submitting" | "thank-you" | "reschedule";

interface PostExperienceModalProps {
  visible: boolean;
  review: PendingExperienceReview;
  onComplete: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PostExperienceModal({
  visible,
  review,
  onComplete,
}: PostExperienceModalProps) {
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();

  // Step state machine
  const [step, setStep] = useState<Step>("prompt");

  // Rating (Step 2: rate)
  const [rating, setRating] = useState(0);

  // Recording (Step 3: record)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [clips, setClips] = useState<VoiceClip[]>([]);
  const [playingClipIndex, setPlayingClipIndex] = useState<number | null>(null);

  // Submitting (Step 4)
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reschedule (Step 6)
  const [rescheduleDate, setRescheduleDate] = useState<Date | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedDateOption, setSelectedDateOption] = useState<
    "today" | "weekend" | "custom" | null
  >(null);
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Refs
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Reset on visibility change ─────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      setStep("prompt");
      setRating(0);
      setIsRecording(false);
      setRecordingDuration(0);
      setClips([]);
      setPlayingClipIndex(null);
      setSubmitError(null);
      setRescheduleDate(null);
      setRescheduleTime(null);
      setShowDatePicker(false);
      setShowTimePicker(false);
      setSelectedDateOption(null);
      setIsRescheduling(false);
    }
  }, [visible]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // ── Recording pulse animation ──────────────────────────────────────────

  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // ── Recording functions ────────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }

      const result = await voiceReviewRecorder.stopRecording();

      if (result?.uri) {
        setClips((prev) => [...prev, result]);
      }

      setIsRecording(false);
      setRecordingDuration(0);
    } catch (error) {
      console.error("[PostExperienceModal] Failed to stop recording:", error);
      setIsRecording(false);
      setRecordingDuration(0);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (clips.length >= 5) return;

    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        toastManager.error("Microphone permission is required to record");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      await voiceReviewRecorder.startRecording();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      autoStopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, 60000);
    } catch (error) {
      console.error("[PostExperienceModal] Failed to start recording:", error);
      toastManager.error("Could not start recording");
    }
  }, [clips.length, stopRecording]);

  // ── Clip playback / delete ─────────────────────────────────────────────

  const playClip = useCallback(
    async (index: number) => {
      try {
        if (playingClipIndex === index && soundRef.current) {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
          soundRef.current = null;
          setPlayingClipIndex(null);
          return;
        }

        if (soundRef.current) {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri: clips[index].uri },
          { shouldPlay: true }
        );
        soundRef.current = sound;
        setPlayingClipIndex(index);

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync();
            soundRef.current = null;
            setPlayingClipIndex(null);
          }
        });
      } catch (error) {
        console.error("[PostExperienceModal] Failed to play clip:", error);
        setPlayingClipIndex(null);
      }
    },
    [clips, playingClipIndex]
  );

  const deleteClip = useCallback(
    (index: number) => {
      if (playingClipIndex === index && soundRef.current) {
        soundRef.current.stopAsync().catch(() => {});
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
        setPlayingClipIndex(null);
      } else if (playingClipIndex !== null && playingClipIndex > index) {
        setPlayingClipIndex(playingClipIndex - 1);
      }
      setClips((prev) => prev.filter((_, i) => i !== index));
    },
    [playingClipIndex]
  );

  // ── Submit handlers ────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!user?.id) return;
    setStep("submitting");
    setSubmitError(null);
    try {
      await voiceReviewService.submitVoiceReview(user.id, {
        calendarEntryId: review.calendarEntryId,
        cardId: review.cardId,
        placeName: review.placeName,
        placeAddress: review.placeAddress,
        placeCategory: review.placeCategory,
        placePoolId: review.placePoolId,
        googlePlaceId: review.googlePlaceId,
        rating,
        didAttend: true,
        audioClips: clips,
      });
      setStep("thank-you");
    } catch (error) {
      console.error("[PostExperienceModal] Submit failed:", error);
      setSubmitError("Something went wrong. Please try again.");
    }
  }, [user, review, rating, clips]);

  const handleSubmitWithoutAudio = useCallback(async () => {
    if (!user?.id) return;
    setStep("submitting");
    setSubmitError(null);
    try {
      await voiceReviewService.submitVoiceReview(user.id, {
        calendarEntryId: review.calendarEntryId,
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
      setSubmitError("Something went wrong. Please try again.");
    }
  }, [user, review, rating]);

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

      await voiceReviewService.markRescheduled(user.id, review.calendarEntryId);

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
          <Ionicons name="location-outline" size={60} color="#D1D5DB" />
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
          <Ionicons name="checkmark-circle-outline" size={24} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Yes, I went</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setStep("reschedule")}
        >
          <Ionicons name="calendar-outline" size={24} color={colors.primary} />
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
        <Ionicons name="arrow-back" size={24} color={colors.gray800} />
      </TouchableOpacity>

      <Text style={styles.rateTitle}>How was {review.placeName}?</Text>

      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setRating(i)}
            style={styles.starButton}
          >
            <Ionicons
              name={i <= rating ? "star" : "star-outline"}
              size={40}
              color={i <= rating ? "#F59E0B" : "#D1D5DB"}
            />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, rating === 0 && styles.disabledButton]}
        onPress={() => setStep("record")}
        disabled={rating === 0}
      >
        <Text style={styles.primaryButtonText}>Next</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Render: record step ────────────────────────────────────────────────

  const renderRecordStep = () => (
    <View style={styles.recordContainer}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => setStep("rate")}
      >
        <Ionicons name="arrow-back" size={24} color={colors.gray800} />
      </TouchableOpacity>

      <ScrollView
        style={styles.recordScrollContent}
        contentContainerStyle={styles.recordScrollContentContainer}
      >
        <Text style={styles.recordTitle}>Tell us about your experience</Text>
        <Text style={styles.recordSubtitle}>
          Record a voice note (up to 5 clips, 1 min each)
        </Text>

        {!isRecording ? (
          <>
            <TouchableOpacity
              style={styles.micButton}
              onPress={startRecording}
              disabled={clips.length >= 5}
            >
              <Ionicons name="mic-outline" size={48} color={colors.gray500} />
            </TouchableOpacity>
            <Text style={styles.micHint}>Tap to record</Text>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.micButtonRecording}
              onPress={stopRecording}
            >
              <Animated.View
                style={[
                  styles.recordingPulse,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              />
              <Ionicons name="stop" size={32} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.recordingTimer}>
              {formatDuration(recordingDuration)}
            </Text>
            <Text style={styles.micHint}>Tap to stop</Text>
          </>
        )}

        {clips.length > 0 && (
          <View style={styles.clipList}>
            {clips.map((clip, index) => (
              <View key={index} style={styles.clipRow}>
                <Text style={styles.clipLabel}>
                  Clip {index + 1} ({formatDuration(Math.round(clip.durationSeconds))})
                </Text>
                <View style={styles.clipActions}>
                  <TouchableOpacity
                    style={styles.clipActionButton}
                    onPress={() => playClip(index)}
                  >
                    <Ionicons
                      name={playingClipIndex === index ? "pause" : "play"}
                      size={20}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clipActionButton}
                    onPress={() => deleteClip(index)}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {clips.length > 0 && clips.length < 5 && !isRecording && (
          <TouchableOpacity style={styles.addClipButton} onPress={startRecording}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.addClipText}>Add another clip</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.recordBottomActions}>
        {clips.length > 0 ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSubmit}
            disabled={isRecording}
          >
            <Text style={styles.primaryButtonText}>Submit review</Text>
          </TouchableOpacity>
        ) : null}

        {!isRecording && (
          <TouchableOpacity
            onPress={handleSubmitWithoutAudio}
            style={styles.skipLink}
          >
            <Text style={styles.skipLinkText}>Skip recording</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // ── Render: submitting step ────────────────────────────────────────────

  const renderSubmittingStep = () => (
    <View style={styles.centerContainer}>
      {!submitError ? (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.submittingText}>Submitting your review...</Text>
        </>
      ) : (
        <>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={styles.errorText}>{submitError}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // ── Render: thank-you step ─────────────────────────────────────────────

  const renderThankYouStep = () => (
    <View style={styles.centerContainer}>
      <Ionicons name="checkmark-circle" size={80} color="#10B981" />
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
        <Ionicons name="arrow-back" size={24} color={colors.gray800} />
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
          <Ionicons
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
          <Ionicons
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
          <Ionicons
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
        {step === "prompt" && renderPromptStep()}
        {step === "rate" && renderRateStep()}
        {step === "record" && renderRecordStep()}
        {step === "submitting" && renderSubmittingStep()}
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
  // -- Record Step --
  recordContainer: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 24,
  },
  recordScrollContent: {
    flex: 1,
  },
  recordScrollContentContainer: {
    flexGrow: 1,
  },
  recordTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.gray900,
    textAlign: "center",
  },
  recordSubtitle: {
    fontSize: 15,
    color: colors.gray500,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
  },
  micButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.gray100,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  micButtonRecording: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    overflow: "visible",
  },
  recordingPulse: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(239, 68, 68, 0.3)",
  },
  recordingTimer: {
    fontSize: 24,
    fontWeight: "600",
    color: "#EF4444",
    textAlign: "center",
    marginTop: 12,
  },
  micHint: {
    fontSize: 14,
    color: colors.gray400,
    textAlign: "center",
    marginTop: 8,
  },
  clipList: {
    marginTop: 24,
  },
  clipRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.gray50,
    borderRadius: 12,
    marginBottom: 8,
  },
  clipLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.gray700,
  },
  clipActions: {
    flexDirection: "row",
    gap: 12,
  },
  clipActionButton: {
    padding: 8,
  },
  addClipButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  addClipText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: "600",
  },
  recordBottomActions: {
    marginTop: "auto",
    paddingBottom: 24,
  },
  skipLink: {
    alignSelf: "center",
    paddingVertical: 16,
  },
  skipLinkText: {
    color: colors.gray500,
    fontSize: 15,
    textDecorationLine: "underline",
  },
  // -- Submitting / Thank You --
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  submittingText: {
    fontSize: 17,
    color: colors.gray600,
    marginTop: 16,
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
