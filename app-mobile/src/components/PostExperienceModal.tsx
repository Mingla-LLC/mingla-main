import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { supabase } from "../services/supabase";
import { CalendarService } from "../services/calendarService";
import { useAppStore } from "../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { toastManager } from "./ui/Toast";
import { colors } from "../constants/colors";
import { PendingExperienceReview } from "../hooks/usePostExperienceCheck";
import { useTranslation } from "react-i18next";
import { mixpanelService } from "../services/mixpanelService";
import { VoluntaryPlaceReviewRequest } from "../store/placeReviewRequestStore";
import { useSubmitVoluntaryPlaceReview } from "../hooks/usePlaceReviews";
import { PlaceReviewWriteError } from "../services/placeReviewService";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = "prompt" | "rate" | "thank-you" | "reschedule";

interface PostExperienceModalProps {
  visible: boolean;
  review: PendingExperienceReview;
  onComplete: () => void;
  /**
   * #1687 — invoked when the user CLOSES without submitting. Distinct from
   * `onComplete` because a cancelled voluntary review must leave nothing behind,
   * including the "Thank you" flash on the deck control. Falls back to
   * `onComplete` when not supplied, which is the scheduled path's behaviour today.
   */
  onCancel?: () => void;
  dismissible?: boolean;
  calendarEntryId?: string | null;
  /**
   * #1687 — the VOLUNTARY entry: the user tapped "Been here" on the collapsed
   * deck card. When set, this modal:
   *   - opens on the RATING step (the tap already answered "did you go?"),
   *   - carries a close icon (`dismissible`), because the tap may be a mistake,
   *   - offers no reschedule (there is no calendar entry to move), and
   *   - RECORDS THE VISIT as part of submit — see `placeReviewService`.
   * Null/absent on the scheduled path, which is unchanged.
   */
  voluntaryVisit?: VoluntaryPlaceReviewRequest | null;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PostExperienceModal({
  visible,
  review,
  onComplete,
  onCancel,
  dismissible = false,
  calendarEntryId,
  voluntaryVisit = null,
}: PostExperienceModalProps) {
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['modals', 'common']);

  // #1687 — the voluntary entry. Everything that differs from the scheduled
  // prompt keys off this one boolean.
  const isVoluntary = voluntaryVisit !== null && voluntaryVisit !== undefined;
  const initialStep: Step = isVoluntary ? "rate" : "prompt";

  const submitVoluntary = useSubmitVoluntaryPlaceReview();
  /**
   * Set whenever the visit landed and the review insert did not. A retry then
   * skips the re-record: `record-visit` upserts `visited_at` at execution time,
   * so recording twice rewrites the recorded time of the user's own visit.
   *
   * #1687 rework 3 — nothing deletes that row any more, so this id is never
   * pointing at something that has since been removed. That ambiguity is what
   * the rollback introduced and it is gone with it.
   */
  const recordedVisitIdRef = useRef<string | null>(null);

  // Step state machine
  const [step, setStep] = useState<Step>(initialStep);

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

  // #1687 — also re-armed when the ENTRY or the target changes, not only on the
  // visible edge. The single mount is shared by both entries, so a scheduled
  // target replaced by a voluntary one (or one card by another) must not inherit
  // the previous session's step, rating or recorded-visit id.
  useEffect(() => {
    if (visible) {
      setStep(initialStep);
      setRating(0);
      setIsSubmitting(false);
      setSubmitError(null);
      setRescheduleDate(null);
      setRescheduleTime(null);
      setShowDatePicker(false);
      setShowTimePicker(false);
      setSelectedDateOption(null);
      setIsRescheduling(false);
      recordedVisitIdRef.current = null;
    }
  }, [visible, initialStep, review.cardId]);

  // ── Submit handler ─────────────────────────────────────────────────────

  // Resolve the calendar entry ID: prop override takes precedence. The voluntary
  // entry has no calendar entry at all and must never stamp one.
  const resolvedCalendarEntryId = isVoluntary
    ? null
    : calendarEntryId !== undefined
      ? calendarEntryId
      : review.calendarEntryId ?? null;

