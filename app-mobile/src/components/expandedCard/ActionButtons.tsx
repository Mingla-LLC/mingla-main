import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { mixpanelService } from "../../services/mixpanelService";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { TrackedTouchableOpacity } from "../TrackedTouchableOpacity";
import { useQueryClient } from "@tanstack/react-query";
import { savedCardKeys } from "../../hooks/queryKeys";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ExpandedCardData } from "../../types/expandedCardTypes";
// #1703 — relative, like the other card-identity imports in this tree: the CI
// guards import it under plain `node --test` with no `npm install`.
import { dialablePhone } from "../../../../packages/card-identity/phone.mjs";
import { savedCardsService } from "../../services/savedCardsService";
import { CalendarService } from "../../services/calendarService";
import { useAppStore } from "../../store/appStore";
import { useCalendarEntries } from "../../hooks/useCalendarEntries";
import { toastManager } from "../ui/Toast";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import { checkAllCuratedStopsOpen } from "../../utils/curatedStopsAvailability";
import {
  buildSingleCardNotSafeMessage,
  checkSingleCardSchedulingAvailability,
} from "../../utils/singleCardAvailability";
import { canonicalDiscoveryPriceFields } from "../../utils/priceTiers";
import { useTranslation } from "react-i18next";
import { ACTION_BAND, SPINE } from "./spineTokens";


// META-ORCH-0991 Wave B Batch 4: the iOS date/time picker <Modal> (a flex-end
// white sheet) → fixed ['45%'] BaseBottomSheet snap. Fits the picker spinner
// (height 200) + header; fixed snap (NOT enableDynamicSizing) per the Batch-3
// off-screen lesson. ONLY this modal is converted; the rest of ActionButtons is
// untouched, and the Android native DateTimePicker branch stays as-is.
const DATE_TIME_PICKER_SNAP_POINTS = ['45%'];

interface ActionButtonsProps {
  card: ExpandedCardData;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onClose?: () => void;
  isSaved?: boolean;
  userPreferences?: any;
  currentMode?: string;
  onCardRemoved?: (cardId: string) => void; // Callback to remove card from deck
  onScheduleSuccess?: (card: ExpandedCardData) => void; // Callback after successful scheduling
  onSchedulePickerModalVisibilityChange?: (isOpen: boolean) => void;
  /**
   * #1605 wave 4 — the RESERVE slot.
   *
   * The band's third button is supplied by the caller, already gated, because
   * its gate (`venueReservable`) belongs to the modal and is asserted by
   * ORCH-1148's strict-grep guard against the SHEET's gate in the same file. A
   * `bookingOptions.length > 0` gate here would be a DEAD TAP: nothing in this
   * component has ever read `bookingOptions` or invoked `onPurchase`.
   *
   * The BAND'S HEIGHT DOES NOT CHANGE when it is absent — Save and Schedule
   * simply take 176pt each. Same silhouette discipline as the plate.
   */
  reserve?: React.ReactNode;
  /** Called when a gated action is attempted on a curated card by a free user */
  onPaywallRequired?: () => void;
  /** Whether the current user can access curated card actions (save/schedule) */
  canAccessCurated?: boolean;
}

