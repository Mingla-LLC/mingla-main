import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Icon } from "../ui/Icon";
import { useTranslation } from 'react-i18next';

interface ProposeDateTimeFooterProps {
  selectedDateOption: "now" | "today" | "weekend" | "custom" | null;
  selectedWeekendDay?: "saturday" | "sunday" | null;
  isAvailabilityChecked: boolean;
  isPlaceOpen: boolean;
  isCheckingAvailability: boolean;
  onCheckAvailability: () => void;
  onSchedule: () => void;
  isScheduling?: boolean;
  isCurated?: boolean;
  customTime?: Date | null;
  dark?: boolean;
}

export default function ProposeDateTimeFooter({
  selectedDateOption,
  selectedWeekendDay,
  isAvailabilityChecked,
  isPlaceOpen,
  isCheckingAvailability,
  onCheckAvailability,
  onSchedule,
  isScheduling = false,
  isCurated = false,
  customTime,
  dark = false,
}: ProposeDateTimeFooterProps) {
  const { t } = useTranslation(['activity', 'common']);
  const footerBg = dark ? "#1C1C1E" : "white";

  // ---------- CURATED FLOW ----------
  // Curated cards skip "Check Availability" entirely inside the modal.
  // The user picks a date/time then taps "Schedule Plan" directly.
  // Validation of all stop opening hours happens externally in SavedTab.handleProposeDateTime.
  if (isCurated) {
    const needsTime =
      selectedDateOption === "today" ||
      selectedDateOption === "weekend" ||
      selectedDateOption === "custom";
    const isReady =
      selectedDateOption === "now" ||
      (selectedDateOption === "today" && customTime) ||
      (selectedDateOption === "weekend" && selectedWeekendDay && customTime) ||
      (selectedDateOption === "custom" && customTime);

    return (
      <View style={[styles.footer, { backgroundColor: footerBg }]}>
        <TouchableOpacity
          style={[
            styles.button,
            dark && styles.buttonDark,
            (!isReady || isScheduling) && styles.buttonDisabled,
          ]}
          onPress={onSchedule}
          disabled={!isReady || isScheduling}
          activeOpacity={0.7}
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Icon name="map" size={20} color="white" />
          )}
          <Text style={styles.buttonText}>
            {isScheduling
              ? t('activity:proposeDateTimeFooter.scheduling')
              : !selectedDateOption
                ? t('activity:proposeDateTimeFooter.pickDateFirst')
                : needsTime && !customTime
                  ? t('activity:proposeDateTimeFooter.pickATime')
                  : t('activity:proposeDateTimeFooter.schedulePlan')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- REGULAR FLOW ----------
  // Step 1: Check Availability  →  Step 2: Schedule (only if place is open)

  if (isAvailabilityChecked && isPlaceOpen) {
    return (
      <View style={[styles.footer, { backgroundColor: footerBg }]}>
        <TouchableOpacity
          style={[
            styles.button,
            dark && styles.buttonDark,
            isScheduling && styles.buttonDisabled,
          ]}
          onPress={onSchedule}
          disabled={isScheduling}
          activeOpacity={0.7}
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Icon name="calendar" size={20} color="white" />
          )}
          <Text style={styles.buttonText}>
            {isScheduling ? t('activity:proposeDateTimeFooter.scheduling') : t('activity:proposeDateTimeFooter.schedule')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Check Availability button
  const isButtonDisabled =
    !selectedDateOption ||
    isCheckingAvailability ||
    (selectedDateOption === "weekend" && !selectedWeekendDay);

  return (
    <View style={[styles.footer, { backgroundColor: footerBg }]}>
      <TouchableOpacity
        style={[
          styles.button,
          dark && styles.buttonDark,
          isButtonDisabled && styles.buttonDisabled,
        ]}
        onPress={onCheckAvailability}
        disabled={isButtonDisabled}
        activeOpacity={0.7}
      >
        {isCheckingAvailability ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <Icon name="sparkles" size={20} color="white" />
        )}
        <Text style={styles.buttonText}>
          {isCheckingAvailability ? t('activity:proposeDateTimeFooter.checking') : t('activity:proposeDateTimeFooter.checkAvailability')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  button: {
    backgroundColor: "#ea580c",
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonDark: {
    backgroundColor: "#F59E0B",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
});