  const handleSubmitScheduled = useCallback(async () => {
    if (!user?.id || rating === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const { data: reviewData, error: insertError } = await supabase
        .from("place_reviews")
        .insert({
          user_id: user.id,
          calendar_entry_id: resolvedCalendarEntryId,
          place_pool_id: review.placePoolId || null,
          google_place_id: review.googlePlaceId || null,
          card_id: review.cardId,
          place_name: review.placeName,
          place_address: review.placeAddress || null,
          place_category: review.placeCategory || null,
          rating,
          did_attend: true,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // Mark calendar entry as reviewed
      if (resolvedCalendarEntryId) {
        await supabase
          .from("calendar_entries")
          .update({
            feedback_status: "completed",
            review_id: reviewData.id,
            status: "completed",
          })
          .eq("id", resolvedCalendarEntryId)
          .eq("user_id", user.id);
      }

      mixpanelService.trackPlaceReviewed({
        card_id: review.cardId,
        place_name: review.placeName,
        category: review.placeCategory || undefined,
        rating,
      });

      setStep("thank-you");
    } catch (error) {
      console.error("[PostExperienceModal] Submit failed:", error);
      setSubmitError(t('modals:post_experience.error_generic'));
      setIsSubmitting(false);
    }
  }, [user, review, rating, resolvedCalendarEntryId]);

  /**
   * #1687 — the voluntary submit. ONE mutation records the visit AND writes the
   * review; nothing was written when the modal opened, so a close icon leaves the
   * database exactly as it found it.
   */
  const handleSubmitVoluntary = useCallback(async () => {
    if (!user?.id || rating === 0 || !voluntaryVisit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submitVoluntary.mutateAsync({
        input: {
          userId: user.id,
          cardId: voluntaryVisit.cardId,
          placeName: voluntaryVisit.placeName,
          placeCategory: voluntaryVisit.placeCategory,
          placeAddress: voluntaryVisit.placeAddress,
          placePoolId: voluntaryVisit.placePoolId,
          googlePlaceId: voluntaryVisit.googlePlaceId,
          placeImage: voluntaryVisit.placeImage,
          priceTier: voluntaryVisit.priceTier,
          rating,
        },
        recordedVisitId: recordedVisitIdRef.current,
      });

      mixpanelService.trackPlaceReviewed({
        card_id: voluntaryVisit.cardId,
        place_name: voluntaryVisit.placeName,
        category: voluntaryVisit.placeCategory || undefined,
        rating,
      });

      setStep("thank-you");
    } catch (error) {
      console.error("[PostExperienceModal] Voluntary submit failed:", error);
      // #1687 rework 3 — the visit is never rolled back, so `visitId` names a row
      // that is really there whenever it is set. Reuse it: `record-visit` upserts
      // `visited_at` at execution time, so a retry that re-recorded would rewrite
      // the recorded time of the user's own visit (#1661 X-3). It is null only
      // when the record itself failed and there is nothing to reuse.
      if (error instanceof PlaceReviewWriteError) {
        recordedVisitIdRef.current = error.visitId;
      }
      setSubmitError(t('modals:post_experience.error_generic'));
      setIsSubmitting(false);
    }
  }, [user, voluntaryVisit, rating, submitVoluntary, t]);

  const handleSubmit = isVoluntary ? handleSubmitVoluntary : handleSubmitScheduled;

  /**
   * #1687 — the close icon. It exists ONLY on the voluntary entry, because that
   * tap is the one that may be a mistake; the scheduled prompt stays locked.
   */
  const handleDismiss = useCallback(() => {
    if (onCancel) {
      onCancel();
      return;
    }
    onComplete();
  }, [onCancel, onComplete]);

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
    // #1687 — reschedule is the ONE genuinely calendar-dependent path. It is
    // unreachable from the voluntary entry (which opens on "rate" and offers no
    // route to this step), and moving a date that does not exist is meaningless,
    // so the absence of an entry is a guard rather than a fallback.
    if (!computedRescheduleDateTime || !user?.id || !review.calendarEntryId) return;

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
      toastManager.success(t('modals:post_experience.rescheduled_toast'));
      onComplete();
    } catch (error) {
      console.error("[PostExperienceModal] Reschedule failed:", error);
      toastManager.error(t('modals:post_experience.reschedule_failed_toast'));
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
          {t('modals:post_experience.did_you_go', { placeName: review.placeName })}
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => setStep("rate")}
        >
          <Icon name="checkmark-circle-outline" size={24} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>{t('modals:post_experience.yes_i_went')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setStep("reschedule")}
        >
          <Icon name="calendar-outline" size={24} color={colors.primary} />
          <Text style={styles.secondaryButtonText}>{t('modals:post_experience.no_go_later')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Render: rate step ──────────────────────────────────────────────────

  const renderRateStep = () => (
    <View
      style={[
        styles.rateContainer,
        // The voluntary entry has no step above this one, so its title would sit
        // level with the close icon. Scoped to this path: the scheduled prompt's
        // rate step arrives from "did you go?" and is unchanged.
        isVoluntary && { paddingTop: insets.top + 64 },
      ]}
    >
      {/* #1687 — no back arrow on the voluntary entry: there is no "did you go?"
          step behind it to go back to. The close icon is the way out. */}
      {!isVoluntary && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setStep("prompt")}
        >
          <Icon name="arrow-back" size={24} color={colors.gray800} />
        </TouchableOpacity>
      )}

      <Text style={styles.rateTitle}>{t('modals:post_experience.how_was', { placeName: review.placeName })}</Text>

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
          <Text style={styles.primaryButtonText}>{t('modals:post_experience.submit')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  // ── Render: thank-you step ─────────────────────────────────────────────

  const renderThankYouStep = () => (
    <View style={styles.centerContainer}>
      <Icon name="checkmark-circle" size={80} color="#10B981" />
      <Text style={styles.thankYouTitle}>{t('modals:post_experience.thank_you_title')}</Text>
      <Text style={styles.thankYouSubtitle}>
        {t('modals:post_experience.thank_you_subtitle')}
      </Text>
      <TouchableOpacity
        style={[styles.primaryButton, styles.thankYouButton]}
        onPress={onComplete}
      >
        <Text style={styles.primaryButtonText}>{t('modals:post_experience.done')}</Text>
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
        {t('modals:post_experience.pick_new_date', { placeName: review.placeName })}
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
            {t('modals:post_experience.today')}
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
            {t('modals:post_experience.this_weekend')}
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
            {t('modals:post_experience.custom_date')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* [#2322] themeVariant/textColor are LOAD-BEARING on BOTH wheels below — do not
          delete them as "redundant on a light-only app". app.json declares
          `userInterfaceStyle: "light"`, but the expo-splash-screen config plugin overwrites
          the built Info.plist `UIUserInterfaceStyle` to `Automatic`, so every NATIVE view
          inherits the DEVICE appearance. Unthemed, these wheels draw UIColor.label —
          near-white in Dark Mode — onto `styles.container.backgroundColor: "#FFFFFF"`, which
          makes them COMPLETELY invisible inside a modal that is deliberately not dismissible
          (COMMS-0140). Pinning the trait keeps them legible whatever the build resolves the
          app-wide style to. */}
      {showDatePicker && (
        <DateTimePicker
          value={rescheduleDate || new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          minimumDate={new Date()}
          themeVariant="light"
          textColor={colors.gray900}
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
          themeVariant="light"
          textColor={colors.gray900}
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
          <Text style={styles.primaryButtonText}>{t('modals:post_experience.confirm')}</Text>
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
      // #1687 — Android hardware back closes the voluntary review (same contract
      // as the close icon: nothing written). The scheduled prompt stays locked.
      onRequestClose={dismissible ? handleDismiss : () => {}}
    >
      <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]} edges={['top', 'left', 'right']}>
        {/* #1687 — hidden on "thank-you": by then the write has landed, so there is
            nothing left to cancel and the step carries its own Done button. */}
        {dismissible && step !== "thank-you" && (
          <TouchableOpacity
            // The absolute inset is measured from the SCREEN, not from the
            // SafeAreaView's padded box — verified on an iPhone 17 Pro Max, where
            // a bare `top: 16` put this icon on top of the battery indicator. The
            // inset is added here rather than left to `edges` because the button
            // does not participate in that layout.
            style={[styles.dismissButton, { top: insets.top + 8 }]}
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('modals:post_experience.close_label')}
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
    alignSelf: "stretch",
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
