/**
 * DateField — the business app's ONE Platform-gated calendar date control.
 * Issue #1503 [stay-date-pickers], SPEC §4.5.
 *
 * WHY THIS EXISTS: issue #1027 shipped `WebDateTimeInput`, a real visible HTML5
 * input, but it is WEB-ONLY by construction (raw DOM `<input>`, no
 * `Platform.OS` branch). Every caller therefore has to hand-roll the other half
 * of the pair — `@react-native-community/datetimepicker` on iOS/Android — and
 * the Stay surfaces simply never did, leaving operators typing `2026-12-24`
 * into a numeric keypad. This component closes that generically:
 *
 *     Platform.OS === "web"  -> <WebDateTimeInput type="date" … />   (reused)
 *     Platform.OS !== "web"  -> Pressable + <DateTimePicker mode="date" … />
 *
 * VALUE CONTRACT (binding, SPEC §5): `value` and `onChangeValue` are ALWAYS a
 * venue/operator-local calendar date `YYYY-MM-DD`, or `""` for unset. A `Date`
 * object never crosses this boundary. All parsing/formatting is delegated to
 * `@mingla/brand-rendering/stayDateRules` — the app -> package direction is the
 * legal one, and it is the whole point of that shared module: no surface
 * computes a date itself.
 *
 * A top-level `import DateTimePicker` is deliberate and matches the six
 * existing #1027 consumers (e.g. trip/BookingDeadlinePicker.tsx:21-23), which
 * import it unconditionally and gate at render.
 *
 * INVARIANTS: I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT,
 *             I-PROPOSED-1503-STAY-DATES-ARE-PICKED-NOT-TYPED.
 */

import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import {
  formatStayDate,
  formatStayDateLong,
  parseStayDate,
} from "@mingla/brand-rendering/stayDateRules";
import React, { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { WebDateTimeInput } from "./WebDateTimeInput";

export interface DateFieldProps {
  /** Visible label rendered above the control. */
  label: string;
  /** `YYYY-MM-DD`, or `""` for unset. Never a Date. */
  value: string;
  /** Fires with `YYYY-MM-DD` (or `""` when cleared on web). */
  onChangeValue: (value: string) => void;
  /** Required — this replaces a labelled input. */
  accessibilityLabel: string;
  /** Optional inclusive lower bound, `YYYY-MM-DD`. */
  min?: string;
  /** Optional inclusive upper bound, `YYYY-MM-DD`. */
  max?: string;
  /** Placeholder shown on native when `value` is `""`. */
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  testID?: string;
}

export function DateField({
  label,
  value,
  onChangeValue,
  accessibilityLabel,
  min,
  max,
  placeholder = "Choose a date",
  disabled = false,
  hasError = false,
  testID,
}: DateFieldProps): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleNativePick = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      // Android's dialog owns its own lifecycle — close on every event,
      // including a back-press dismissal.
      setPickerOpen(false);
      if (event.type === "dismissed" || selected === undefined) return;
      onChangeValue(formatStayDate(selected));
    },
    [onChangeValue],
  );

  if (Platform.OS === "web") {
    return (
      <View style={styles.host}>
        <Text style={styles.label}>{label}</Text>
        <WebDateTimeInput
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          hasError={hasError}
          ariaLabel={accessibilityLabel}
          testID={testID}
          onChangeValue={onChangeValue}
        />
      </View>
    );
  }

  const anchor =
    (value === "" ? null : parseStayDate(value)) ??
    (min === undefined ? null : parseStayDate(min)) ??
    new Date();

  return (
    <View style={styles.host}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, currently ${formatStayDateLong(value)}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setPickerOpen(true)}
        testID={testID}
        style={[
          styles.row,
          hasError ? styles.rowError : null,
          disabled ? styles.rowDisabled : null,
        ]}
      >
        <Text style={value === "" ? styles.rowPlaceholder : styles.rowValue}>
          {value === "" ? placeholder : formatStayDateLong(value)}
        </Text>
      </Pressable>
      {pickerOpen ? (
        <DateTimePicker
          value={anchor}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          minimumDate={min === undefined ? undefined : (parseStayDate(min) ?? undefined)}
          maximumDate={max === undefined ? undefined : (parseStayDate(max) ?? undefined)}
          themeVariant="dark"
          onChange={handleNativePick}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.xxs,
  },
  label: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  // Mirrors WebDateTimeInput's BASE_STYLE so the two halves of the pair look
  // identical: 48pt tall, 1px glass border, dark glass fill, 16px primary text.
  row: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowError: {
    borderColor: semantic.error,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowValue: {
    fontSize: 16,
    color: textTokens.primary,
  },
  rowPlaceholder: {
    fontSize: 16,
    color: textTokens.quaternary,
  },
});

export default DateField;
