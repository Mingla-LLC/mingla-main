import React, { useState, useMemo, useRef } from "react";
import { mixpanelService } from "../../services/mixpanelService";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Modal,
  Platform,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Icon } from "../ui/Icon";
import { TrackedTouchableOpacity } from "../TrackedTouchableOpacity";
import { useQueryClient } from "@tanstack/react-query";
import { savedCardKeys } from "../../hooks/queryKeys";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ExpandedCardData, BookingOption } from "../../types/expandedCardTypes";
import { savedCardsService } from "../../services/savedCardsService";
import { CalendarService } from "../../services/calendarService";
import { useAppStore } from "../../store/appStore";
import { useCalendarEntries } from "../../hooks/useCalendarEntries";
import { toastManager } from "../ui/Toast";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import { useIsPlaceOpen } from "../../hooks/useIsPlaceOpen";
import { extractWeekdayText, isPlaceOpenAt } from "../../utils/openingHoursUtils";
import { normalizeWebsiteUrl } from "../../utils/normalizeWebsiteUrl";
import { useTranslation } from "react-i18next";


interface ActionButtonsProps {
  card: ExpandedCardData;
  bookingOptions: BookingOption[];
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onPurchase?: (card: ExpandedCardData, bookingOption: BookingOption) => void;
  onShare?: (card: ExpandedCardData) => void;
  onClose?: () => void;
  isSaved?: boolean;
  userPreferences?: any;
  currentMode?: string;
  onCardRemoved?: (cardId: string) => void; // Callback to remove card from deck
  onScheduleSuccess?: (card: ExpandedCardData) => void; // Callback after successful scheduling
  onOpenBrowser?: (url: string, title: string) => void; // Opens in-app browser (for Policies & Reservations)
  isVisited?: boolean;
  isVisitLoading?: boolean;
  onVisitPress?: () => void;
  onRemoveVisitPress?: () => void;
  hasCalendarEntry?: boolean;
  /** Called when a gated action is attempted on a curated card by a free user */
  onPaywallRequired?: () => void;
  /** Whether the current user can access curated card actions (save/schedule) */
  canAccessCurated?: boolean;
}

