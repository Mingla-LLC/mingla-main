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

import {
  EventDatePicker,
  type EventDatePickerOccurrenceRenderArgs,
} from "@mingla/offering-rendering/EventDatePicker";
import type { EventDateScheduleOccurrence } from "@mingla/offering-rendering/eventDateSchedule";

import type { PublicEventOccurrenceLike } from "../../hooks/usePublicEventBySlug";
import { formatOccurrenceLine } from "../../utils/eventDateDisplay";
import { Icon } from "../ui/Icon";

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
  // #2160 §7(b) parity with Host web — the price basis is named before any
  // total: an all-days pass shows the approved mode copy.
  const countLine = allDaysPass
    ? isPaid
      ? "One price for all days"
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
          {/* The chooser owns loading / error / offline / stale recovery above,
              so the shared picker always renders the known days ("ready"):
              offline keeps the last validated day set visible and editable
              while the sheet still blocks checkout until truth returns. */}
          <EventDatePicker
            occurrences={schedule}
            selectedIds={selectedEventDateIds}
            onToggle={onToggle}
            allDaysPass={allDaysPass}
            status="ready"
            onRetry={onRetry}
            accentColor="#eb7825"
            mutedColor="rgba(255, 255, 255, 0.52)"
            testID="issue-2230-day-picker"
            occurrenceTestIDPrefix="issue-2230-day-row"
            renderOccurrence={(row: EventDatePickerOccurrenceRenderArgs) => {
              const checked = row.selected;
              const disabled = rowsDisabled === true || row.soldOut;
              // #2209 / I-14 — the label is owned by formatOccurrenceLine.
              const label =
                formatOccurrenceLine(row.occurrence, timezone) ??
                "Date to be confirmed";
              const detail = [row.title, row.location, row.placesLeftLabel]
                .filter((part): part is string => part !== null)
                .join(" · ");
              return (
                <Pressable
                  key={row.key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled }}
                  accessibilityLabel={label}
                  accessibilityHint={detail.length > 0 ? detail : undefined}
                  disabled={disabled}
                  onPress={row.toggle}
                  testID={row.testID}
                  style={({ pressed }) => [
                    styles.row,
                    checked && styles.rowSelected,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                  ]}
                >
                  <View
                    style={[styles.checkbox, checked && styles.checkboxSelected]}
                  >
                    {checked ? (
                      <Icon name="check" size={14} color="#15181f" />
                    ) : null}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{label}</Text>
                    {detail.length > 0 ? (
                      <Text style={styles.rowDetail}>{detail}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
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
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "#23262c",
  },
  rowSelected: {
    borderColor: "#eb7825",
    backgroundColor: "#2f2420",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    borderColor: "#eb7825",
    backgroundColor: "#eb7825",
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 14,
    lineHeight: 20,
  },
  rowDetail: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: { opacity: 0.92 },
  disabled: { opacity: 0.55 },
});

export default EventDayChooser;
