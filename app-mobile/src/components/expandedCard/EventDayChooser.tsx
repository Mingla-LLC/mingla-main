/**
 * EventDayChooser — Explorer multi-date day picker (issue #2230).
 * issue #3281 many-dates PR 5 — thin wrapper over shared EventDatePicker.
 */
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { EventDatePicker } from "@mingla/offering-rendering/EventDatePicker";
import type { EventDateScheduleOccurrence } from "@mingla/offering-rendering/eventDateSchedule";

import type { PublicEventOccurrenceLike } from "../../hooks/usePublicEventBySlug";

export type EventDayChooserStatus =
  "loading" | "ready" | "error" | "offline" | "stale";

export interface EventDayChooserProps {
  occurrences: readonly PublicEventOccurrenceLike[];
  selectedEventDateIds: readonly string[];
  pricingMode: "per_day" | "all_days";
  /** issue #3281 — prefer bundle allDaysPass; falls back to pricingMode. */
  allDaysPass?: boolean;
  isPaid: boolean;
  timezone: string;
  status: EventDayChooserStatus;
  highlightUnchosen: boolean;
  rowsDisabled?: boolean;
  retryDisabled?: boolean;
  onToggle: (eventDateId: string) => void;
  onRetry: () => void;
}

const statusCopy = (
  status: EventDayChooserStatus,
): { message: string; action: string } | null => {
  if (status === "error") {
    return { message: "We couldn’t load the event days.", action: "Try again" };
  }
  if (status === "offline") {
    return {
      message: "You’re offline. Reconnect to continue.",
      action: "Try again",
    };
  }
  if (status === "stale") {
    return {
      message: "Those dates just changed. Refresh and choose again.",
      action: "Refresh days",
    };
  }
  return null;
};

const toSchedule = (
  occurrences: readonly PublicEventOccurrenceLike[],
  fallbackTimezone: string,
): EventDateScheduleOccurrence[] =>
  occurrences.map((o) => ({
    id: o.id,
    startAt: o.startAt,
    endAt: o.endAt,
    timezone: o.timezone || fallbackTimezone,
    overrideTitle: o.overrideTitle ?? null,
    overrideLocation: o.overrideLocation ?? null,
    soldOut: o.soldOut ?? null,
    placesLeft: o.placesLeft ?? null,
  }));

export const EventDayChooser: React.FC<EventDayChooserProps> = ({
  occurrences,
  selectedEventDateIds,
  pricingMode,
  allDaysPass: allDaysPassProp,
  isPaid,
  timezone,
  status,
  highlightUnchosen,
  rowsDisabled = false,
  retryDisabled = false,
  onToggle,
  onRetry,
}) => {
  const allDaysPass = allDaysPassProp === true || pricingMode === "all_days";
  const schedule = useMemo(
    () => toSchedule(occurrences, timezone),
    [occurrences, timezone],
  );
  const chosen = selectedEventDateIds.length;
  const countLine = allDaysPass
    ? isPaid
      ? "One price covers every date"
      : "Every date of this event"
    : chosen === 0
      ? `${occurrences.length} days`
      : !isPaid
        ? `${chosen} of ${occurrences.length} selected`
        : pricingMode === "per_day"
          ? `Priced per day · ${chosen} of ${occurrences.length} selected`
          : `One price for all days · ${chosen} of ${occurrences.length} selected`;
  const unavailable = status === "loading" || status === "error";
  const recovery = statusCopy(status);
  const pickerStatus =
    status === "loading"
      ? "loading"
      : status === "error"
        ? "error"
        : status === "offline"
          ? "offline"
          : status === "stale"
            ? "stale"
            : "ready";

  return (
    <View
      style={styles.host}
      accessibilityLabel="Days you're attending"
      accessibilityState={{ busy: status === "loading" }}
      testID="issue-2230-event-day-chooser"
    >
      <Text style={styles.heading}>
        {allDaysPass ? "Your dates" : "Pick your days"}
      </Text>
      {status === "loading" ? (
        <View
          style={styles.loadingRow}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading event days"
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}
        >
          <ActivityIndicator color="#eb7825" />
          <Text style={styles.count}>Loading event days…</Text>
        </View>
      ) : (
        <Text style={styles.count}>{countLine}</Text>
      )}

      {highlightUnchosen &&
      !allDaysPass &&
      chosen === 0 &&
      status === "ready" ? (
        <Text style={styles.alert} accessibilityRole="alert">
          {"Choose at least one day you're attending to continue."}
        </Text>
      ) : null}

      {recovery !== null ? (
        <View style={styles.recovery} accessibilityRole="alert">
          <Text style={styles.alert}>{recovery.message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recovery.action}
            disabled={retryDisabled}
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retry,
              pressed && styles.pressed,
              retryDisabled && styles.disabled,
            ]}
          >
            <Text style={styles.retryText}>{recovery.action}</Text>
          </Pressable>
        </View>
      ) : null}

      {!unavailable ? (
        <View
          style={[styles.pickerWrap, rowsDisabled ? styles.disabled : null]}
          pointerEvents={rowsDisabled ? "none" : "auto"}
        >
          <EventDatePicker
            occurrences={schedule}
            selectedIds={selectedEventDateIds}
            onToggle={onToggle}
            allDaysPass={allDaysPass}
            status={pickerStatus}
            onRetry={onRetry}
            accentColor="#eb7825"
            mutedColor="rgba(255, 255, 255, 0.52)"
            testID="issue-2230-day-picker"
            occurrenceTestIDPrefix="issue-2230-day-row"
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: "#1c1f26",
    marginBottom: 20,
  },
  heading: {
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  count: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  loadingRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  alert: {
    color: "#ff9a55",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  recovery: {
    alignItems: "flex-start",
  },
  retry: {
    minHeight: 44,
    justifyContent: "center",
    marginTop: 2,
  },
  retryText: {
    color: "#eb7825",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  pickerWrap: { marginTop: 10 },
  pressed: { opacity: 0.92 },
  disabled: { opacity: 0.55 },
});

export default EventDayChooser;
