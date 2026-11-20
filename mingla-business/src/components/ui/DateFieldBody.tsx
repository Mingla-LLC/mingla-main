/**
 * DateFieldBody — the lazily loaded half of the Host `DateField` (#4523). It is
 * the whole calendar feature for Host: CalendarField, the surface and the Host
 * config live in this one chunk, loaded by the single React.lazy in DateField.
 */
import { CalendarField } from "@mingla/calendar/CalendarFieldEager";
import React from "react";
import { Platform } from "react-native";

import { detectDeviceTimezone } from "../../utils/timezones";
import { HOST_CALENDAR_CONFIG } from "./calendarHostConfig";
import type { DateFieldProps } from "./DateField";

export default function DateFieldBody({
  label,
  value,
  onChangeValue,
  accessibilityLabel,
  min,
  max,
  placeholder,
  disabled = false,
  hasError = false,
  testID,
  // [TRANSITIONAL] falls back to the device zone — the seven current callers do
  // not pass a brand or venue zone yet; exit: each caller passes `timeZone`
  // (the #4523 later slices migrate them).
  timeZone = detectDeviceTimezone(),
}: DateFieldProps): React.ReactElement {
  return (
    <CalendarField
      label={label}
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChange={onChangeValue}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      invalid={hasError}
      testID={testID}
      timeZone={timeZone}
      clearable={Platform.OS === "web"}
      config={HOST_CALENDAR_CONFIG}
    />
  );
}
