/**
 * HostCalendarBody — the lazily loaded half of every Host calendar field
 * (#4523). The whole calendar feature for Host (CalendarField, DateTimeField,
 * the surface and the Host config) is this one chunk, loaded by the single
 * React.lazy per field wrapper in `HostCalendarPlaceholder.lazyHostField`.
 */
import { CalendarField, DateRangeField, DateTimeField } from "@mingla/calendar/CalendarFieldEager";
import React from "react";
import { Platform } from "react-native";

import { detectDeviceTimezone } from "../../utils/timezones";
import { HOST_CALENDAR_CONFIG } from "./calendarHostConfig";
import type {
  DateFieldProps,
  HostDateRangeFieldProps,
  HostDateTimeFieldProps,
} from "./hostCalendarFieldProps";

export function DateBody({
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
  // [TRANSITIONAL] falls back to the device zone — callers do not pass a brand
  // or venue zone yet; exit: each caller passes `timeZone`.
  timeZone = detectDeviceTimezone(),
  openOnMount = false,
}: DateFieldProps & { openOnMount?: boolean }): React.ReactElement {
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
      defaultOpen={openOnMount}
      config={HOST_CALENDAR_CONFIG}
    />
  );
}

export function DateTimeBody({
  label,
  value,
  onChangeValue,
  onClear,
  accessibilityLabel,
  min,
  max,
  minTime,
  maxTime,
  placeholder,
  disabled = false,
  hasError = false,
  testID,
  timeZone = detectDeviceTimezone(),
  timeStepMinutes,
  openOnMount = false,
}: HostDateTimeFieldProps & { openOnMount?: boolean }): React.ReactElement {
  return (
    <DateTimeField
      label={label}
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChange={onChangeValue}
      onClear={onClear}
      min={min}
      max={max}
      minTime={minTime}
      maxTime={maxTime}
      timeStepMinutes={timeStepMinutes}
      placeholder={placeholder}
      disabled={disabled}
      invalid={hasError}
      testID={testID}
      timeZone={timeZone}
      defaultOpen={openOnMount}
      config={HOST_CALENDAR_CONFIG}
    />
  );
}

export function DateRangeBody({
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
  timeZone = detectDeviceTimezone(),
  openOnMount = false,
}: HostDateRangeFieldProps & { openOnMount?: boolean }): React.ReactElement {
  return (
    <DateRangeField
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
      defaultOpen={openOnMount}
      config={HOST_CALENDAR_CONFIG}
    />
  );
}
