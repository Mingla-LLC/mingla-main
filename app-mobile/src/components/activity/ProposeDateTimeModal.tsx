import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
  ScrollView,
  Animated,
  Dimensions,
} from "react-native";
import { Icon } from "../ui/Icon";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareView } from "../ui/KeyboardAwareView";
import DateTimePicker from "@react-native-community/datetimepicker";
import DateOptionsGrid from "./DateOptionsGrid";
import WeekendDaySelection from "./WeekendDaySelection";
import ProposeDateTimeFooter from "./ProposeDateTimeFooter";
import { useIsPlaceOpen } from "../../hooks/useIsPlaceOpen";
import { extractWeekdayText, isPlaceOpenAt } from "../../utils/openingHoursUtils";
import { useTranslation } from 'react-i18next';

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface SavedCard {
  id: string;
  title: string;
  [key: string]: any;
}

interface ProposeDateTimeModalProps {
  visible: boolean;
  onClose: () => void;
  card: SavedCard | null;
  currentScheduledDate?: Date | string | null;
  onProposeDateTime: (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom",
  ) => void;
  isScheduling?: boolean;
  isCurated?: boolean;
}

export default function ProposeDateTimeModal({
  visible,
  onClose,
  card,
  currentScheduledDate,
  onProposeDateTime,
  isScheduling = false,
  isCurated = false,
}: ProposeDateTimeModalProps) {
  const { t } = useTranslation(['activity', 'common']);
  const [selectedDateOption, setSelectedDateOption] = useState<
    "now" | "today" | "weekend" | "custom" | null
  >(null);
  const [selectedWeekendDay, setSelectedWeekendDay] = useState<
    "saturday" | "sunday" | null
  >(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date>(new Date());
  const [customTime, setCustomTime] = useState<Date | null>(null);
  const [isAvailabilityChecked, setIsAvailabilityChecked] = useState(false);
  const [isPlaceOpen, setIsPlaceOpen] = useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [proposedDateTime, setProposedDateTime] = useState<Date | null>(null);
  const [availabilityAssumption, setAvailabilityAssumption] = useState<
    string | null
  >(null);

  const insets = useSafeAreaInsets();

  // Bottom sheet slide animation
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 25,
          stiffness: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
    }
  }, [visible]);

  const animateClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      handleClose();
    });
  };

  // [ORCH-0649 — CONSTITUTION #2] Local normalizeOpeningHours DELETED.
  // extractWeekdayText (openingHoursUtils.ts) is the canonical reader — it
  // handles Google v1 (weekdayDescriptions), Google legacy (weekday_text),
  // Record<string,string>, plain string arrays, and JSON-stringified input,
  // AND defensively rejects the pre-fix four-garbage-strings shape.
  const parsedOpeningHours = useMemo(() => {
    const lines = extractWeekdayText(card?.openingHours ?? null);
    return lines && lines.length > 0 ? { lines } : null;
  }, [card?.openingHours]);

  // Live open/closed status computed from weekday_text against local clock
  const liveOpenStatus = useIsPlaceOpen(card?.openingHours ?? null);

  const todayDayName = useMemo(() => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[new Date().getDay()];
  }, []);

  // Curated stop count for display
  const stopCount = useMemo(() => {
    if (!isCurated || !card) return 0;
    const stops = (card as any).stops;
    return Array.isArray(stops) ? stops.length : 0;
  }, [card, isCurated]);

  const handleDateOptionSelect = (
    option: "now" | "today" | "weekend" | "custom",
  ) => {
    setSelectedDateOption(option);
    setSelectedWeekendDay(null);
    setIsAvailabilityChecked(false);
    setIsPlaceOpen(false);
    setProposedDateTime(null);
    setAvailabilityAssumption(null);

    if (option === "custom") {
      setShowDatePicker(true);
    } else if (option === "today") {
      setShowTimePicker(true);
    }
  };

  const handleWeekendDaySelect = (day: "saturday" | "sunday") => {
    setSelectedWeekendDay(day);
    setIsAvailabilityChecked(false);
    setIsPlaceOpen(false);
    setProposedDateTime(null);
    setAvailabilityAssumption(null);
    setShowTimePicker(true);
  };

  const calculateProposedDateTime = (): Date | null => {
    if (!selectedDateOption) return null;

    const now = new Date();

    switch (selectedDateOption) {
      case "now":
        return now;
      case "today": {
        const today = new Date(now);
        if (customTime) {
          today.setHours(customTime.getHours());
          today.setMinutes(customTime.getMinutes());
        } else {
          return now;
        }
        return today;
      }
      case "weekend": {
        if (!selectedWeekendDay) return null;
        const dayOfWeek = now.getDay();
        let daysToAdd = 0;

        if (selectedWeekendDay === "saturday") {
          daysToAdd = dayOfWeek === 0 ? 6 : (6 - dayOfWeek + 7) % 7 || 7;
        } else {
          daysToAdd = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
        }

        const weekendDate = new Date(now);
        weekendDate.setDate(now.getDate() + daysToAdd);
        if (customTime) {
          weekendDate.setHours(customTime.getHours());
          weekendDate.setMinutes(customTime.getMinutes());
        } else {
          weekendDate.setHours(14, 0, 0, 0);
        }
        return weekendDate;
      }
      case "custom": {
        const combinedDateTime = new Date(customDate);
        if (customTime) {
          combinedDateTime.setHours(customTime.getHours());
          combinedDateTime.setMinutes(customTime.getMinutes());
        } else {
          combinedDateTime.setHours(12, 0, 0, 0);
        }
        return combinedDateTime;
      }
      default:
        return null;
    }
  };

  // [ORCH-0649 — CONSTITUTION #2] Local parseTimeString + checkPlaceAvailability
  // DELETED. Canonical isPlaceOpenAt (openingHoursUtils.ts) is now the single
  // owner of the open/closed decision. See call site below for the
  // true | false | null → {isOpen, isAssumption, reason} mapping.

  const handleDatePickerChange = (_event: any, date?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }

    if (date) {
      setCustomDate(date);
      setIsAvailabilityChecked(false);
      setIsPlaceOpen(false);
      setProposedDateTime(null);
      setAvailabilityAssumption(null);

      // On Android, onChange fires once on OK — auto-advance to time picker.
      // On iOS, onChange fires on every spinner scroll — the "Done" button handles the transition.
      if (Platform.OS === "android") {
        setShowTimePicker(true);
      }
    }
  };

  /** iOS only: user tapped "Done" on the date picker modal */
  const handleDatePickerDone = () => {
    setShowDatePicker(false);
    setShowTimePicker(true);
  };

  const handleTimePickerChange = (_event: any, time?: Date) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }
    // On iOS: do NOT dismiss — onChange fires on every spinner scroll.
    // The user dismisses via "Done", "Cancel", or backdrop tap.

    if (time) {
      setCustomTime(time);
      setIsAvailabilityChecked(false);
      setIsPlaceOpen(false);
      setProposedDateTime(null);
      setAvailabilityAssumption(null);
    }
  };

  /** iOS only: user tapped "Done" on the time picker modal */
  const handleTimePickerDone = () => {
    setShowTimePicker(false);
  };

  const handleCheckCompatibility = async () => {
    if (!selectedDateOption) return;
    if (selectedDateOption === "weekend" && !selectedWeekendDay) return;
    if (selectedDateOption === "custom" && !customDate) return;

    if (
      (selectedDateOption === "today" ||
        selectedDateOption === "weekend" ||
        selectedDateOption === "custom") &&
      !customTime
    ) {
      return;
    }

    setIsCheckingAvailability(true);

    const proposedDate = calculateProposedDateTime();
    if (!proposedDate) {
      setIsCheckingAvailability(false);
      return;
    }

    setProposedDateTime(proposedDate);

    setTimeout(() => {
      // [ORCH-0649] Canonical isPlaceOpenAt → {isOpen, isAssumption, reason}.
      // null result = "cannot determine" → treat as advisory (allow schedule
      // but show warning), NOT as closed.
      const weekdayText = extractWeekdayText(card?.openingHours ?? null);
      const openAt = isPlaceOpenAt(weekdayText, proposedDate);
      if (openAt === null) {
        setIsPlaceOpen(true);
        setAvailabilityAssumption(t('activity:proposeDateTimeModal.hoursUnknown'));
      } else {
        setIsPlaceOpen(openAt);
        setAvailabilityAssumption(null);
      }
      setIsAvailabilityChecked(true);
      setIsCheckingAvailability(false);
    }, 500);
  };

  // For regular cards: schedule after availability check
  const handleScheduleRegular = () => {
    if (!proposedDateTime || !selectedDateOption) return;
    onProposeDateTime(proposedDateTime, selectedDateOption);
  };

  // For curated cards: schedule directly (validation happens in SavedTab.handleProposeDateTime)
  const handleScheduleCuratedDirect = () => {
    if (!selectedDateOption) return;

    // Validate required selections
    if (selectedDateOption === "weekend" && !selectedWeekendDay) return;
    if (selectedDateOption === "custom" && !customDate) return;
    if (
      (selectedDateOption === "today" ||
        selectedDateOption === "weekend" ||
        selectedDateOption === "custom") &&
      !customTime
    ) {
      return;
    }

    const proposedDate = calculateProposedDateTime();
    if (!proposedDate) return;

    onProposeDateTime(proposedDate, selectedDateOption);
  };

  // Formatted selected time for display
  const selectedTimeLabel = useMemo(() => {
    if (!selectedDateOption) return null;

    if (selectedDateOption === "now") return t('activity:proposeDateTimeModal.rightNow');

    if (selectedDateOption === "today" && customTime) {
      return `Today at ${customTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}`;
    }

    if (selectedDateOption === "weekend" && selectedWeekendDay && customTime) {
      const dayLabel =
        selectedWeekendDay === "saturday" ? "Saturday" : "Sunday";
      return `${dayLabel} at ${customTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}`;
    }

    if (selectedDateOption === "custom" && customDate && customTime) {
      const dateStr = customDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const timeStr = customTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `${dateStr} at ${timeStr}`;
    }

    return null;
  }, [selectedDateOption, customTime, customDate, selectedWeekendDay]);

  const formatDate = (dateStr: Date | string): string => {
    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: Date | string): string => {
    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const resetModal = () => {
    setSelectedDateOption(null);
    setSelectedWeekendDay(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setCustomDate(new Date());
    setCustomTime(null);
    setIsAvailabilityChecked(false);
    setIsPlaceOpen(false);
    setIsCheckingAvailability(false);
    setProposedDateTime(null);
    setAvailabilityAssumption(null);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent={true}
        animationType="none"
        onRequestClose={animateClose}
        statusBarTranslucent
      >
        <KeyboardAwareView
          style={{ flex: 1 }}
          dismissOnTap={false}
        >
          {/* Backdrop */}
          <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={animateClose}
            />
          </Animated.View>

          {/* Bottom Sheet */}
          <Animated.View
            style={[
              styles.bottomSheet,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Drag handle */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIconContainer}>
                  <Icon
                    name={isCurated ? "map" : "calendar"}
                    size={18}
                    color="#F59E0B"
                  />
                </View>
                <View style={styles.headerTextContainer}>
                  <Text style={styles.headerTitle}>
                    {isCurated ? t('activity:proposeDateTimeModal.schedulePlan') : t('activity:proposeDateTimeModal.scheduleExperience')}
                  </Text>
                  {card && (
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                      {card.title}
                    </Text>
                  )}
                </View>
              </View>
              <TouchableOpacity
                onPress={animateClose}
                style={styles.closeButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon
                  name="close"
                  size={18}
                  color="rgba(255,255,255,0.6)"
                />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <ScrollView
              style={styles.scrollContent}
              contentContainerStyle={styles.scrollContentContainer}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Curated plan info banner */}
              {isCurated && stopCount > 0 && (
                <View style={styles.curatedBanner}>
                  <Icon
                    name="trail-sign-outline"
                    size={16}
                    color="#F59E0B"
                  />
                  <Text style={styles.curatedBannerText}>
                    {stopCount} stops · Opening hours will be validated for all
                    stops
                  </Text>
                </View>
              )}

              {/* Opening Hours Section (regular cards only) */}
              {!isCurated && parsedOpeningHours && (
                <View style={styles.openingHoursSection}>
                  <View style={styles.openingHoursHeader}>
                    <Icon name="time" size={18} color="#F59E0B" />
                    <Text style={styles.openingHoursTitle}>{t('activity:proposeDateTimeModal.openingHours')}</Text>
                    {liveOpenStatus !== null && (
                      <View
                        style={[
                          styles.openNowBadge,
                          liveOpenStatus
                            ? styles.openNowBadgeOpen
                            : styles.openNowBadgeClosed,
                        ]}
                      >
                        <View
                          style={[
                            styles.openNowDot,
                            liveOpenStatus
                              ? styles.openNowDotOpen
                              : styles.openNowDotClosed,
                          ]}
                        />
                        <Text
                          style={[
                            styles.openNowText,
                            liveOpenStatus
                              ? styles.openNowTextOpen
                              : styles.openNowTextClosed,
                          ]}
                        >
                          {liveOpenStatus ? t('activity:proposeDateTimeModal.openNow') : t('activity:proposeDateTimeModal.closed')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.openingHoursList}>
                    {parsedOpeningHours.lines.map(
                      (line: string, index: number) => {
                        const isToday = line.startsWith(todayDayName);
                        return (
                          <View
                            key={index}
                            style={[
                              styles.openingHoursRow,
                              isToday && styles.openingHoursRowToday,
                            ]}
                          >
                            {isToday && <View style={styles.todayIndicator} />}
                            <Text
                              style={[
                                styles.openingHoursText,
                                isToday && styles.openingHoursTextToday,
                              ]}
                            >
                              {line}
                            </Text>
                          </View>
                        );
                      },
                    )}
                  </View>
                </View>
              )}

              {/* Current Scheduled Date (if rescheduling) */}
              {currentScheduledDate && (
                <View style={styles.currentScheduleSection}>
                  <View style={styles.currentScheduleHeader}>
                    <Icon name="calendar" size={16} color="#F59E0B" />
                    <Text style={styles.currentScheduleTitle}>
                      {t('activity:proposeDateTimeModal.currentlyScheduled')}
                    </Text>
                  </View>
                  <Text style={styles.currentScheduleValue}>
                    {formatDate(currentScheduledDate)} at{" "}
                    {formatTime(currentScheduledDate)}
                  </Text>
                </View>
              )}

              {/* Date Selection */}
              <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>{t('activity:proposeDateTimeModal.pickADate')}</Text>
                <DateOptionsGrid
                  selectedDateOption={selectedDateOption}
                  onSelectOption={handleDateOptionSelect}
                  dark
                />

                {selectedDateOption === "weekend" && (
                  <WeekendDaySelection
                    selectedWeekendDay={selectedWeekendDay}
                    onSelectDay={handleWeekendDaySelect}
                    dark
                  />
                )}
              </View>

              {/* Selected time display */}
              {selectedTimeLabel && (
                <View style={styles.selectedTimeContainer}>
                  <Icon name="time-outline" size={16} color="#F59E0B" />
                  <Text style={styles.selectedTimeText}>
                    {selectedTimeLabel}
                  </Text>
                  {selectedDateOption !== "now" && (
                    <TouchableOpacity
                      onPress={() => setShowTimePicker(true)}
                      style={styles.changeTimeButton}
                    >
                      <Text style={styles.changeTimeText}>{t('activity:proposeDateTimeModal.changeTime')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Availability messages (regular cards only) */}
              {!isCurated && isAvailabilityChecked && !isPlaceOpen && (
                <View style={styles.availabilityMessage}>
                  <Icon name="warning" size={18} color="#ef4444" />
                  <Text style={styles.availabilityMessageText}>
                    {t('activity:proposeDateTimeModal.closedAtTime')}
                  </Text>
                </View>
              )}

              {!isCurated &&
                isAvailabilityChecked &&
                isPlaceOpen &&
                availabilityAssumption && (
                  <View style={styles.assumptionWarning}>
                    <Icon
                      name="information-circle"
                      size={18}
                      color="#F59E0B"
                    />
                    <Text style={styles.assumptionWarningText}>
                      {availabilityAssumption}. Please verify opening hours
                      before scheduling.
                    </Text>
                  </View>
                )}
            </ScrollView>

            {/* Footer */}
            <ProposeDateTimeFooter
              selectedDateOption={selectedDateOption}
              selectedWeekendDay={selectedWeekendDay}
              isAvailabilityChecked={isAvailabilityChecked}
              isPlaceOpen={isPlaceOpen}
              isCheckingAvailability={isCheckingAvailability}
              onCheckAvailability={handleCheckCompatibility}
              onSchedule={
                isCurated ? handleScheduleCuratedDirect : handleScheduleRegular
              }
              isScheduling={isScheduling}
              isCurated={isCurated}
              customTime={customTime}
              dark
            />
          </Animated.View>

        {/* Date Picker — INSIDE main Modal as overlay (iOS) */}
        {showDatePicker && Platform.OS === "ios" && (
          <View style={pickerModalStyles.overlay}>
            <TouchableOpacity
              style={pickerModalStyles.backdrop}
              activeOpacity={1}
              onPress={() => setShowDatePicker(false)}
            />
            <SafeAreaView
              style={[pickerModalStyles.content, { paddingBottom: Math.max(insets.bottom, 20) }]}
              edges={["bottom", "left", "right"]}
            >
              <View style={pickerModalStyles.header}>
                <Text style={pickerModalStyles.title}>{t('activity:proposeDateTimeModal.selectDate')}</Text>
                <View style={pickerModalStyles.headerButtons}>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                    <Text style={pickerModalStyles.cancelText}>{t('activity:proposeDateTimeModal.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDatePickerDone}>
                    <Text style={pickerModalStyles.doneText}>{t('activity:proposeDateTimeModal.done')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <DateTimePicker
                value={customDate}
                mode="date"
                display="spinner"
                onChange={handleDatePickerChange}
                minimumDate={new Date()}
                style={pickerModalStyles.picker}
              />
            </SafeAreaView>
          </View>
        )}

        {/* Time Picker — INSIDE main Modal as overlay (iOS) */}
        {showTimePicker && Platform.OS === "ios" && (
          <View style={pickerModalStyles.overlay}>
            <TouchableOpacity
              style={pickerModalStyles.backdrop}
              activeOpacity={1}
              onPress={() => setShowTimePicker(false)}
            />
            <SafeAreaView
              style={[pickerModalStyles.content, { paddingBottom: Math.max(insets.bottom, 20) }]}
              edges={["bottom", "left", "right"]}
            >
              <View style={pickerModalStyles.header}>
                <Text style={pickerModalStyles.title}>Select Time</Text>
                <View style={pickerModalStyles.headerButtons}>
                  <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                    <Text style={pickerModalStyles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleTimePickerDone}>
                    <Text style={pickerModalStyles.doneText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <DateTimePicker
                value={customTime || new Date()}
                mode="time"
                display="spinner"
                is24Hour={false}
                onChange={handleTimePickerChange}
                style={pickerModalStyles.picker}
              />
            </SafeAreaView>
          </View>
        )}
        </KeyboardAwareView>
      </Modal>

      {/* Android native pickers — render OUTSIDE Modal (native dialogs always on top) */}
      {showDatePicker && Platform.OS === "android" && (
        <DateTimePicker
          value={customDate}
          mode="date"
          display="default"
          onChange={handleDatePickerChange}
          minimumDate={new Date()}
        />
      )}
      {showTimePicker && Platform.OS === "android" && (
        <DateTimePicker
          value={customTime || new Date()}
          mode="time"
          display="default"
          is24Hour={false}
          onChange={handleTimePickerChange}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1C1C1E",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 16,
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  headerIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.5)",
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    maxHeight: SCREEN_HEIGHT * 0.55,
  },
  scrollContentContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  curatedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.15)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  curatedBannerText: {
    fontSize: 13,
    color: "rgba(245,158,11,0.9)",
    fontWeight: "500",
    flex: 1,
  },
  openingHoursSection: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    marginBottom: 16,
  },
  openingHoursHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  openingHoursTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
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
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  openNowBadgeClosed: {
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  openNowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  openNowDotOpen: {
    backgroundColor: "#22c55e",
  },
  openNowDotClosed: {
    backgroundColor: "#ef4444",
  },
  openNowText: {
    fontSize: 11,
    fontWeight: "600",
  },
  openNowTextOpen: {
    color: "#22c55e",
  },
  openNowTextClosed: {
    color: "#ef4444",
  },
  openingHoursList: {
    gap: 1,
  },
  openingHoursRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  openingHoursRowToday: {
    backgroundColor: "rgba(245,158,11,0.08)",
  },
  todayIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#F59E0B",
    marginRight: 8,
  },
  openingHoursText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    lineHeight: 18,
  },
  openingHoursTextToday: {
    fontWeight: "700",
    color: "#F59E0B",
  },
  currentScheduleSection: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    marginBottom: 16,
  },
  currentScheduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    gap: 8,
  },
  currentScheduleTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
  },
  currentScheduleValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  sectionContainer: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
    marginBottom: 12,
  },
  selectedTimeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.15)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  selectedTimeText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#F59E0B",
    flex: 1,
  },
  changeTimeButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(245,158,11,0.12)",
  },
  changeTimeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#F59E0B",
  },
  availabilityMessage: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  availabilityMessageText: {
    flex: 1,
    fontSize: 13,
    color: "#ef4444",
    fontWeight: "500",
  },
  assumptionWarning: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245,158,11,0.08)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.15)",
  },
  assumptionWarningText: {
    flex: 1,
    fontSize: 13,
    color: "rgba(245,158,11,0.9)",
    fontWeight: "500",
  },
});

const pickerModalStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  content: {
    backgroundColor: "#1C1C1E",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.45,
    overflow: 'hidden',
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
    minHeight: 48,
  },
  headerButtons: {
    flexDirection: "row",
    gap: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  cancelText: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.6)",
    fontWeight: "500",
  },
  doneText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#F59E0B",
  },
  picker: {
    height: Math.min(200, SCREEN_HEIGHT * 0.25),
  },
});
