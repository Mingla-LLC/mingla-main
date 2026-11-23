/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — <BookingDeadlinePicker />.
 *
 * #4522 / #4523: the deadline is picked on the shared Mingla calendar
 * (`HostDateTimeField`) in the TRIP's time zone, not the phone's. The host sees
 * the zone ("In Lagos time") and the saved value is the instant that wall clock
 * is in that zone, so a host travelling, or a buyer abroad, never moves it.
 * Nothing commits until the host presses Done in the calendar, and a deadline
 * that is not in the future or not before the trip starts is said, not saved.
 *
 * The OS date spinner, the Android two-step and the browser datetime-local
 * input this component used to carry are gone.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { timezoneCityName } from "../../utils/timezones";
import { HostDateTimeField } from "../ui/HostCalendarFields";
import { Switch } from "../ui/Switch";
import {
  deadlineBounds,
  deadlineProblem,
  instantFromWall,
  wallInZone,
} from "./tripBuilderV2Model";

export interface BookingDeadlinePickerProps {
  /** ISO timestamptz string, or null = no deadline set. */
  value: string | null;
  /** Trip start ISO — the deadline must come before it. */
  tripStartIso: string | null;
  /** The trip's IANA time zone. Falls back to "UTC". */
  brandTimezone: string | null;
  onChange: (next: string | null) => void;
}

const EMPTY = { date: "", time: "" } as const;

export const BookingDeadlinePicker: React.FC<BookingDeadlinePickerProps> = ({
  value,
  tripStartIso,
  brandTimezone,
  onChange,
}) => {
  const zone = brandTimezone ?? "UTC";
  const [wantsDeadline, setWantsDeadline] = useState<boolean>(value !== null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setWantsDeadline(value !== null);
  }, [value]);

  const wall = useMemo(
    () => (value === null ? EMPTY : (wallInZone(value, zone) ?? EMPTY)),
    [value, zone],
  );
  const tzLabel = timezoneCityName(brandTimezone ?? "UTC");
  // #4523 S-8 — offer only what can be saved: from now to before the start.
  const bounds = deadlineBounds(tripStartIso, zone);

  const handleToggle = useCallback(
    (next: boolean): void => {
      setWantsDeadline(next);
      setProblem(null);
      if (!next) onChange(null);
    },
    [onChange],
  );

  const handlePick = useCallback(
    (picked: { date: string; time: string }): void => {
      if (picked.date === "" || picked.time === "") return;
      const iso = instantFromWall(picked.date, picked.time, zone);
      if (iso === null) {
        setProblem("That deadline is not a real date and time.");
        return;
      }
      const err = deadlineProblem(iso, tripStartIso, Date.now());
      if (err !== null) {
        setProblem(err);
        return;
      }
      setProblem(null);
      onChange(iso);
    },
    [onChange, tripStartIso, zone],
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>BOOKING DEADLINE</Text>
        <Switch
          value={wantsDeadline}
          onValueChange={handleToggle}
          accessibilityLabel="Set a booking deadline"
          testID="booking-deadline-switch"
        />
      </View>

      {!wantsDeadline ? (
        <Text style={styles.helper}>
          Bookings stay open until the trip starts. Turn on to set a cutoff.
        </Text>
      ) : (
        <View style={styles.fieldWrap}>
          <HostDateTimeField
            label="Bookings close"
            accessibilityLabel="Booking deadline date and time"
            value={wall}
            onChangeValue={handlePick}
            min={bounds.min}
            minTime={bounds.minTime}
            max={bounds.max}
            maxTime={bounds.maxTime}
            timeZone={zone}
            hasError={problem !== null}
            placeholder="Pick a deadline"
            testID="booking-deadline-field"
          />
          <Text style={styles.helper} testID="booking-deadline-zone">
            In {tzLabel} time — your trip&rsquo;s time zone
          </Text>
        </View>
      )}

      {problem !== null ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite" testID="booking-deadline-error">
          {problem}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingVertical: space[2], gap: space[2] },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: color.text2,
  },
  fieldWrap: { gap: space[2] },
  helper: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text3,
  },
  errorText: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.danger,
  },
});
