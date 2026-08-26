/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — <BookingDeadlinePicker />.
 *
 * Per SPEC_ORCH-0875 §3.5.2 + DESIGN_ORCH-0875 §4 (DECISION C — operator's
 * brand TZ explicit; picker shows "in {brand.timezone} — your brand timezone").
 *
 * Wraps @react-native-community/datetimepicker. Spinner writes to a *pending*
 * state; nothing commits to `value` until the operator taps "Set deadline".
 * "Cancel" discards the pending pick.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
// issue #1027 Thread B — the ONE shared visible-native-input for web date/time.
// Class 2 fix: @react-native-community/datetimepicker has NO web build, so the
// booking-deadline picker was broken on web.
import { WebDateTimeInput } from "../ui/WebDateTimeInput";
// #2664 — Android has no `datetime` picker mode. This component's picker was
// gated `Platform.OS !== "web"`, so it reached Android and carried the same
// unmount crash as the sale window; it just had not been reported yet.
import {
  type AndroidDateTimeStep,
  combineAndroidDateAndTime,
  seedAndroidTimeStep,
} from "../../utils/androidDateTimeStep";

export interface BookingDeadlinePickerProps {
  /** ISO timestamptz string, or null = no deadline set. */
  value: string | null;
  /** Trip start ISO — used as maximumDate enforcement. */
  tripStartIso: string | null;
  /** Brand timezone label (e.g., "Asia/Bangkok"). Falls back to "UTC". */
  brandTimezone: string | null;
  onChange: (next: string | null) => void;
}

function formatDeadlineForDisplay(
  iso: string,
  brandTimezone: string | null,
): string {
  try {
    const date = new Date(iso);
    const tz = brandTimezone ?? "UTC";
    const formatter = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    });
    return formatter.format(date);
  } catch {
    return iso;
  }
}