export default function ActionButtons({
  card,
  onSave,
  onClose,
  isSaved = false,
  userPreferences,
  currentMode = "solo",
  onCardRemoved,
  onScheduleSuccess,
  onSchedulePickerModalVisibilityChange,
  reserve,
  onPaywallRequired,
  canAccessCurated = true,
}: ActionButtonsProps) {
  const { t } = useTranslation(['expanded_details', 'common']);
  const [isSaving, setIsSaving] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());
  const [pickerMode, setPickerMode] = useState<"date" | "time">("date");
  const [selectedDateTime, setSelectedDateTime] = useState<Date | null>(null);
  const [availabilityCheck, setAvailabilityCheck] = useState<{
    isOpen: boolean;
    isAssumption: boolean;
    reason?: string;
  } | null>(null);
  const [hasCheckedAvailability, setHasCheckedAvailability] = useState(false);
  // ORCH-0690 S-2: holds the Android-OK'd date while the preview/confirm Alert is open.
  const [pendingDateConfirmation, setPendingDateConfirmation] = useState<Date | null>(null);
  const setDateTimePickerVisible = useCallback(
    (isOpen: boolean) => {
      setShowDateTimePicker(isOpen);
      if (Platform.OS === "ios") {
        onSchedulePickerModalVisibilityChange?.(isOpen);
      }
    },
    [onSchedulePickerModalVisibilityChange],
  );

  useEffect(() => {
    return () => {
      if (Platform.OS === "ios") {
        onSchedulePickerModalVisibilityChange?.(false);
      }
    };
  }, [onSchedulePickerModalVisibilityChange]);

  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const { data: calendarEntries = [] } = useCalendarEntries(user?.id);
  // Check if card is already scheduled
  const isScheduled = useMemo(() => {
    return calendarEntries.some(
      (entry) =>
        (entry.card_id === card.id ||
          entry.card_data?.id === card.id ||
          entry.card_data?.experience_id === card.id) &&
        entry.status === "pending" &&
        !entry.archived_at,
    );
  }, [calendarEntries, card.id]);

  /**
   * #1605 wave 4 — THE HOURS BLOCK MOVED OUT, AND SO DID THE OPEN/CLOSED BADGE.
   *
   * `PracticalDetailsSection` has ALWAYS accepted an `openingHours` prop and has
   * never rendered it: the hours table actually rendered here, inside the action
   * component, under an orange-tinted "Opening Hours" card. That split is what
   * this wave ends — hours are a practical detail, so they render in Details, and
   * the badge renders next to them.
   */

  // [ORCH-0649 — CONSTITUTION #2] Local parseTimeString + checkPlaceAvailability
  // DELETED. Scheduling-time availability now routes through shared helpers so
  // open/closed/unknown semantics cannot drift between card surfaces.

  // Helper function to generate suggested dates
  const generateSuggestedDates = (dateTimePrefs: any) => {
    const suggestions = [];
    const today = new Date();

    for (let i = 0; i < 3; i++) {
      const futureDate = new Date(today);

      if (dateTimePrefs?.planningTimeframe === "This week") {
        futureDate.setDate(today.getDate() + (i + 1) * 2);
      } else if (dateTimePrefs?.planningTimeframe === "This month") {
        futureDate.setDate(today.getDate() + (i + 1) * 7);
      } else {
        futureDate.setDate(today.getDate() + (i + 1) * 14);
      }

      if (dateTimePrefs?.dayOfWeek === "Weekend") {
        const dayOfWeek = futureDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          futureDate.setDate(futureDate.getDate() + (6 - dayOfWeek));
        }
      }

      let hour = 14;
      if (dateTimePrefs?.timeOfDay === "Morning") hour = 10;
      else if (dateTimePrefs?.timeOfDay === "Evening") hour = 18;

      futureDate.setHours(hour, 0, 0, 0);
      suggestions.push(futureDate.toISOString());
    }

    return suggestions;
  };

  /**
   * #1605 wave 4 — THE BEEN-THERE IMPLEMENTATION THAT LIVED HERE IS DELETED.
   *
   * `handleVisitPress`, its `visitScaleAnim` wrapper, its `mixpanelService
   * .trackExperienceVisited` call, the `isVisited` / `isVisitLoading` /
   * `onVisitPress` / `onRemoveVisitPress` props and the button's three state
   * styles are gone. They were gated on
   *
   *     showVisitButton = isSaved && !hasCalendarEntry && (onVisitPress || onRemoveVisitPress)
   *
   * and `git grep` finds those two props ONLY inside this file. No caller has
   * ever passed either, so the button, its `been_there` / `i_went_here` copy and
   * its `visitService` wiring have never rendered on ANY screen.
   *
   * Deleting it is what makes the control reachable, not what removes it. There
   * is exactly ONE Been-here control in the system and it lives on the plate
   * (`BeenHereControl`), which the expanded hero now mounts — so the control
   * reaches the six entry points that have no collapsed card behind them: Likes,
   * Calendar, chat, both collab sheets and a friend's profile. Wiring this one up
   * instead would have given the sheet a SECOND Been-here, in a different shape,
   * at a different size, with a different state machine, three sections below the
   * first one.
   *
   * Constitution 8: subtract before adding.
   */

  /**
   * #1703 — resolved once, and the ONLY thing that decides whether a Call button
   * exists. A separate `present(card.phone)` test would let the button render
   * for a number the link could not be built from.
   */
  const dialable = React.useMemo(
    () => dialablePhone((card as { phone?: string | null }).phone ?? null,
      (card as { countryCode?: string | null }).countryCode ?? null),
    [card],
  );

  const handleSave = async () => {
    if (isSaving) {
      return; // Prevent multiple saves
    }

    // Gate: curated card save requires Mingla+
    const isCurated = (card as any).cardType === 'curated' || (card as any).is_curated;
    if (isCurated && !canAccessCurated) {
      onPaywallRequired?.();
      return;
    }

    setIsSaving(true);
    try {
      await onSave(card);
    } catch (error) {
      console.error('[ActionButtons.handleSave] save failed', error);
      Alert.alert(t('common:error'), t('expanded_details:action_buttons.error_save'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSchedule = () => {
    if (isScheduling || isScheduled || !user?.id) return;

    // Gate: curated card schedule requires Mingla+
    const isCurated = (card as any).cardType === 'curated' || (card as any).is_curated;
    if (isCurated && !canAccessCurated) {
      onPaywallRequired?.();
      return;
    }

    // Always reset and show date/time picker
    setAvailabilityCheck(null);
    setHasCheckedAvailability(false);
    setSelectedDateTime(null);

    const now = new Date();
    setSelectedDate(now);
    setSelectedTime(now);
    setPickerMode("date");
    setDateTimePickerVisible(true);
  };

  const handleDateTimePickerChange = (event: any, date?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "dismissed") {
        setDateTimePickerVisible(false);
        setPendingDateConfirmation(null);
        return;
      }

      if (date) {
        if (pickerMode === "date") {
          // ORCH-0690 S-2: Android calendar dialog OK'd. Stage the date and surface
          // a preview/confirm Alert before advancing to time-mode. User can review
          // the picked date and back out to pick a different day.
          setDateTimePickerVisible(false);
          setPendingDateConfirmation(date);
          showAndroidDateConfirmation(date);
        } else {
          // Time selected on Android — combine and run shared confirmAndSchedule.
          const combinedDateTime = new Date(selectedDate);
          combinedDateTime.setHours(date.getHours());
          combinedDateTime.setMinutes(date.getMinutes());
          setSelectedTime(combinedDateTime);
          setSelectedDateTime(combinedDateTime);
          setDateTimePickerVisible(false);
          confirmAndSchedule(combinedDateTime);
        }
      }
    } else {
      // [ORCH-0690 RC-1] Do NOT call setPickerMode("time") in this branch.
      // iOS uses display="spinner" which emits onChange per wheel tick. Auto-flipping
      // to time-mode here means one wheel notch commits the date and hijacks user
      // intent before they can reach the Next button. Mode advancement is owned
      // EXCLUSIVELY by handleDatePickerConfirm (the Next button).
      if (date) {
        if (pickerMode === "date") {
          // Spinner tick — update selectedDate ONLY.
          setSelectedDate(date);
          setSelectedTime(date);
        } else {
          // Time mode spinner tick — update selectedTime; final commit via Done button.
          const combinedDateTime = new Date(selectedDate);
          combinedDateTime.setHours(date.getHours());
          combinedDateTime.setMinutes(date.getMinutes());
          setSelectedTime(combinedDateTime);
        }
      }
    }
  };

  // ORCH-0690 S-7: shared availability + scheduling helper. Replaces duplicated
  // logic in iOS handleTimePickerConfirm and Android time-set branch.
  // - S-4: past-date check at function entry (Constitution #12).
  // - S-5: isAssumption surfacing (Constitution #9 — never silently auto-schedule
  //   on unknown hours; ask the user).
  // - HF-2 fix: closed-place re-prompt preserves selectedDate, only resets
  //   selectedTime, reopens in pickerMode="time".
  const confirmAndSchedule = (combinedDateTime: Date) => {
    // S-4: past-date check (Constitution #12).
    // OQ-2 resolution: keep picker open in time-mode so user can re-pick on same date.
    if (combinedDateTime.getTime() < Date.now()) {
      Alert.alert(
        t('expanded_details:action_buttons.error_past_date_title'),
        t('expanded_details:action_buttons.error_past_date_message'),
        [
          {
            text: t('expanded_details:action_buttons.cancel'),
            style: 'cancel',
          },
          {
            text: t('expanded_details:action_buttons.choose_another_time'),
            onPress: () => {
              setSelectedDateTime(null);
              setSelectedTime(new Date());
              setPickerMode('time');
              setDateTimePickerVisible(true);
            },
          },
        ],
      );
      return;
    }

    if (Array.isArray(card.stops) && card.stops.length > 0) {
      setAvailabilityCheck(null);
      setHasCheckedAvailability(false);
      proceedWithScheduling(combinedDateTime);
      return;
    }

    const availability = checkSingleCardSchedulingAvailability(card, combinedDateTime);
    setAvailabilityCheck({
      isOpen: availability.isSafeToSchedule,
      isAssumption: false,
      reason: availability.reason,
    });
    setHasCheckedAvailability(true);

    if (availability.isSafeToSchedule) {
      proceedWithScheduling(combinedDateTime);
    } else {
      // HF-2 fix: preserve selectedDate, only reset selectedTime, reopen in time-mode.
      Alert.alert(
        "Not Safe to Schedule",
        buildSingleCardNotSafeMessage(availability),
        [
          {
            text: t('expanded_details:action_buttons.choose_another_time'),
            onPress: () => {
              setAvailabilityCheck(null);
              setHasCheckedAvailability(false);
              setSelectedDateTime(null);
              // S-8: keep selectedDate; only reset selectedTime to now.
              setSelectedTime(new Date());
              setPickerMode('time');
              setDateTimePickerVisible(true);
            },
          },
          { text: t('expanded_details:action_buttons.cancel'), style: 'cancel' },
        ],
      );
    }
  };

  // ORCH-0690 S-2: Android post-OK preview/confirm prompt. Lets the user review
  // the picked date and either advance to time-mode or pick a different day.
  const showAndroidDateConfirmation = (date: Date) => {
    const formattedDate = date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    Alert.alert(
      t('expanded_details:action_buttons.confirm_date_title'),
      t('expanded_details:action_buttons.confirm_date_message', { date: formattedDate }),
      [
        {
          text: t('expanded_details:action_buttons.change_date'),
          onPress: () => {
            // Re-open calendar dialog. Keep pickerMode="date".
            setPendingDateConfirmation(null);
            setSelectedDate(date);
            setDateTimePickerVisible(true);
          },
        },
        {
          text: t('expanded_details:action_buttons.pick_time'),
          onPress: () => {
            // Commit the date and advance to time-mode.
            setSelectedDate(date);
            setSelectedTime(date);
            setPickerMode('time');
            setPendingDateConfirmation(null);
            setDateTimePickerVisible(true);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => setPendingDateConfirmation(null),
      },
    );
  };

  const handleTimePickerConfirm = () => {
    const combinedDateTime = new Date(selectedDate);
    combinedDateTime.setHours(selectedTime.getHours());
    combinedDateTime.setMinutes(selectedTime.getMinutes());
    setSelectedDateTime(combinedDateTime);
    setDateTimePickerVisible(false);
    confirmAndSchedule(combinedDateTime);
  };

  const handleDatePickerConfirm = () => {
    // Accept the currently displayed date and advance to time picker.
    // [ORCH-0690] This is now the SOLE iOS path that flips date → time.
    setPickerMode("time");
  };

  // ORCH-0690 S-3: iOS "← Back to date" handler. Lets user revert from time-mode
  // back to date-mode without losing selectedDate progress.
  const handleBackToDate = () => {
    setPickerMode("date");
    // selectedDate intentionally preserved.
  };

  const proceedWithScheduling = async (scheduledDateTime: Date) => {
    if (!user?.id) {
      Alert.alert(t('common:error'), t('expanded_details:action_buttons.error_login'));
      setIsScheduling(false);
      return;
    }

    setIsScheduling(true);
    try {
      if (isNaN(scheduledDateTime.getTime())) {
        Alert.alert(t('expanded_details:action_buttons.schedule_failed_title'), t('expanded_details:action_buttons.error_invalid_date'));
        setIsScheduling(false);
        return;
      }

      // For curated cards: use the same all-stops validator as SavedTab.
      if (card.stops && card.stops.length > 0) {
        const availability = checkAllCuratedStopsOpen(card.stops, scheduledDateTime);

        if (!availability.allOpen) {
          const unavailableList = availability.results
            .filter((result) => !result.isOpen)
            .map((result) => `  • ${result.stopName} — ${result.reason}`)
            .join('\n');

          setIsScheduling(false);
          Alert.alert(
            "Not Safe to Schedule",
            `Mingla could not confirm every stop is open at the time you selected:\n\n${unavailableList}\n\nPlease choose a different time when all stops are confirmed open.`,
            [
              { text: "Change Time", style: "cancel" },
            ]
          );
          return;
        }
      }

      const scheduledDateISO = scheduledDateTime.toISOString();

      // Determine source based on current mode
      const source: "solo" | "collaboration" =
        currentMode === "solo" ? "solo" : "collaboration";

      // If the card is saved, remove it from saved_cards table when scheduling
      if (isSaved) {
        try {
          // Use currentMode to determine source instead of card.source

          await savedCardsService.removeCard(user.id, card.id, source);
          // Invalidate savedCards query to refresh the list
          queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
        } catch (error) {
          // Log error but don't block scheduling
          console.error(
            "Error removing card from saved_cards when scheduling:",
            error,
          );
        }
      }

      // Explicitly construct a clean, JSON-serializable card object.
      const sanitizedCard = {
        id: card.id,
        placeId: card.placeId ?? card.id,
        title: card.title,
        category: card.category,
        categoryIcon: card.categoryIcon,
        description: card.description,
        fullDescription: card.fullDescription || card.description,
        image: card.image,
        images: card.images || (card.image ? [card.image] : []),
        rating: card.rating || 0,
        reviewCount: card.reviewCount || 0,
        priceRange: card.priceRange || '',
        ...canonicalDiscoveryPriceFields(card),
        distance: card.distance || '',
        travelTime: card.travelTime || '',
        address: card.address || '',
        openingHours: card.openingHours,
        utcOffsetMinutes: card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null,
        highlights: card.highlights || [],
        tags: card.tags || [],
        matchScore: card.matchScore || 0,
        matchFactors: card.matchFactors || {},
        location: card.location
          ? { lat: card.location.lat, lng: card.location.lng }
          : undefined,
        cardType: card.cardType,
        tagline: card.tagline,
        stops: card.stops,
        totalPriceMin: card.totalPriceMin,
        totalPriceMax: card.totalPriceMax,
        estimatedDurationMinutes: card.estimatedDurationMinutes,
        experienceType: card.experienceType,
        source,
      };

      const record = await CalendarService.addEntryFromSavedCard(
        user.id,
        sanitizedCard,
        scheduledDateISO,
      );

      // Invalidate calendar entries query to refresh after adding to lockedIn
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // Add to device calendar
      try {
        const deviceEvent = DeviceCalendarService.createEventFromCard(
          card,
          scheduledDateTime,
          record.duration_minutes || 120,
        );
        await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
      } catch (deviceCalendarError) {
        // Don't fail the whole operation if device calendar fails
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Track experience scheduled
      mixpanelService.trackExperienceScheduled({
        cardId: card.id,
        cardTitle: card.title,
        category: card.category,
        source,
        scheduledDate: scheduledDateISO,
      });

      // Show success toast + haptic
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toastManager.success(
        t('expanded_details:action_buttons.scheduled_toast', { title: card.title }),
        3000,
      );

      // Remove card from deck if callback is provided
      if (onCardRemoved) {
        onCardRemoved(card.id);
      }

      // Trigger feedback flow or close modal
      if (onScheduleSuccess) {
        onScheduleSuccess(card);
      } else if (onClose) {
        onClose();
      }
    } catch (error: any) {
      console.error("[ActionButtons] Scheduling error:", error);
      const detail = __DEV__ && error?.message ? `\n\nDEV: ${error.message}` : "";
      Alert.alert(
        t('expanded_details:action_buttons.schedule_failed_title'),
        `${t('expanded_details:action_buttons.schedule_failed_body')}${detail}`,
      );
    } finally {
      setIsScheduling(false);
      // Reset availability check state after scheduling completes
      setHasCheckedAvailability(false);
      setAvailabilityCheck(null);
      setSelectedDateTime(null);
    }
  };

  /**
   * #1605 wave 4 — SHARE AND "POLICIES & RESERVATIONS" LEFT THIS COMPONENT.
   *
   * Share is on the plate, next to Been-here, because both are IDENTITY actions
   * and the plate is where identity lives.
   *
   * "Policies & Reservations" was a full-width #1f2937 slab gated on
   * `!!card.website` whose handler bailed when `normalizeWebsiteUrl` returned
   * null — a VISIBLE DEAD BUTTON on any non-normalizable website (#1605 bug
   * ledger item 1, Constitution 1). It was a website link wearing a costume, so
   * it is now the Website row in Details, gated on the NORMALIZED url and
   * pre-flighted with `canOpenURL`.
   */

  return (
    <View>
      {/* Date/Time Picker Modal */}
      {showDateTimePicker && (
        <>
          {Platform.OS === "ios" ? (
            <BaseBottomSheet
              visible={showDateTimePicker}
              onClose={() => setDateTimePickerVisible(false)}
              snapPoints={DATE_TIME_PICKER_SNAP_POINTS}
              wrapInRNModal
              scrollMode="view"
              accessibilityLabel={pickerMode === "date" ? t('expanded_details:action_buttons.select_date') : t('expanded_details:action_buttons.select_time')}
              header={
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} numberOfLines={1} ellipsizeMode="tail">
                    {pickerMode === "date" ? t('expanded_details:action_buttons.select_date') : t('expanded_details:action_buttons.select_time')}
                  </Text>
                  <View style={styles.modalHeaderButtons}>
                    <TrackedTouchableOpacity
                      logComponent="ActionButtons"
                      logId="picker_cancel"
                      style={styles.modalCancelButton}
                      onPress={() => setDateTimePickerVisible(false)}
                    >
                      <Text style={styles.modalCancelText}>{t('expanded_details:action_buttons.cancel')}</Text>
                    </TrackedTouchableOpacity>
                    {/* ORCH-0690 S-3: Back-to-date button visible only in time-mode */}
                    {pickerMode === "time" && (
                      <TrackedTouchableOpacity
                        logComponent="ActionButtons"
                        logId="picker_back_to_date"
                        style={styles.modalCancelButton}
                        onPress={handleBackToDate}
                      >
                        <Text style={styles.modalCancelText}>
                          {t('expanded_details:action_buttons.back_to_date')}
                        </Text>
                      </TrackedTouchableOpacity>
                    )}
                    <TrackedTouchableOpacity
                      logComponent="ActionButtons"
                      logId="picker_done"
                      style={styles.modalConfirmButton}
                      onPress={pickerMode === "date" ? handleDatePickerConfirm : handleTimePickerConfirm}
                    >
                      <Text style={styles.modalConfirmText}>
                        {pickerMode === "date" ? t('expanded_details:action_buttons.next') : t('expanded_details:action_buttons.done')}
                      </Text>
                    </TrackedTouchableOpacity>
                  </View>
                </View>
              }
            >
              <DateTimePicker
                value={pickerMode === "date" ? selectedDate : selectedTime}
                mode={pickerMode}
                is24Hour={false}
                display="spinner"
                onChange={handleDateTimePickerChange}
                minimumDate={new Date()}
                style={styles.dateTimePicker}
                themeVariant="light"
                textColor="#111827"
              />
            </BaseBottomSheet>
          ) : (
            <DateTimePicker
              value={pickerMode === "date" ? selectedDate : selectedTime}
              mode={pickerMode}
              is24Hour={false}
              display="default"
              onChange={handleDateTimePickerChange}
              minimumDate={new Date()}
            />
          )}
        </>
      )}

      {/*
        THE ACTION BAND — slot 3, immediately below the hero, ON BOTH BRANCHES.

        Before this wave the action row was LAST on a single place and MID-SCROLL
        on a curated plan (inside MultiStopPlanView, with Weather, Busyness and
        Timeline rendered BELOW it). There is now one position for the commitment
        actions and it does not depend on what kind of card you opened.

        Height is 92pt and FIXED: 20 + 52 + 20. Whether Reserve renders changes
        the buttons' widths and never the band's height — the same silhouette
        discipline the plate obeys, and the reason the fold below it is a stable
        number the hero can be sized against.

        Save and Schedule carry NO FILL. The indigo #6366F1 Save with a white
        label measured 4.47:1 — below the 4.5 floor, and the only indigo in the
        app. Unfilled, they are identified by a #111827 label at 17.74:1 and a
        #374151 icon at 10.31:1, which is a stronger identification than the fill
        ever was.
      */}
      <View style={styles.band}>
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="save"
          style={[styles.bandButton, (isSaving || isSaved) && styles.bandButtonDisabled]}
          onPress={handleSave}
          activeOpacity={0.55}
          disabled={isSaving || isSaved}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaving || isSaved, selected: isSaved }}
          accessibilityLabel={
            isSaved
              ? t('expanded_details:action_buttons.saved')
              : t('expanded_details:action_buttons.save')
          }
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={SPINE.factValue} />
          ) : (
            <>
              <Icon
                name={isSaved ? 'bookmark' : 'bookmark-outline'}
                size={ACTION_BAND.iconSize}
                color={SPINE.prose}
              />
              <Text
                style={[styles.bandLabel, (isSaving || isSaved) && styles.bandLabelDisabled]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {isSaved
                  ? t('expanded_details:action_buttons.saved')
                  : t('expanded_details:action_buttons.save')}
              </Text>
            </>
          )}
        </TrackedTouchableOpacity>

        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="schedule"
          style={[styles.bandButton, (isScheduling || isScheduled) && styles.bandButtonDisabled]}
          onPress={handleSchedule}
          activeOpacity={0.55}
          disabled={isScheduling || isScheduled}
          accessibilityRole="button"
          accessibilityState={{ disabled: isScheduling || isScheduled, selected: isScheduled }}
          accessibilityLabel={
            isScheduled
              ? t('expanded_details:action_buttons.scheduled')
              : t('expanded_details:action_buttons.schedule')
          }
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color={SPINE.factValue} />
          ) : (
            <>
              <Icon
                name={isScheduled ? 'checkmark-circle' : 'calendar-outline'}
                size={ACTION_BAND.iconSize}
                color={SPINE.prose}
              />
              <Text
                style={[
                  styles.bandLabel,
                  (isScheduling || isScheduled) && styles.bandLabelDisabled,
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {isScheduled
                  ? t('expanded_details:action_buttons.scheduled')
                  : t('expanded_details:action_buttons.schedule')}
              </Text>
            </>
          )}
        </TrackedTouchableOpacity>

        {/*
          #1703 — CALL. Seth: "If there is number, show the button, if not dont
          show the button at all."

          ABSENT, NOT DISABLED. A greyed button is still a dead tap and still
          costs a slot in a band whose width is shared three or four ways. 63% of
          the pool has no number (32,332 of 88,367), so this is the common case,
          not the edge case — Yonder Coffee, the card Seth reviewed on, is one of
          them.

          `dialablePhone` composes the country code and refuses to guess one, so
          a number this button offers is a number that connects.
        */}
        {dialable !== null ? (
          <TrackedTouchableOpacity
            logComponent="ActionButtons"
            logId="call"
            style={styles.bandButton}
            onPress={() => {
              Linking.openURL(`tel:${dialable.tel}`).catch(() => {
                // A device with no dialler (a tablet, an emulator) rejects the
                // url. Say so rather than failing silently — Constitution rule 3.
                Alert.alert(
                  t('expanded_details:action_buttons.call', { defaultValue: 'Call' }),
                  dialable.display,
                );
              });
            }}
            activeOpacity={0.55}
            accessibilityRole="button"
            accessibilityLabel={t('expanded_details:action_buttons.call_place', {
              defaultValue: 'Call {{name}}',
              name: card.title,
            })}
          >
            <Icon name="call-outline" size={ACTION_BAND.iconSize} color={SPINE.prose} />
            <Text style={styles.bandLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {t('expanded_details:action_buttons.call', { defaultValue: 'Call' })}
            </Text>
          </TrackedTouchableOpacity>
        ) : null}

        {reserve}
      </View>

      {/* Availability Messages */}
      {hasCheckedAvailability &&
        availabilityCheck &&
        !availabilityCheck.isOpen &&
        !availabilityCheck.isAssumption && (
          <View style={styles.closedMessageContainer}>
            <Icon name="alert-circle" size={16} color="#9a3412" />
            <Text style={styles.closedMessage}>
              {availabilityCheck.reason ?? t('expanded_details:action_buttons.closed_message')}
            </Text>
          </View>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The band. NOTHING above it and nothing below it — no top border, no card, no
   * background of its own. It sits on the paper directly under the hero, so the
   * hero's bottom edge is the only boundary the eye needs.
   */
  band: {
    height: ACTION_BAND.height,
    paddingHorizontal: ACTION_BAND.padding,
    paddingVertical: ACTION_BAND.padding,
    flexDirection: "row",
    gap: ACTION_BAND.gap,
  },
  bandButton: {
    flex: 1,
    height: ACTION_BAND.buttonHeight,
    borderRadius: ACTION_BAND.buttonRadius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  bandButtonDisabled: { opacity: 0.4 },
  bandLabel: {
    fontSize: ACTION_BAND.labelSize,
    fontWeight: "600",
    color: SPINE.factValue,
  },
  bandLabelDisabled: { color: SPINE.disabledLabel },
  // META-ORCH-0991 Wave B Batch 4: removed the iOS date/time picker <Modal>'s
  // hand-rolled chrome (`modalOverlay` scrim, `backdropTouch`, `modalContent`
  // card). The picker is now a light BaseBottomSheet at ['45%'] with the real
  // gorhom handle + pan-down/backdrop close; only this modal changed.
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
    flexShrink: 1,
    marginRight: 8,
  },
  modalHeaderButtons: {
    flexDirection: "row",
    gap: 8,
  },
  modalCancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  modalCancelText: {
    fontSize: 16,
    color: "#6b7280",
  },
  modalConfirmButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  modalConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#eb7825",
  },
  dateTimePicker: {
    height: 200,
  },
  /**
   * The scheduling-availability messages keep a tinted panel, and that is the ONE
   * exception in the body. They are SYSTEM MESSAGES about the action the user
   * just attempted, not content sections — the reason the locked-in banner keeps
   * its fill too. Every content section lost its tint; these two did not, because
   * they are not content.
   */
  closedMessageContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 12,
    marginHorizontal: SPINE.gutter,
    marginBottom: 8,
    gap: 8,
  },
  closedMessage: {
    flex: 1,
    fontSize: 13,
    color: "#9a3412",
    fontWeight: "500",
    lineHeight: 18,
  },
});
