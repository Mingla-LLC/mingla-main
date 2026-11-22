/**
 * HostCalendarBody — the lazily loaded half of every Host calendar field
 * (#4523). The whole calendar feature for Host (CalendarField, DateTimeField,
 * the surface and the Host config) is this one chunk, loaded by the single
 * React.lazy per field wrapper in `HostCalendarPlaceholder.lazyHostField`
 * (one shared loader).
 */
import { CalendarEmbed, CalendarField, DateRangeField, DateTimeField } from "@mingla/calendar/CalendarFieldEager";
import type { StayRangeCalendarArgs } from "@mingla/brand-rendering/StayDateRangeRows";
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
  allowSameDay = false,
}: HostDateRangeFieldProps & { openOnMount?: boolean }): React.ReactElement {
  return (
    <DateRangeField
      allowSameDay={allowSameDay}
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

/**
 * #4523 — a custom-form date question (form-rendering's injected date input).
 * The question shell draws the label, so the field's visible label is empty
 * and the question's label is spoken.
 */
export function FormDateBody({
  value,
  onChangeValue,
  accessibilityLabel,
  disabled = false,
  hasError = false,
  testID,
  openOnMount = false,
}: {
  value: string;
  onChangeValue: (value: string) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  hasError?: boolean;
  testID?: string;
  openOnMount?: boolean;
}): React.ReactElement {
  return (
    <CalendarField
      label=""
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChange={onChangeValue}
      disabled={disabled}
      invalid={hasError}
      testID={testID}
      timeZone={detectDeviceTimezone()}
      clearable={Platform.OS === "web"}
      defaultOpen={openOnMount}
      config={HOST_CALENDAR_CONFIG}
    />
  );
}

/**
 * #4523 — the stay dates range calendar, drawn inline under the stay rows
 * (`@mingla/brand-rendering` StayDateRangeRows) in the page palette. Done
 * commits the range; Escape closes and keeps the committed dates.
 */
export function StayRangeEmbedBody(args: StayRangeCalendarArgs): React.ReactElement {
  return (
    <CalendarEmbed
      mode="range"
      unit="nights"
      label={args.label}
      value={args.value}
      onChange={args.onCommit}
      onDone={args.onClose}
      onCancel={args.onClose}
      min={args.min}
      max={args.max}
      maxLength={args.maxLength}
      maxStart={args.maxStart}
      timeZone={args.timeZone}
      testID={args.testID}
      config={{ tokens: args.tokens, primitives: HOST_CALENDAR_CONFIG.primitives }}
    />
  );
}