// issue #1027 Thread B — ISO instant → `YYYY-MM-DDTHH:MM` local wall-clock for
// the web `datetime-local` input (mirrors the native picker, which also spins in
// device-local time; the brand-timezone label is display-only on the chip).
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const BookingDeadlinePicker: React.FC<BookingDeadlinePickerProps> = ({
  value,
  tripStartIso,
  brandTimezone,
  onChange,
}) => {
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Pending Date the operator is scrubbing in the spinner. Only flushed to
  // `value` when they tap "Set deadline".
  const [pendingDate, setPendingDate] = useState<Date | null>(null);
  // #2664 — Android two-step. `androidStep` names the real Android mode on
  // screen (`date` then `time`); `androidDatePart` holds the step-1 calendar
  // date. `onChange` is called once, from both halves, or not at all.
  const [androidStep, setAndroidStep] = useState<AndroidDateTimeStep | null>(
    null,
  );
  const [androidDatePart, setAndroidDatePart] = useState<Date | null>(null);
  // Track user intent independently of `value` so the controlled Switch flips
  // immediately on tap (parent `value` is still null until the spinner is
  // confirmed).
  const [wantsDeadline, setWantsDeadline] = useState<boolean>(value !== null);

  useEffect(() => {
    setWantsDeadline(value !== null);
  }, [value]);

  const toggleOn = wantsDeadline;
  const tzLabel = brandTimezone ?? "UTC";

  const openPicker = useCallback(() => {
    // Seed pending Date from current value, else default to +1h.
    const seed =
      value !== null
        ? new Date(value)
        : new Date(Date.now() + 60 * 60 * 1000);
    setPendingDate(seed);
    setValidationError(null);
    // #2664 — Android starts on the DATE half. iOS keeps its single `datetime`
    // spinner, which is a real mode there.
    setAndroidStep(Platform.OS === "android" ? "date" : null);
    setAndroidDatePart(null);
    setPickerOpen(true);
  }, [value]);

  const handleToggle = useCallback(
    (next: boolean) => {
      if (next) {
        setWantsDeadline(true);
        openPicker();
      } else {
        setWantsDeadline(false);
        onChange(null);
        setPickerOpen(false);
        setPendingDate(null);
        setAndroidStep(null);
        setAndroidDatePart(null);
        setValidationError(null);
      }
    },
    [onChange, openPicker],
  );

  const handleEditTap = useCallback(() => {
    openPicker();
  }, [openPicker]);

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === "android") {
        // #2664 — Android picker is modal and has only `date`/`time` modes, so
        // it runs as two dialogs. Cancelling EITHER abandons the whole edit:
        // a dismiss on the time step must not persist the date already chosen.
        if (event.type === "dismissed" || !selectedDate) {
          setPickerOpen(false);
          setPendingDate(null);
          setAndroidStep(null);
          setAndroidDatePart(null);
          return;
        }
        if (androidStep === "date") {
          // Step 1 of 2 — hold the calendar date, present the clock. The picker
          // stays open and `onChange` has NOT been called.
          setAndroidDatePart(selectedDate);
          setAndroidStep("time");
          return;
        }
        // Step 2 of 2 — combine both halves, then validate and commit inline
        // (no separate Set button on Android — modal UX).
        setPickerOpen(false);
        setAndroidStep(null);
        setAndroidDatePart(null);
        if (androidDatePart === null) {
          setPendingDate(null);
          return;
        }
        const combined = combineAndroidDateAndTime(
          androidDatePart,
          selectedDate,
        );
        const err = validatePending(combined.getTime(), tripStartIso);
        if (err !== null) {
          setValidationError(err);
          return;
        }
        setValidationError(null);
        onChange(combined.toISOString());
        return;
      }
      // iOS spinner — just track the in-progress selection; don't commit yet.
      if (selectedDate) {
        setPendingDate(selectedDate);
      }
    },
    [onChange, tripStartIso, androidStep, androidDatePart],
  );

  const handleConfirmPending = useCallback(() => {
    if (pendingDate === null) {
      setPickerOpen(false);
      return;
    }
    const ms = pendingDate.getTime();
    const err = validatePending(ms, tripStartIso);
    if (err !== null) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    onChange(pendingDate.toISOString());
    setPickerOpen(false);
    setPendingDate(null);
  }, [onChange, pendingDate, tripStartIso]);

  const handleCancelPending = useCallback(() => {
    setPickerOpen(false);
    setPendingDate(null);
    setAndroidStep(null);
    setAndroidDatePart(null);
    setValidationError(null);
    // If no value was ever set, flip the Switch back to off — the operator
    // backed out of the picker without picking anything.
    if (value === null) {
      setWantsDeadline(false);
    }
  }, [value]);

  // issue #1027 Thread B (Class 2) — web `datetime-local` commits on change. The
  // browser gives a naive local wall-clock; `new Date(v)` reads it in the
  // browser's local zone and `.toISOString()` stamps the instant — byte-parity
  // with the native path (device-local Date → toISOString).
  const handleWebDeadlineChange = useCallback(
    (v: string): void => {
      if (v.length === 0) return;
      const picked = new Date(v);
      if (Number.isNaN(picked.getTime())) return;
      const err = validatePending(picked.getTime(), tripStartIso);
      if (err !== null) {
        setValidationError(err);
        return;
      }
      setValidationError(null);
      onChange(picked.toISOString());
      setPickerOpen(false);
      setPendingDate(null);
    },
    [onChange, tripStartIso],
  );

  const currentValueDate =
    pendingDate ??
    (value !== null ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000));

  const maxDate = tripStartIso !== null ? new Date(tripStartIso) : undefined;
  const minDate = new Date();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>BOOKING DEADLINE</Text>
        <Switch
          value={toggleOn}
          onValueChange={handleToggle}
          accessibilityLabel="Set a booking deadline"
          accessibilityHint="When on, bookings auto-close at the chosen date and time"
          trackColor={{ false: glass.border.profileBase, true: accent.tint }}
          thumbColor={toggleOn ? accent.warm : textTokens.tertiary}
        />
      </View>

      {!toggleOn && (
        <Text style={styles.helper}>
          Bookings stay open until the trip starts. Turn on to set a cutoff.
        </Text>
      )}

      {toggleOn && value === null && !pickerOpen && (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pick a booking deadline"
            hitSlop={8}
            onPress={openPicker}
            style={({ pressed }) => [
              styles.pickButton,
              pressed && styles.pickButtonPressed,
            ]}
          >
            <Text style={styles.pickButtonLabel}>Pick a deadline</Text>
          </Pressable>
          <Text style={styles.helper}>
            Bookings will auto-close at this moment in your brand's timezone ({tzLabel}).
          </Text>
        </View>
      )}

      {toggleOn && value !== null && !pickerOpen && (
        <View style={styles.savedChip}>
          <Text style={styles.savedChipPrimary}>
            Closes {formatDeadlineForDisplay(value, brandTimezone)}
          </Text>
          <Text style={styles.savedChipMeta}>
            In {tzLabel} — your brand timezone
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Edit booking deadline"
            hitSlop={8}
            onPress={handleEditTap}
            style={({ pressed }) => [
              styles.editLinkRow,
              pressed && styles.editLinkRowPressed,
            ]}
          >
            <Text style={styles.editLinkText}>→ Edit deadline</Text>
          </Pressable>
        </View>
      )}

      {toggleOn && pickerOpen && Platform.OS === "web" && (
        /* issue #1027 Thread B (Class 2) — visible native datetime-local input
           on web; commits on change (native DateTimePicker has no web build). */
        <View style={styles.pickerWrap}>
          <WebDateTimeInput
            type="datetime-local"
            value={isoToDatetimeLocal(currentValueDate.toISOString())}
            min={isoToDatetimeLocal(minDate.toISOString())}
            max={
              maxDate !== undefined
                ? isoToDatetimeLocal(maxDate.toISOString())
                : undefined
            }
            ariaLabel="Pick booking deadline date and time"
            hasError={validationError !== null}
            testID="booking-deadline-web"
            onChangeValue={handleWebDeadlineChange}
          />
        </View>
      )}

      {toggleOn && pickerOpen && Platform.OS !== "web" && (
        <View style={styles.pickerWrap}>
          {pendingDate !== null && (
            <Text style={styles.pendingPreview}>
              {formatDeadlineForDisplay(pendingDate.toISOString(), brandTimezone)}
            </Text>
          )}
          {/* #2664 — the picker element is split by platform. `datetime` is a
              real iOS mode; Android registers only `date` and `time`, so it
              steps through both. This is CreatorStep2When's proven shape. */}
          {Platform.OS === "ios" ? (
            <DateTimePicker
              value={currentValueDate}
              mode="datetime"
              display="spinner"
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={handlePickerChange}
              themeVariant="dark"
              textColor={textTokens.primary}
            />
          ) : androidStep !== null ? (
            <DateTimePicker
              value={
                androidStep === "time" && androidDatePart !== null
                  ? seedAndroidTimeStep(androidDatePart, currentValueDate)
                  : currentValueDate
              }
              mode={androidStep === "date" ? "date" : "time"}
              display="default"
              minimumDate={androidStep === "date" ? minDate : undefined}
              maximumDate={androidStep === "date" ? maxDate : undefined}
              onChange={handlePickerChange}
            />
          ) : null}
          {Platform.OS === "ios" && (
            <View style={styles.confirmRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel deadline selection"
                hitSlop={8}
                onPress={handleCancelPending}
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && styles.cancelButtonPressed,
                ]}
              >
                <Text style={styles.cancelButtonLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set this booking deadline"
                hitSlop={8}
                onPress={handleConfirmPending}
                style={({ pressed }) => [
                  styles.confirmButton,
                  pressed && styles.confirmButtonPressed,
                ]}
              >
                <Text style={styles.confirmButtonLabel}>Set deadline</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {validationError !== null && (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {validationError}
        </Text>
      )}
    </View>
  );
};

function validatePending(
  selectedMs: number,
  tripStartIso: string | null,
): string | null {
  if (selectedMs <= Date.now()) return "Deadline must be in the future.";
  if (tripStartIso !== null) {
    const tripStartMs = Date.parse(tripStartIso);
    if (Number.isFinite(tripStartMs) && selectedMs >= tripStartMs) {
      return "Deadline must be before trip starts.";
    }
  }
  return null;
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
  },
  helper: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  pickButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  pickButtonPressed: {
    opacity: 0.8,
  },
  pickButtonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
  savedChip: {
    paddingVertical: spacing.xs,
  },
  savedChipPrimary: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },
  savedChipMeta: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  editLinkRow: {
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  editLinkRowPressed: {
    opacity: 0.7,
  },
  editLinkText: {
    fontSize: 14,
    color: accent.warm,
    fontWeight: "500",
  },
  errorText: {
    fontSize: 12,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  pickerWrap: {
    marginTop: spacing.xs,
  },
  pendingPreview: {
    fontSize: 13,
    color: textTokens.secondary,
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  confirmRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    justifyContent: "flex-end",
  },
  cancelButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    minHeight: 44,
    minWidth: 88,
    justifyContent: "center",
    alignItems: "center",
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  cancelButtonLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  confirmButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.warm,
    minHeight: 44,
    minWidth: 120,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmButtonPressed: {
    opacity: 0.85,
  },
  confirmButtonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
});