export default function ActionButtons({
  card,
  bookingOptions,
  onSave,
  onPurchase,
  onShare,
  onClose,
  isSaved = false,
  userPreferences,
  currentMode = "solo",
  onCardRemoved,
  onScheduleSuccess,
  onOpenBrowser,
  isVisited = false,
  isVisitLoading = false,
  onVisitPress,
  onRemoveVisitPress,
  hasCalendarEntry = false,
  onPaywallRequired,
  canAccessCurated = true,
}: ActionButtonsProps) {
  const insets = useSafeAreaInsets();
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
  const [showAllHours, setShowAllHours] = useState(false);
  const visitScaleAnim = useRef(new Animated.Value(1)).current;

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

  // Normalize opening hours for display — uses the same canonical parser
  // as useIsPlaceOpen so both hours list and Open/Closed badge always agree.
  const parsedOpeningHours = useMemo(() => {
    const lines = extractWeekdayText(card.openingHours);
    return lines ? { lines } : null;
  }, [card.openingHours]);

  // Live open/closed status computed from weekday_text against local clock
  const liveOpenStatus = useIsPlaceOpen(card.openingHours);

  // Get today's day name for highlighting
  const todayDayName = useMemo(() => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[new Date().getDay()];
  }, []);

  // [ORCH-0649 — CONSTITUTION #2] Local parseTimeString + checkPlaceAvailability
  // DELETED. All availability checks now inline the canonical isPlaceOpenAt
  // (openingHoursUtils.ts) at the call site. Mapping isPlaceOpenAt's
  // true | false | null result to the legacy {isOpen, isAssumption, reason}
  // shape is done per call site.

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

  const handleVisitPress = () => {
    if (isVisitLoading) return;
    if (isVisited) {
      onRemoveVisitPress?.();
    } else {
      // Scale down → color transition → scale back + haptic
      Animated.sequence([
        Animated.timing(visitScaleAnim, {
          toValue: 0.95,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(visitScaleAnim, {
          toValue: 1.0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      });
      onVisitPress?.();
      mixpanelService.trackExperienceVisited({
        card_id: card.id,
        card_title: card.title,
        category: card.category,
      });
    }
  };

  // Show visit button when card is saved and has no calendar entry
  const showVisitButton = isSaved && !hasCalendarEntry && (onVisitPress || onRemoveVisitPress);

  const handleSave = async () => {
    if (isSaving) return; // Prevent multiple saves

    // Gate: curated card save requires Mingla+
    const isCurated = (card as any).cardType === 'curated' || (card as any).is_curated;
    if (isCurated && !canAccessCurated) {
      onPaywallRequired?.();
      return;
    }

    setIsSaving(true);
    try {
      await onSave(card);
    } catch (error: any) {
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
    setShowDateTimePicker(true);
  };

  const handleDateTimePickerChange = (event: any, date?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "dismissed") {
        setShowDateTimePicker(false);
        return;
      }

      if (date) {
        if (pickerMode === "date") {
          // Date selected on Android - show time picker next
          setSelectedDate(date);
          setSelectedTime(date);
          setPickerMode("time");
          // Keep picker visible for time selection
        } else {
          // Time selected on Android - check availability
          const combinedDateTime = new Date(selectedDate);
          combinedDateTime.setHours(date.getHours());
          combinedDateTime.setMinutes(date.getMinutes());
          setSelectedTime(combinedDateTime);
          setSelectedDateTime(combinedDateTime);
          setShowDateTimePicker(false);

          // Check availability and auto-schedule if open.
          // [ORCH-0649] Canonical isPlaceOpenAt → legacy {isOpen,isAssumption,reason}.
          const weekdayText = extractWeekdayText(card?.openingHours ?? null);
          const openAt = isPlaceOpenAt(weekdayText, combinedDateTime);
          const availability =
            openAt === null
              ? {
                  isOpen: true,
                  isAssumption: true,
                  reason: "Opening hours data not available",
                }
              : { isOpen: openAt, isAssumption: false };
          setAvailabilityCheck(availability);
          setHasCheckedAvailability(true);

          if (availability.isOpen) {
            proceedWithScheduling(combinedDateTime);
          } else {
            Alert.alert(
              "Place Closed",
              "This place is closed at the selected date and time. Please choose a different time.",
              [
                {
                  text: "Choose Another Time",
                  onPress: () => {
                    setAvailabilityCheck(null);
                    setHasCheckedAvailability(false);
                    setSelectedDateTime(null);
                    const now = new Date();
                    setSelectedDate(now);
                    setSelectedTime(now);
                    setPickerMode("date");
                    setShowDateTimePicker(true);
                  },
                },
                { text: "Cancel", style: "cancel" },
              ],
            );
          }
        }
      }
    } else {
      // iOS flow
      if (date) {
        if (pickerMode === "date") {
          setSelectedDate(date);
          setSelectedTime(date);
          setPickerMode("time");
        } else {
          // Time selected - wait for Done button
          const combinedDateTime = new Date(selectedDate);
          combinedDateTime.setHours(date.getHours());
          combinedDateTime.setMinutes(date.getMinutes());
          setSelectedTime(combinedDateTime);
        }
      }
    }
  };

  const handleTimePickerConfirm = () => {
    const combinedDateTime = new Date(selectedDate);
    combinedDateTime.setHours(selectedTime.getHours());
    combinedDateTime.setMinutes(selectedTime.getMinutes());
    setSelectedDateTime(combinedDateTime);
    setShowDateTimePicker(false);

    // Check availability and auto-schedule if open.
    // [ORCH-0649] Canonical isPlaceOpenAt → legacy {isOpen,isAssumption,reason}.
    const weekdayText = extractWeekdayText(card?.openingHours ?? null);
    const openAt = isPlaceOpenAt(weekdayText, combinedDateTime);
    const availability =
      openAt === null
        ? {
            isOpen: true,
            isAssumption: true,
            reason: "Opening hours data not available",
          }
        : { isOpen: openAt, isAssumption: false };
    setAvailabilityCheck(availability);
    setHasCheckedAvailability(true);

    if (availability.isOpen) {
      proceedWithScheduling(combinedDateTime);
    } else {
      Alert.alert(
        "Place Closed",
        "This place is closed at the selected date and time. Please choose a different time.",
        [
          {
            text: "Choose Another Time",
            onPress: () => {
              setAvailabilityCheck(null);
              setHasCheckedAvailability(false);
              setSelectedDateTime(null);
              const now = new Date();
              setSelectedDate(now);
              setSelectedTime(now);
              setPickerMode("date");
              setShowDateTimePicker(true);
            },
          },
          { text: "Cancel", style: "cancel" },
        ],
      );
    }
  };

  const handleDatePickerConfirm = () => {
    // Accept the currently displayed date and advance to time picker
    setPickerMode("time");
  };

  const proceedWithScheduling = async (scheduledDateTime: Date, skipStopCheck = false) => {
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

      // For curated cards: validate each stop's hours at estimated arrival time
      if (!skipStopCheck && card.stops && card.stops.length > 0) {
        const stopIssues: string[] = [];
        let cumulativeMinutes = 0;

        for (const stop of card.stops) {
          const estimatedArrival = new Date(scheduledDateTime.getTime() + cumulativeMinutes * 60000);
          const weekdayText = extractWeekdayText((stop as any).openingHours || (stop as any).opening_hours);
          const openAtArrival = isPlaceOpenAt(weekdayText, estimatedArrival);

          if (openAtArrival === false) {
            stopIssues.push(`${(stop as any).placeName || (stop as any).title} may be closed at ${estimatedArrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
          }

          cumulativeMinutes += ((stop as any).durationMinutes || (stop as any).duration || 60);
          cumulativeMinutes += ((stop as any).travelTimeToNext || 15);
        }

        if (stopIssues.length > 0) {
          setIsScheduling(false);
          Alert.alert(
            "Some Stops May Be Closed",
            stopIssues.join('\n'),
            [
              { text: "Change Time", style: "cancel" },
              { text: "Schedule Anyway", onPress: () => {
                setIsScheduling(true);
                proceedWithScheduling(scheduledDateTime, true);
              }},
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
        distance: card.distance || '',
        travelTime: card.travelTime || '',
        address: card.address || '',
        openingHours: card.openingHours,
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

  const handleShare = () => {
    if (onShare) {
      onShare(card);
    } else {
      Alert.alert(t('expanded_details:action_buttons.share_prompt', { title: card.title }));
    }
  };

  const handlePoliciesAndReservations = () => {
    if (!onOpenBrowser) return;
    // [ORCH-0649] Normalize via shared helper — http→https, whitespace trim,
    // case-insensitive scheme check. iOS ATS blocks plain http:// in WebView.
    const url = normalizeWebsiteUrl(card.website);
    if (!url) return;
    onOpenBrowser(url, card.title);
  };

  const showPoliciesButton = !!card.website;

  return (
    <View style={styles.container}>
      {/* Date/Time Picker Modal */}
      {showDateTimePicker && (
        <>
          {Platform.OS === "ios" ? (
            <Modal
              visible={showDateTimePicker}
              transparent={true}
              animationType="slide"
              onRequestClose={() => setShowDateTimePicker(false)}
            >
              <View style={styles.modalOverlay}>
                <TrackedTouchableOpacity
                  logComponent="ActionButtons"
                  logId="picker_dismiss"
                  style={styles.backdropTouch}
                  activeOpacity={1}
                  onPress={() => setShowDateTimePicker(false)}
                />
                <SafeAreaView style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]} edges={['bottom', 'left', 'right']}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {pickerMode === "date" ? t('expanded_details:action_buttons.select_date') : t('expanded_details:action_buttons.select_time')}
                    </Text>
                    <View style={styles.modalHeaderButtons}>
                      <TrackedTouchableOpacity
                        logComponent="ActionButtons"
                        logId="picker_cancel"
                        style={styles.modalCancelButton}
                        onPress={() => setShowDateTimePicker(false)}
                      >
                        <Text style={styles.modalCancelText}>{t('expanded_details:action_buttons.cancel')}</Text>
                      </TrackedTouchableOpacity>
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
                </SafeAreaView>
              </View>
            </Modal>
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

      {/* Top Row: Schedule Button + Share/Bookmark Button */}

      {/* Opening Hours Section */}
      {parsedOpeningHours && (
        <View style={styles.openingHoursSection}>
          <View style={styles.openingHoursHeader}>
            <Icon name="time" size={18} color="#ea580c" />
            <Text style={styles.openingHoursTitle}>{t('expanded_details:action_buttons.opening_hours')}</Text>
            {liveOpenStatus !== null && (
              <View style={[
                styles.openNowBadge,
                liveOpenStatus ? styles.openNowBadgeOpen : styles.openNowBadgeClosed,
              ]}>
                <View style={[
                  styles.openNowDot,
                  liveOpenStatus ? styles.openNowDotOpen : styles.openNowDotClosed,
                ]} />
                <Text style={[
                  styles.openNowText,
                  liveOpenStatus ? styles.openNowTextOpen : styles.openNowTextClosed,
                ]}>
                  {liveOpenStatus ? t('expanded_details:action_buttons.open_now') : t('expanded_details:action_buttons.closed')}
                </Text>
              </View>
            )}
          </View>
          {parsedOpeningHours.lines.map((line: string, index: number) => {
            const isToday = line.startsWith(todayDayName);
            // Show today always, show others only when expanded
            if (!showAllHours && !isToday) return null;
            return (
              <View key={index} style={[
                styles.openingHoursRow,
                isToday && styles.openingHoursRowToday,
              ]}>
                {isToday && <View style={styles.todayIndicator} />}
                <Text style={[
                  styles.openingHoursText,
                  isToday && styles.openingHoursTextToday,
                ]}>{line}</Text>
              </View>
            );
          })}
          {parsedOpeningHours.lines.length > 1 && (
            <TrackedTouchableOpacity logComponent="ActionButtons" logId="toggle_hours" onPress={() => setShowAllHours(!showAllHours)} style={styles.showAllHoursButton}>
              <Text style={styles.showAllHoursText}>
                {showAllHours ? t('expanded_details:action_buttons.show_less') : t('expanded_details:action_buttons.show_all_hours')}
              </Text>
              <Icon name={showAllHours ? "chevron-up" : "chevron-down"} size={14} color="#ea580c" />
            </TrackedTouchableOpacity>
          )}
        </View>
      )}

      {/* Action Buttons Row: Save + Schedule + Share */}
      <View style={styles.topRow}>
        {/* Save Button */}
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="save"
          style={[
            styles.saveButton,
            (isSaving || isSaved) && styles.actionButtonDisabled,
          ]}
          onPress={handleSave}
          activeOpacity={0.7}
          disabled={isSaving || isSaved}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Icon
                name={isSaved ? "bookmark" : "bookmark-outline"}
                size={20}
                color="#ffffff"
              />
              <Text style={styles.saveButtonText}>
                {isSaved ? t('expanded_details:action_buttons.saved') : t('expanded_details:action_buttons.save')}
              </Text>
            </>
          )}
        </TrackedTouchableOpacity>

        {/* Schedule Button */}
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="schedule"
          style={[
            styles.scheduleButton,
            (isScheduling || isScheduled) && styles.scheduleButtonDisabled,
          ]}
          onPress={handleSchedule}
          activeOpacity={0.7}
          disabled={isScheduling || isScheduled}
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Icon
                name={isScheduled ? "checkmark-circle" : "calendar-outline"}
                size={20}
                color="#ffffff"
              />
              <Text style={styles.scheduleButtonText}>
                {isScheduled ? t('expanded_details:action_buttons.scheduled') : t('expanded_details:action_buttons.schedule')}
              </Text>
            </>
          )}
        </TrackedTouchableOpacity>

        {/* Share Button */}
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="share"
          style={styles.shareIconButton}
          onPress={handleShare}
          activeOpacity={0.7}
        >
          <Icon name="share-outline" size={20} color="#6b7280" />
        </TrackedTouchableOpacity>
      </View>

      {/* Policies & Reservations — all categories with website or placeId */}
      {showPoliciesButton && (
        <TrackedTouchableOpacity
          logComponent="ActionButtons"
          logId="policies"
          style={styles.policiesButton}
          onPress={handlePoliciesAndReservations}
          activeOpacity={0.8}
        >
          <Icon name="globe-outline" size={18} color="#ffffff" />
          <Text style={styles.policiesButtonText}>
            {t('expanded_details:action_buttons.policies_reservations')}
          </Text>
        </TrackedTouchableOpacity>
      )}

      {/* Visit Button */}
      {showVisitButton && (
        <Animated.View style={{ transform: [{ scale: visitScaleAnim }] }}>
          <TrackedTouchableOpacity
            logComponent="ActionButtons"
            logId="visit"
            style={[
              styles.visitButton,
              isVisited && styles.visitButtonVisited,
              isVisitLoading && styles.visitButtonLoading,
            ]}
            onPress={handleVisitPress}
            activeOpacity={0.7}
            disabled={isVisitLoading}
            accessibilityLabel={
              isVisited
                ? t('expanded_details:action_buttons.visited_label')
                : t('expanded_details:action_buttons.mark_visited_label')
            }
            accessibilityHint={
              isVisited
                ? t('expanded_details:action_buttons.visited_hint')
                : t('expanded_details:action_buttons.mark_visited_hint')
            }
          >
            {isVisitLoading ? (
              <>
                <ActivityIndicator size="small" color="#9ca3af" />
                <Text style={styles.visitButtonTextLoading}>{t('expanded_details:action_buttons.on_it')}</Text>
              </>
            ) : isVisited ? (
              <>
                <Icon
                  name="checkmark-circle"
                  size={20}
                  color="#16a34a"
                />
                <Text style={styles.visitButtonTextVisited}>
                  {t('expanded_details:action_buttons.been_there')} ✓
                </Text>
              </>
            ) : (
              <>
                <Icon
                  name="checkmark-circle-outline"
                  size={20}
                  color="#9ca3af"
                />
                <Text style={styles.visitButtonTextDefault}>{t('expanded_details:action_buttons.i_went_here')}</Text>
              </>
            )}
          </TrackedTouchableOpacity>
        </Animated.View>
      )}

      {/* Availability Messages */}
      {hasCheckedAvailability &&
        availabilityCheck &&
        !availabilityCheck.isOpen &&
        !availabilityCheck.isAssumption && (
          <View style={styles.closedMessageContainer}>
            <Icon name="alert-circle" size={16} color="#9a3412" />
            <Text style={styles.closedMessage}>
              {t('expanded_details:action_buttons.closed_message')}
            </Text>
          </View>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  saveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366F1",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  scheduleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  scheduleButtonDisabled: {
    opacity: 0.6,
    backgroundColor: "#eb7825",
  },
  scheduleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  shareIconButton: {
    width: 48,
    height: 48,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  policiesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f2937",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  policiesButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 15,
    color: "#6b7280",
    fontWeight: "500",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
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
  },
  modalHeaderButtons: {
    flexDirection: "row",
    gap: 16,
  },
  modalCancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    fontSize: 16,
    color: "#6b7280",
  },
  modalConfirmButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  modalConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#eb7825",
  },
  dateTimePicker: {
    height: 200,
  },
  closedMessageContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  closedMessage: {
    flex: 1,
    fontSize: 13,
    color: "#9a3412",
    fontWeight: "500",
    lineHeight: 18,
  },
  warningMessageContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  warningMessage: {
    flex: 1,
    fontSize: 13,
    color: "#9a3412",
    fontWeight: "500",
    lineHeight: 18,
  },
  visitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  visitButtonVisited: {
    backgroundColor: "#f0fdf4",
    borderColor: "#22c55e",
  },
  visitButtonLoading: {
    borderColor: "#e5e7eb",
  },
  visitButtonTextDefault: {
    fontSize: 15,
    fontWeight: "600",
    color: "#4b5563",
  },
  visitButtonTextLoading: {
    fontSize: 15,
    fontWeight: "600",
    color: "#9ca3af",
  },
  visitButtonTextVisited: {
    fontSize: 15,
    fontWeight: "600",
    color: "#15803d",
  },
  openingHoursSection: {
    backgroundColor: "#eb78251a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eb782566",
    padding: 14,
    marginBottom: 16,
  },
  openingHoursHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  openingHoursTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333333",
    flex: 1,
  },
  openNowBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5,
  },
  openNowBadgeOpen: {
    backgroundColor: "#fff7ed",
  },
  openNowBadgeClosed: {
    backgroundColor: "#fef2f2",
  },
  openNowDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  openNowDotOpen: {
    backgroundColor: "#eb7825",
  },
  openNowDotClosed: {
    backgroundColor: "#ef4444",
  },
  openNowText: {
    fontSize: 12,
    fontWeight: "600",
  },
  openNowTextOpen: {
    color: "#9a3412",
  },
  openNowTextClosed: {
    color: "#991b1b",
  },
  openingHoursRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  openingHoursRowToday: {
    backgroundColor: "#fff7ed",
  },
  todayIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ea580c",
    marginRight: 8,
  },
  openingHoursText: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 20,
  },
  openingHoursTextToday: {
    fontWeight: "700",
    color: "#9a3412",
  },
  showAllHoursButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    gap: 4,
  },
  showAllHoursText: {
    fontSize: 13,
    color: "#ea580c",
    fontWeight: "600",
  },
});
