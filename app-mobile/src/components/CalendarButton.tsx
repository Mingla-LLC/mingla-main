import React, { useState, useEffect, useCallback } from "react";
import {
  TouchableOpacity,
  Text,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Icon } from './ui/Icon';
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeviceCalendarService } from "../services/deviceCalendarService";
import { buildHolidayCalendarEvent } from "../utils/calendarReminders";
import { s, vs } from "../utils/responsive";
import { useTranslation } from 'react-i18next';

interface CalendarButtonProps {
  /** Unique key for this occasion — e.g. "birthday" or holiday ID */
  holidayKey: string;
  /** AsyncStorage key scoped to pairingId */
  pairingId: string;
  /** Title for the calendar event */
  eventTitle: string;
  /** Next occurrence date */
  nextOccurrence: Date;
  /** Notes for the calendar event */
  notes?: string;
  /** Name used in permission denial alerts */
  personName: string;
  /** Occasion label used in permission denial alerts */
  occasionLabel: string;
}

const STORAGE_PREFIX = "mingla_calendar_events_";

function getStorageKey(pairingId: string): string {
  return `${STORAGE_PREFIX}${pairingId}`;
}

export default function CalendarButton({
  holidayKey,
  pairingId,
  eventTitle,
  nextOccurrence,
  notes,
  personName,
  occasionLabel,
}: CalendarButtonProps) {
  const { t } = useTranslation(['common']);
  const [isAdded, setIsAdded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check AsyncStorage on mount for previously added events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(getStorageKey(pairingId));
        if (raw && !cancelled) {
          const stored: Record<string, { eventId: string; addedAt: string }> =
            JSON.parse(raw);
          if (stored[holidayKey]) {
            setIsAdded(true);
          }
        }
      } catch {
        // Ignore read errors — default to not-added
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairingId, holidayKey]);

  const handlePress = useCallback(async () => {
    if (isAdded || isLoading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsLoading(true);

    try {
      // Check permissions
      const hasPerms = await DeviceCalendarService.hasPermissions();
      if (!hasPerms) {
        const granted = await DeviceCalendarService.requestPermissions();
        if (!granted) {
          setIsLoading(false);
          if (Platform.OS === "ios") {
            Alert.alert(
              t('common:calendar_access_needed'),
              t('common:calendar_access_needed_msg'),
              [
                { text: t('common:cancel'), style: "cancel" },
                {
                  text: t('common:open_settings'),
                  onPress: () => Linking.openSettings(),
                },
              ]
            );
          } else {
            Alert.alert(
              t('common:calendar_permission'),
              t('common:calendar_permission_msg'),
              [{ text: t('common:ok') }]
            );
          }
          return;
        }
      }

      // Get default calendar
      const calendarId = await DeviceCalendarService.getDefaultCalendarId();
      if (!calendarId) {
        setIsLoading(false);
        Alert.alert(
          t('common:no_calendar'),
          t('common:no_calendar_msg'),
          [{ text: t('common:ok') }]
        );
        return;
      }

      // Create event with 7-tier reminders using expo-calendar directly
      // to avoid DeviceCalendarService.addEventToDeviceCalendar's duplicate alerts
      const event = buildHolidayCalendarEvent(eventTitle, nextOccurrence, notes);
      const Calendar = await import("expo-calendar");
      const eventId = await Calendar.createEventAsync(calendarId, {
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        notes: event.notes,
        alarms: event.alarms,
      });

      if (eventId) {
        // Persist to AsyncStorage
        const storageKey = getStorageKey(pairingId);
        let stored: Record<string, { eventId: string; addedAt: string }> = {};
        try {
          const raw = await AsyncStorage.getItem(storageKey);
          if (raw) stored = JSON.parse(raw);
        } catch {
          // Fresh object
        }
        stored[holidayKey] = {
          eventId,
          addedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(storageKey, JSON.stringify(stored));

        setIsAdded(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert(
        t('common:calendar_error'),
        t('common:calendar_error_msg'),
        [{ text: t('common:ok') }]
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    isAdded,
    isLoading,
    pairingId,
    holidayKey,
    eventTitle,
    nextOccurrence,
    notes,
    personName,
    occasionLabel,
  ]);

  return (
    <TouchableOpacity
      style={[styles.button, isAdded && styles.buttonAdded]}
      onPress={handlePress}
      disabled={isAdded || isLoading}
      activeOpacity={0.7}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color="#eb7825" />
      ) : (
        <>
          <Icon
            name={isAdded ? "checkmark-circle" : "calendar-outline"}
            size={s(16)}
            color={isAdded ? "#FFFFFF" : "#eb7825"}
          />
          <Text style={[styles.buttonText, isAdded && styles.buttonTextAdded]}>
            {isAdded ? `${t('common:added_to_calendar')} \u2713` : t('common:add_to_calendar')}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    borderWidth: 1,
    borderColor: "#eb7825",
    borderRadius: s(10),
    paddingHorizontal: s(12),
    paddingVertical: vs(8),
    alignSelf: "flex-start",
    marginTop: s(10),
  },
  buttonAdded: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  buttonText: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#eb7825",
  },
  buttonTextAdded: {
    color: "#FFFFFF",
  },
});
