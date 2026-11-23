/**
 * #4523 — the Explorer's date input for @mingla/form-rendering date questions
 * (RSVP and brand forms), on iOS, Android and web alike: a row that opens the
 * Mingla calendar inline under it, drawn in the form's own palette. Nothing is
 * typed and no OS spinner, OS dialog or browser date box is used. A day tap
 * commits `YYYY-MM-DD` and closes; changing month never closes it.
 *
 * The name predates #4523 (it was the web-only browser date box); the form
 * primitives still inject it as `WebDateTimeInput`.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FormRenderingTokens, FormWebDateInputProps } from "@mingla/form-rendering";
import type { CalendarConfig, CalendarTokens } from "@mingla/calendar/types";
import { CalendarEmbed } from "@mingla/calendar/CalendarField";
import { formatLongDate } from "@mingla/calendar/core/labels";

import {
  DARK_TOKENS,
  deviceTimeZone,
  renderCalendarIcon,
  useExplorerCalendarLabels,
} from "../calendar/explorerInlineCalendar";

/** The calendar in the form's palette (falls back to the dark Explorer tokens). */
function calendarTokensFor(form: FormRenderingTokens | undefined): CalendarTokens {
  if (form === undefined) return DARK_TOKENS;
  const { color, radius } = form;
  return {
    surface: "transparent",
    text: color.text1,
    textMuted: color.text2,
    textFaint: color.text4,
    border: color.line,
    fieldFill: color.fill.inset,
    selectedFill: color.accent,
    onSelected: color.textStrong,
    rangeFill: color.accentLine,
    todayDot: color.accent,
    error: color.danger,
    radius: radius.md,
    dayRadius: radius.md,
  };
}

export const RsvpFormWebDateInput: React.FC<FormWebDateInputProps> = ({
  value,
  onChangeValue,
  ariaLabel,
  disabled = false,
  hasError = false,
  testID,
  tokens,
  birthDate = false,
}) => {
  const [open, setOpen] = useState(false);
  const labels = useExplorerCalendarLabels();
  const calendarTokens = useMemo(() => calendarTokensFor(tokens), [tokens]);
  const config = useMemo<CalendarConfig>(
    () => ({ tokens: calendarTokens, primitives: { Sheet: () => null, renderIcon: renderCalendarIcon } }),
    [calendarTokens],
  );
  const display = value.length > 0 ? formatLongDate(value) : "";
  const close = (): void => setOpen(false);

  return (
    <View style={styles.host}>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${ariaLabel}, ${display.length > 0 ? display : labels.not_set}`}
        accessibilityHint={labels.opens_calendar}
        accessibilityState={{ disabled, expanded: open }}
        hitSlop={4}
        testID={testID}
        style={({ pressed }) => [
          styles.row,
          { borderColor: hasError ? calendarTokens.error : calendarTokens.border, backgroundColor: calendarTokens.fieldFill, borderRadius: calendarTokens.radius },
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text style={[styles.value, { color: display.length > 0 ? calendarTokens.text : calendarTokens.textFaint }]} numberOfLines={1}>
          {display.length > 0 ? display : labels.choose_date}
        </Text>
        {renderCalendarIcon("calendar", calendarTokens.textMuted, 18)}
      </Pressable>
      {open && !disabled ? (
        <CalendarEmbed
          // #4523 SC-12 (W-9) — a date-of-birth question opens on the year grid.
          mode={birthDate ? "dob" : "single"}
          label={ariaLabel}
          value={value}
          onChange={(day) => {
            onChangeValue(day);
            close();
          }}
          timeZone={deviceTimeZone()}
          labels={labels}
          config={config}
          testID={testID === undefined ? undefined : `${testID}-calendar`}
          onDone={close}
          onCancel={close}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    gap: 8,
    overflow: "hidden",
  },
  value: { flex: 1, fontSize: 16, lineHeight: 22 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
